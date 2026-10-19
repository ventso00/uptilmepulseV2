# Checks et scheduler — le pipeline de bout en bout

Fichiers couverts : `server/scheduler/{loop,tick,limits,retention,heartbeatAuth,
routes,register}.ts`, `server/_core/heartbeat.ts`, `server/checks/{engine,client}.ts`,
`server/monitors/ssrf.ts`, `server/incidents/state.ts`.

---

## 1. Deux déclencheurs — lequel fait réellement le travail

| Déclencheur                 | Fichier                       | Rôle             |
| --------------------------- | ----------------------------- | ---------------- |
| Cron plateforme (Heartbeat) | `scheduler/register.ts:12-21` | redondance       |
| Boucle interne 30 s         | `scheduler/loop.ts:17-47`     | chemin principal |

- Cron : job `uptimepulse-checks`, expression `0 * * * * *` (6 champs, secondes
  à `0`, donc chaque minute), méthode `POST` sur `/api/scheduled/checks`
  (`server/scheduler/register.ts:14-18`).

- Le cron est **auto-inhibé** : `register.ts:7` sort immédiatement si
  `MANUS_API_URL` ou `MANUS_API_KEY` est vide, et `register.ts:10` n'ajoute
  rien si un job `uptimepulse-checks` actif existe déjà (`register.ts:12-21`).
- Le format cron est celui du service plateforme : 6 champs `sec min heure dom
mois dow`, UTC, intervalle minimal 60 s (`server/_core/heartbeat.ts:6-9`) ; le
  chemin doit commencer par `/api/scheduled/` (`heartbeat.ts:127-134`).
- Branchement au démarrage : `ensureHeartbeatJob()` puis
  `startInternalScheduler()` dans le callback `server.listen`
  (`server/_core/index.ts:93-94`).
- **Pourquoi la boucle interne existe** : le commentaire de `loop.ts:7-14` est
  explicite — le heartbeat est un déclencheur _externe seulement_, « nothing
  guarantees it fires » : absent en local, perdu silencieusement si le service
  plateforme bronche. Sans tick, aucun monitor ne sort de `UNKNOWN` et le
  produit ne fonctionne pas. La boucle interne est donc le chemin principal, le
  cron une redondance.
- Premier passage 2 s après le boot (`loop.ts:41`, `unref()` en `:42`) : un
  serveur qui redémarre ne doit pas faire attendre les monitors dus un intervalle
  complet (`loop.ts:39-40`).
- Un seul pompon à la fois : le drapeau `running` (`loop.ts:5`, test `:22`) rend
  les passements réentrants, un tick lent est ignoré et non mis en file.
- Extinction : `SCHEDULER_INTERNAL=0` (`loop.ts:20`) — prévu pour un déploiement
  multi-nœuds qui normaliserait sur un cron externe (`loop.ts:14-15`).
- Les deux voies appellent **la même** `runSchedulerTick()`
  (`tick.ts:27-31`, `loop.ts:24`, `routes.ts:30`) : l'application ne peut jamais
  dépendre d'un cron externe pour que les checks existent.
- Sans identifiants plateforme, `register.ts:7` sort avant tout appel ; la
  boucle interne continue seule. En cas d'échec d'enregistrement :
  `heartbeat_registration_failed` (`register.ts:27`), sinon
  `heartbeat_registered` (`:23`).

---

## 2. Sélection des monitors dus

```sql
SELECT id FROM monitors
 WHERE enabled = 1 AND nextCheckAt <= now
 ORDER BY nextCheckAt ASC
 LIMIT 50
```

- Requête exacte : `server/scheduler/tick.ts:48-55`.
- Taille du lot : `BATCH_SIZE = 50` (`server/scheduler/limits.ts:1`), importé
  et exposé par `routes.ts:6-8` et `:35`.
- Aucun filtre par utilisateur : le lot est mondial, trié par ancienneté
  d'échéance, donc équitable entre comptes. Index dédié
  `monitors_enabled_next_check_idx (enabled, nextCheckAt)`
  (`shared/db/schema.ts:145-148`).
- Concurrence : `CHECK_CONCURRENCY = 10` (`tick.ts:17`), appliquée par
  `mapWithConcurrency` (`tick.ts:57-74`, utilitaire `server/scheduler/pool.ts`).
- `mapWithConcurrency` préserve l'ordre d'entrée : le tableau de résultat est
  pré-dimensionné et indexé par position, pas par ordre d'achèvement
  (`pool.ts:14-15`, `pool.ts:23`).
- Plafond d'in-flight : `size = max(1, min(floor(limit), items.length))`
  (`pool.ts:13`) — autant de workers que de places, chacun tirant le prochain
  index depuis un curseur partagé (`pool.ts:18-25`).
- Pourquoi ni `Promise.all` ni `for` séquentiel : `Promise.all` ouvrirait une
  socket par check simultanément, une boucle séquentielle ferait déborder la
  passe (`pool.ts:1-6`, `tick.ts:11-16`). Avec 30 s de timeout max par monitor,
  50 checks séquentiels débordent largement les 60 s du cron ; 10 en vol gardent
  le pire cas vers 150 s (`tick.ts:11-16`).
- Un monitor qui plante ne doit pas avorter le lot : `try/catch` par item
  (`tick.ts:60-73`) ; `processed` compte les `true`, `failed = due - processed`
  (`tick.ts:75`, `:94-100`).
- Piège de lecture : un `false` veut dire aussi bien « check échoué » que
  « claim perdu face à une passe concurrente » (`tick.ts:62`, `engine.ts:107`) —
  le compteur `failed` n'est pas un compteur d'erreurs réseau.

---

## 3. Le claim atomique

```
UPDATE monitors SET nextCheckAt = now + 6 min
 WHERE id = ? AND enabled = 1 AND nextCheckAt <= now
```

- Écriture exacte : `server/checks/engine.ts:97-107` ; le claim est perdu si
  `affectedRows === 0`, et `runCheck` renvoie `null` (`engine.ts:107`) — donc
  `runMonitorCheck` renvoie `null` (`engine.ts:32-33`).
- Rend possible l'exécution sans double traitement entre : deux instances du
  même serveur, et/ou le cron externe + la boucle interne (`loop.ts:10-12` :
  « concurrent ticks from other instances or from the heartbeat stay safe
  because each check is claimed atomically »).
- Le claim écrit une échéance **provisoire** de 6 min ; l'échéance réelle est
  posée à la fin de la transaction : `nextCheckAt = checkedAt +
intervalSeconds * 1000` (`engine.ts:237-239`).
- Conséquence de crash : si le process meurt entre le claim et la fin, le
  monitor reste revendicable 6 minutes plus tard — pas de verrou perpétuel.
- Relecture après claim : le monitor complet est re-sélectionné (`engine.ts:108-113`)
  et un `enabled` devenu faux annule la passe (`engine.ts:114`).
- **Le littéral n'a pas de nom de constante** : seule la variable locale
  `claimUntil` existe (`engine.ts:96`) ; `6 * 60 * 1000` n'est défini nulle part
  ailleurs comme `CLAIM_WINDOW_MS` ou équivalent (vérifié par recherche de
  `6 * 60 * 1000` dans `server/`). Le réglage de cette fenêtre suppose donc de
  toucher le code, pas une configuration.

---

## 4. Validation SSRF en deux temps

### 4.1 Temps 1 — syntaxe (`validateUrlSyntax`)

| Règle                              | Citation         | Code d'erreur    |
| ---------------------------------- | ---------------- | ---------------- |
| URL parseable                      | `ssrf.ts:63-68`  | `INVALID_TARGET` |
| `http:` ou `https:` uniquement     | `ssrf.ts:70-75`  | `INVALID_TARGET` |
| ni `user:pass@`, ni port explicite | `ssrf.ts:76-81`  | `INVALID_TARGET` |
| `localhost` et `*.localhost`       | `ssrf.ts:82-88`  | `BLOCKED_TARGET` |
| hostname non vide et ≤ 253         | `ssrf.ts:89-94`  | `INVALID_TARGET` |
| IP littérale privée/réservée       | `ssrf.ts:95-100` | `BLOCKED_TARGET` |

- Les crochets IPv6 sont retirés avant les tests (`ssrf.ts:82`, `ssrf.ts:120`).
- Le port est interdit en dur : `url.port` truthy suffit à rejeter — pas de
  `:8443`, pas de `:443` écrit explicitement (`ssrf.ts:76`, test
  `server/monitors/ssrf.test.ts:29-32`).

### 4.2 Temps 2 — 22 CIDR refusés (`blockedRanges`)

Liste complète, `server/monitors/ssrf.ts:15-39` :

| CIDR              | Portée                         |
| ----------------- | ------------------------------ |
| `0.0.0.0/8`       | « this network »               |
| `10.0.0.0/8`      | privé                          |
| `100.64.0.0/10`   | CGNAT                          |
| `127.0.0.0/8`     | boucle locale                  |
| `169.254.0.0/16`  | lien local (métadonnées cloud) |
| `172.16.0.0/12`   | privé                          |
| `192.0.0.0/24`    | IANA                           |
| `192.0.2.0/24`    | documentation                  |
| `192.168.0.0/16`  | privé                          |
| `198.18.0.0/15`   | benchmark                      |
| `198.51.100.0/24` | documentation                  |
| `203.0.113.0/24`  | documentation                  |
| `224.0.0.0/4`     | multicast                      |
| `::/128`          | adresse nulle                  |
| `::1/128`         | boucle locale                  |
| `::/96`           | préfixe v4-compatibilité       |
| `100::/64`        | discard-only                   |
| `2001::/32`       | **Teredo**                     |
| `2002::/16`       | **6to4**                       |
| `fc00::/7`        | unique local                   |
| `fe80::/10`       | lien local                     |
| `ff00::/8`        | multicast                      |

- Correspondance par `ipaddr.js` (`ssrf.ts:47-50`) : la famille doit être la
  même, donc un CIDR IPv4 ne peut jamais matché une adresse IPv6 et
  inversement — d'où les entrées IPv6 dédiées.
- Piège IPv6 n°1 — **IPv4-mapped** : `::ffff:a.b.c.d` n'est pas dans `::/96`
  (le préfixe `/96` s'arrête avant `::ffff:0:0`), il est donc rejeté par une
  règle explicite et non par la liste : `isIPv4MappedAddress() ⇒ true` bloque,
  quelle que soit l'adresse v4 encapsulée (`ssrf.ts:42-46`).
- Piège n°2 — **6to4** `2002::/16` encode l'IPv4 dans les octets 3-6 :
  `2002:7f00:1::` est `127.0.0.1` déguisé. Couvert par le préfixe (`ssrf.ts:35`)
  et testé (`ssrf.test.ts:41-45`, `ssrf.test.ts:47-55`).
- Piège n°3 — **Teredo** `2001:0000::/32` encapsule l'IPv4 dans les deux
  derniers groupes (`ssrf.ts:33-34`, test `ssrf.test.ts:42`).
- Piège n°4 — **`::/96`** capture `::7f00:1` et consorts, que la seule
  `::1/128` aurait laissés passer (`ssrf.ts:31`, test `ssrf.test.ts:49-54`).
- Piège n°5 — **`100::/64`** (discard-only RFC 6666) n'est ni privé ni boucle
  locale, il aurait été oublié par une liste « RFC1918 only » (`ssrf.ts:32`,
  test `ssrf.test.ts:44`).
- `isBlockedIp` renvoie `false` pour une chaîne qui n'est pas une IP
  (`ssrf.ts:54`) — le nom d'hôte est traité ailleurs — mais `true` (blocage)
  si `ipaddr.parse` lève (`ssrf.ts:57-59`) : l'erreur est interprétée comme un
  refus, jamais comme un laisser-passer.
- `validateResolvedAddresses` refuse aussi une résolution vide
  (`ssrf.ts:104-107`), et chaque adresse d'un lot A/AAAA est testée
  (`ssrf.ts:108-115`).
- `resolveAndValidateTarget` : validation syntaxique, puis DNS _d'aperçu_
  (`dns.lookup({all:true, verbatim:true})`, `ssrf.ts:118-133`). Une IP
  littérale court-circuite le DNS (`ssrf.ts:121`). Cet aperçu n'est **pas** la
  protection : voir 4.3.

### 4.3 DNS rebinding et le `lookup` de connexion

- Attaque : le nom renvoie une IP publique au moment de la validation
  (`ssrf.ts:123-132`), puis une IP privée au moment où la socket se connecte —
  la vérification et la connexion portent alors sur deux réponses DNS
  différentes (TTL court).
- Fermeture : un `lookup` personnalisé est injecté dans l'agent HTTP
  (`server/checks/client.ts:237-307`). Node l'appelle **au moment de
  construire la connexion** ; il re-résout (`:248-251`), revalide
  (`:260-261`), et ne transmet à la couche réseau **que** les adresses validées
  (`:276-288`). Une adresse privée qui apparaît au second appel ne rejoint
  jamais la socket : le callback reçoit une erreur synthétique
  `Resolved target is blocked` avec le code `BLOCKED_TARGET`/`INVALID_TARGET`
  (`:289-304`).
- Deux garde-fous appendus : une résolution vide est convertie en `ENOTFOUND`
  synthétique (`client.ts:263-275`) ; `agent: false` force une connexion neuve
  par hop, donc un `lookup` effectif à chaque redirection (`client.ts:221-227`).

---

## 5. La contrainte Node du `lookup` `{all:true}`

- Node appelle le `lookup` personnalisé avec `all: true` (options observées
  `{"hints":0,"all":true}`, `client.ts:230-236`) : le callback **doit** alors
  recevoir un **tableau** `{address, family}`, jamais une chaîne.
- L'implémentation honore ce contrat : branche `wantsAll` qui renvoie
  `addresses.map(entry => ({ address, family }))` (`client.ts:276-283`), et
  pour les chemins d'erreur un tableau vide au lieu d'une chaîne vide
  (`client.ts:254-258`, `:270-274`, `:299-303`). La branche chaîne n'existe que
  si un appelant futur demandait `all: false` (`client.ts:284-288`).
- **Panne entière que cela causait** : renvoyer une chaîne faisait échouer
  _tous_ les checks avec `ERR_INVALID_IP_ADDRESS` — donc aucun check ne
  passait, donc **aucune panne n'était jamais détectée** : le produit mentait
  « vert » par silence. Consigné dans `client.ts:233-236` et
  `docs/04-project/decisions.md:26`.
- Test qui la couvre : `server/checks/client.test.ts` — en-tête
  `client.test.ts:10-14` explique que le probe historique utilisait une cible
  privée et n'aurait rien vu ; le cas qui vérifie qu'un hôte public est bien
  classé `UP_HTTP_2XX` est `client.test.ts:61-72`.

---

## 6. La mesure

### 6.1 Constantes

| Valeur                                | Citation                            |
| ------------------------------------- | ----------------------------------- |
| corps max 256 KiB                     | `client.ts:15`                      |
| redirections max 3                    | `client.ts:16`                      |
| `User-Agent: UptimePulse-Monitor/1.0` | `client.ts:17`, posée `:219`        |
| timeout = `monitor.timeoutMs`         | `client.ts:220`, handler `:391-397` |
| une socket neuve par hop              | `client.ts:221-227`                 |

- Timeout : l'option `timeout` de `http.request` déclenche l'événement
  `timeout`, qui détruit la requête avec `code: "UPTIMEPULSE_TIMEOUT"`
  (`client.ts:391-397`) → classée `DOWN_TIMEOUT` (`:131-136`). Une réponse
  reçue avant l'expiration reste une réponse : la classification HTTP s'impose
  (`tick.ts:12-14` rappelle que chaque check peut bloquer jusqu'à 30 s).

### 6.2 Latences par phase

Quatre durées mesurées sur **le dernier hop** (celui qui répond), en ms,
arrondies et bornées à 0 (`client.ts:315-341`, helper `elapsed` `:315-316`) :

| Phase            | Délimitation                                  | Citation                        |
| ---------------- | --------------------------------------------- | ------------------------------- |
| `dnsMs`          | `lookupStart` → retour du DNS                 | `client.ts:247`, `:252`, `:328` |
| `tcpMs`          | fin du lookup → événement `connect` du socket | `:329-335`, écoute `:378-380`   |
| `tlsMs`          | `connect` → `secureConnect`                   | `:336-339`, écoute `:386-389`   |
| `ttfbMs`         | `startedAt` → premiers en-têtes reçus         | `:340`, marqueur `:310`         |
| `responseTimeMs` | `startedAt` → fin de lecture du hop           | `:189`, `:323-326`              |

- Les phases sont stockées en colonnes dédiées de `ping_logs` :
  `dnsMs` / `tcpMs` / `tlsMs` / `ttfbMs` (`shared/db/schema.ts:177-180`),
  écrites depuis `engine.ts:154-157`.
- Pourquoi sur le socket et non sur la requête : avec un `lookup` personnalisé,
  Node n'émet **pas** `lookup`/`connect`/`secureConnect` sur l'objet request —
  l'écoute est donc branchée sur le socket reçu par l'événement `socket`
  (`client.ts:371-377`).
- `tlsMs` est `null` en HTTP simple, `dnsMs`/`tcpMs` `null` si la phase n'a pas
  été atteinte (un `null` veut dire « phase sautée », pas « 0 ms »).
- Le serveur dérive un temps applicatif `serverMs = ttfb − dns − tcp − tls`
  (`shared/contracts.ts:403-413`).

### 6.3 Cap de 256 Ko

- Compteur d'octets à chaque chunk ; au-delà du cap, `truncated = true`,
  `response.destroy()` puis `finish()` (`client.ts:348-365`).
- Les chunks reçus après le cap sont jetés, pas concaténés (`:352-353`) : la
  body conservée fait exactement les 256 premiers Ko.
- Le cap borne la mémoire, il ne crée **pas** de panne : status et en-têtes ont
  déjà prouvé que le service répond, sinon « chaque page lourde (streaming,
  SPA) lirait comme une fausse coupure » (`client.ts:354-360`, test
  `client.test.ts:90-100`).

### 6.4 Redirections

- Boucle `for redirect = 0..MAX_REDIRECTS` (`client.ts:411`) : à chaque hop,
  `validateUrlSyntax` **puis** `resolveAndValidateTarget` **puis**
  `requestOnce` (`client.ts:410-413`) — les 3 sauts sont donc revalidés un à
  un, y compris contre le SSRF.
- Le `Location` est résolu relativement (`new URL(location, currentUrl)`) puis
  revalidé ; une Location illégale est classée via `errorClassification`
  (`client.ts:415-447`).
- 3xx **sans** `Location` : traité comme une réponse normale, donc UP
  (`classification UP_HTTP_3XX`, `client.ts:415-419`, `:448-489`).
- Au 4ᵉ 3xx successif (`redirect === MAX_REDIRECTS` : `client.ts:420-430`) →
  `isUp: false`, `DOWN_NETWORK`, `errorMessage: "Redirect limit exceeded"`, le
  `statusCode` du dernier hop est conservé. La sortie de boucle théorique
  duplique la même réponse (`client.ts:491-499`).

### 6.5 Certificat TLS

- Lecture sur le socket au moment de `secureConnect` (`client.ts:381-389`),
  plus une relecture de secours à la résolution si le socket était déjà
  sécurisé (`client.ts:314`) ; tout est enveloppé dans un `try/catch` muet
  (`client.ts:166-184`).
- Champs retenus : `issuer` et `subject` réduits au premier DN pertinent
  `CN → O → OU → "Inconnu"` (`:154-160`), tronqués à 255 ; `validTo` en ISO ou
  `null` si illisible (`:175-179`).
- Persistance : un check HTTPS réussi rafraîchit `sslIssuer` / `sslSubject` /
  `sslValidTo` ; un check HTTP clair les efface ; un check sans réponse HTTP
  (`statusCode === null`) **conserve la dernière valeur connue**
  (`engine.ts:216-228`). C'est ce qui évite qu'une panne efface le certificat
  d'un monitor.

### 6.6 Classification : les 12 valeurs

Valeurs canoniques : `shared/contracts.ts:78-91` et `shared/db/schema.ts:152-165`
(copies volontairement identiques, parité testée).

| Valeur                 | Sens                                                                 | Verdict | Provenance                      |
| ---------------------- | -------------------------------------------------------------------- | ------- | ------------------------------- |
| `UP_HTTP_2XX`          | succès 2xx                                                           | UP      | `client.ts:118`                 |
| `UP_HTTP_3XX`          | redirection sans `Location`, ou dernier hop 3xx                      | UP      | `:119`                          |
| `DOWN_HTTP_4XX`        | 4xx                                                                  | DOWN    | `:120`                          |
| `DOWN_HTTP_5XX`        | 5xx **et tout le reste**                                             | DOWN    | `:121`                          |
| `DOWN_TIMEOUT`         | `UPTIMEPULSE_TIMEOUT`, `ETIMEDOUT`, message contenant `timeout`      | DOWN    | `:131-136`                      |
| `DOWN_DNS`             | `ENOTFOUND`, `EAI_AGAIN`, `EAI_FAIL`, `ENODATA`                      | DOWN    | `:137-138`                      |
| `DOWN_TLS`             | `code` contenant `CERT` ou `TLS`, ou message contenant `certificate` | DOWN    | `:139-144`                      |
| `DOWN_NETWORK`         | tout autre erreur, et limite de redirection                          | DOWN    | `:145`, `:420-430`, `:491-499`  |
| `INVALID_TARGET`       | rejet de syntaxe / DNS d'aperçu / cible non résolue                  | DOWN    | `ssrf.ts:5-13`, `client.ts:125` |
| `BLOCKED_TARGET`       | plage refusée, `localhost`, IP privée résolue                        | DOWN    | idem                            |
| `DOWN_KEYWORD_MISSING` | `must_contain` absent sur corps complet                              | DOWN    | `client.ts:101-105`             |
| `DOWN_KEYWORD_PRESENT` | `must_not_contain` présent                                           | DOWN    | `client.ts:107-113`             |

- Règle de décision : l'erreur d'abord (`errorClassification`, `client.ts:124-146`
  — un `TargetValidationError` fournit directement son code, `:125`), sinon la
  classe HTTP par tranches de statut (`:117-122`). L'ordre des tests importe :
  timeout → DNS → TLS → réseau (`:131-145`).
- **Conséquence du `else` terminal** (`client.ts:121`) : tout statut hors
  2xx/3xx/4xx est estampillé `DOWN_HTTP_5XX`, y compris un 1xx et le `0`
  synthétisé quand `statusCode` est absent (`client.ts:318`). Étiqueté « Erreur
  5xx » côté UI (`contracts.ts:103`) — à lire comme « DOWN par statut HTTP »,
  pas comme une certitude de 500.
- `isUp` est indépendant de la classification : il vaut exactement
  `200 <= status < 400` (`client.ts:448-449`, `:483`), sauf échec de mot-clé qui
  force `false` (`:457-466`).
- `errorMessage` : `HTTP <code>` pour les 4xx/5xx (`client.ts:485-486`), sinon
  le message d'erreur nettoyé des sauts de ligne et coupé à 300 caractères
  (`client.ts:148-152`) ; colonne bornée à 500 (`schema.ts:186`).
- Libellés français uniques : `checkClassificationLabels`
  (`contracts.ts:95-111`).

---

## 7. Assertion de contenu

- Demandée par le monitor : `keyword` + `keywordMode` (`schema.ts:121-124`,
  bornes contrat `contracts.ts:6-10`, `:32-33`), transmise au client par
  `engine.ts:116-125` uniquement quand `keyword` est non vide.
- Deux modes : `must_contain` / `must_not_contain`.
- **Jamais substituée au code HTTP** : l'évaluation n'est tentée que si
  `httpSucceeded` (2xx/3xx) (`client.ts:448-451`). Un 500 reste `DOWN_HTTP_5XX`
  quel que soit le mot-clé ; une 4xx n'est pas inspectée.
- Comparaison **insensible à la casse** : mot-clé et corps passés en
  `toLowerCase()` (`client.ts:83`, `:91`).
- Contenu non textuel : si `Content-Type` ne matche pas
  `/text|json|xml|html|javascript/i`, `unknown` avec le type repris en clair
  (60 caractères max) et aucune recherche (`client.ts:84-90`).
- Règle de troncature, et **pourquoi** :

| Cas                                      | Verdict   | Classification               | Citation   |
| ---------------------------------------- | --------- | ---------------------------- | ---------- |
| `must_contain` trouvé                    | `pass`    | aucune (celle du HTTP reste) | `:93-94`   |
| `must_contain` absent, corps **tronqué** | `unknown` | `null`                       | `:95-100`  |
| `must_contain` absent, corps complet     | `fail`    | `DOWN_KEYWORD_MISSING`       | `:101-105` |
| `must_not_contain` présent               | `fail`    | `DOWN_KEYWORD_PRESENT`       | `:107-113` |
| `must_not_contain` absent                | `pass`    | aucune                       | `:114`     |

Un mot-clé attendu absent sur un corps tronqué **ne rend pas `DOWN`** : le
texte peut se trouver au-delà du cap de lecture. En faire une panne
ouvrirait un faux positif sur chaque page volumineuse dont le marqueur est
en fin de document — la classe d'erreur que le module refuse déjà (§6.3).
Justification écrite : `client.ts:68-76` et `client.ts:95-100` ; motif
affiché : « Mot-clé introuvable dans les 256 premiers Ko : absence non
concluante ».

- Symétrie assumée : `must_not_contain` n'a aucune indulgence de troncature —
  trouver la chaîne interdite est une preuve en soi (`client.ts:72-75`, test
  `content.test.ts:75`).
- `pass` comme `unknown` laissent le monitor **UP**, l'`unknown` gardant son
  motif dans `errorMessage` (`client.ts:468-478`).
- Parité des trois listes (contrats / base / libellés) :
  `checkClassificationValues` (`contracts.ts:78-91`, `schema.ts:152-165`) et
  `checkClassificationLabels` (`contracts.ts:95-111`).
- Tests : `server/checks/content.test.ts` — casse (`:8`), absence complète
  (`:19`), troncature non concluante (`:30`), interdit présent (`:44`),
  contenu binaire jamais inspecté (`:61`), troncature concluante pour
  `must_not_contain` (`:75`).
  NB : la fonction `evaluateContent` vit dans `server/checks/client.ts:77` ;
  il n'y a **pas** de `server/checks/content.ts` (seul le test de ce nom
  existe).

---

## 8. Machine à états de l'incident

- Seuil : `INCIDENT_RULES = { failureThreshold: 3, recoveryThreshold: 2 }`
  (`shared/contracts.ts:69-73`), réexporté par `server/incidents/state.ts:28-30`
  et importé par le moteur de décision (`state.ts:79`, `state.ts:46`, `:53`).
- Fonction pure `decideIncidentTransition` (`state.ts:32-83`), appelée dans la
  transaction du check (`engine.ts:164-170`).

| Entrée                                             | Sortie             | Effet                                                               |
| -------------------------------------------------- | ------------------ | ------------------------------------------------------------------- |
| échec, aucun incident actif                        | `suspect_started`  | incident `suspect` inséré (`engine.ts:175-183`)                     |
| échec, actif, `failures + 1 >= 3`, statut ≠ `DOWN` | `confirmed`        | `confirmed` + `confirmedAt` (`engine.ts:184-194`) → notif `failure` |
| échec, actif, seuil non atteint                    | `none`             | compteurs seulement (`engine.ts:233-235`)                           |
| succès, `confirmed`, `successes + 1 >= 2`          | `resolved`         | `resolved` + durée (`engine.ts:204-214`) → notif `recovery`         |
| succès, `suspect`, seuil atteint                   | `suspect_resolved` | referme **sans** notification (`engine.ts:195-203`)                 |
| succès, rien d'actif                               | `none`             | compteurs seulement (`state.ts:62-67`)                              |

- Rôle des compteurs : `consecutiveFailures` / `consecutiveSuccesses` sont des
  colonnes int non nullées (`schema.ts:129-130`), incrémentées par la décision
  (`state.ts:42`, `:70`) et **remises à 0** dès que l'autre série prend la main
  (`state.ts:48`, `:56-59`, `:63-66`, `:75`, `:80`, `:82`) — ce sont bien des
  séries _consécutives_, pas des totaux. Écriture : `engine.ts:233-235`.
- Un échec isolé ne notifie pas : `dispatchIncidentNotification` n'est appelé
  que si `incidentAction !== "none"` (`engine.ts:35`), et `suspect_started`
  laisse `incidentAction` à `"none"` (`engine.ts:172-183`).
- Un incident `suspect` n'entre dans **aucun compteur public** : les requêtes
  de la page de statut excluent `status = 'suspect'`
  (`server/statuspages/analysis.ts:358`, `:381`), et `activeIncidents` n'est
  compté que sur `confirmed && !resolvedAt` (`analysis.ts:611`, contrat
  `contracts.ts:421-424`).
- Recherche de l'incident actif : `confirmed` d'abord, `suspect` en repli
  (`engine.ts:129-149`, `const active = activeIncident[0] ?? suspectIncident[0]`)
  — un seul incident ouvert par monitor.
- `PAUSED` est traité comme `UNKNOWN` par la décision (`state.ts:39-40`).
- Statut courant du monitor : `UNKNOWN` / `UP` / `DOWN` / `PAUSED`
  (`contracts.ts:75`, `schema.ts:126-128`), mis à jour par
  `decision.nextStatus` (`engine.ts:233`).
- `durationSeconds` = `checkedAt − active.startedAt`, arrondi, plancher 0
  (`engine.ts:196-199`, `:205-208`) ; `reason` = `errorMessage` sinon
  `classification` (`engine.ts:180`, `:190`).
- Toute la séquence log-insert / incidents / update monitor est **transactionnelle**
  (`engine.ts:128-259`) : pas de ping log sans transition, pas de transition
  sans ping log.
- Tests : `server/incidents/state.test.ts`, `server/checks/engine` n'a pas de
  fichier de test propre (non vérifié au-delà des tests cités).

---

## 9. Rétention

| Donnée                    | Âge conservé | Critère                 | Citation                             |
| ------------------------- | ------------ | ----------------------- | ------------------------------------ |
| `ping_logs`               | 90 jours     | `checkedAt < now − 90j` | `retention.ts:7`, `:24-26`, `:62-66` |
| `notification_deliveries` | 90 jours     | `createdAt < now − 90j` | `retention.ts:8`, `:27-29`, `:67-71` |
| `sessions`                | périmées     | `expiresAt < now`       | `retention.ts:57-61`                 |

- Lot : `batchSize: 1000`, appliqué via `.limit(1000)` sur chaque `DELETE`
  (`retention.ts:9-10`, `:38-42`) — les DELETE restent courts pour ne jamais
  bloquer un check (`:9`).
- Les 90 jours sont une marge d'audit : l'UI n'interroge que 30 jours
  (`retention.ts:6-7`, périodes `contracts.ts:51-57`).
- `deleteBatch` renvoie `affectedRows`, `0` en repli (`retention.ts:43-44`) ;
  les suppressions sont idempotentes, donc des passes qui se chevauchent sont
  sans danger (`retention.ts:47-50`).
- Appel : **après** les checks dans la passe, `runRetentionSweep(db)`
  (`tick.ts:76-86`), encadré par un `try/catch` qui journalise
  `retention_sweep_error` sans interrompre le tick (`:79-86`).
- Les comptes rendus (`RetentionCounts`) remontent dans le résultat du tick
  (`tick.ts:24`, `:94-100`) donc dans l'événement `scheduler_tick`.
- Test : `server/scheduler/retention.test.ts`.

---

## 10. Événements JSON du pipeline

Règle : chaque événement est un `console.*` d'un objet littéral
`{event, ...}`. Les charges sont des identifiants numériques, des
classifications et des durées — **jamais** un bot token, un cookie, une clé
d'API, une URL de monitor ni une adresse e-mail. Le champ texte libre le plus
large est un `error.message` nettoyé (`client.ts:148-152` pour la base,
`tick.ts:29-31` / `:67-68` pour les événements).

| Événement                       | Émetteur            | Contenu                                                                                       |
| ------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| `scheduler_tick`                | `tick.ts:101-108`   | `due`, `processed`, `failed`, `retriedNotifications`, `retention`, `batchSize`, `concurrency` |
| `scheduler_loop_error`          | `loop.ts:26-33`     | `message`                                                                                     |
| `monitor_check_failed`          | `tick.ts:64-71`     | `monitorId`, `message`                                                                        |
| `monitor_check`                 | `engine.ts:62-71`   | `monitorId`, `classification`, `isUp`, `responseTimeMs`, `incidentAction`                     |
| `incident_confirmed`            | `engine.ts:72-79`   | `monitorId`, `incidentId`                                                                     |
| `incident_resolved`             | `engine.ts:80-88`   | `monitorId`, `incidentId`, `durationSeconds`                                                  |
| `notification_dispatch_failed`  | `engine.ts:51-59`   | `incidentId`, `message`                                                                       |
| `notification_retry_error`      | `tick.ts:40-46`     | `message`                                                                                     |
| `retention_sweep_error`         | `tick.ts:80-86`     | `message`                                                                                     |
| `heartbeat_registered`          | `register.ts:22-24` | `job`                                                                                         |
| `heartbeat_registration_failed` | `register.ts:26-29` | `job`                                                                                         |

- Les livraisons Telegram (`notification_delivery`) sont documentées dans
  `docs/03-infrastructure/notifications.md`.
- Une limite à connaître : `ping_logs.errorMessage` est du texte d'erreur
  brut (`schema.ts:186`), donc l'émission de l'application — pas un secret,
  mais un chemin à surveiller si un message d'erreur venait à en contenir.

---

## 11. Piloter le pipeline à la main

```bash
TOKEN=$(node scripts/make-cron-token.mjs)
curl -X POST -H "Cookie: app_session_id=$TOKEN" \
     http://localhost:3000/api/scheduled/checks
```

- Le script est un utilitaire **local uniquement** (`scripts/make-cron-token.mjs:1-3`) :
  il signe un JWT `HS256` `{appId, openId: "cron_local_dev"}` avec
  `MANUS_JWT_SECRET`, expiration 1 h (`make-cron-token.mjs:13-17`), et sort si
  `MANUS_JWT_SECRET` ou `MANUS_PROJECT_ID` manque (`:6-11`).
- Réponse du handler (`server/scheduler/routes.ts:31-36`) :

  ```json
  {
    "accepted": true,
    "processed": 3,
    "retriedNotifications": 0,
    "batchSize": 50
  }
  ```

  `processed` = claims gagnés (`tick.ts:75`) ; `retriedNotifications` = lignes
  de livraison reprises (`tick.ts:36-38`) ; `batchSize` = la constante, pas un
  compteur.

- Ce que la route **ne renvoie pas** : `due`, `failed`, `retention` — présents
  dans le résultat interne (`tick.ts:94-100`) mais absents du corps HTTP ; ils
  ne sont observables que dans le log `scheduler_tick`.
- Pour que la réponse ne soit pas `401` (`routes.ts:14-20`,
  `server/scheduler/heartbeatAuth.ts:10-27`) — le contrôle ne consulte **pas**
  la base, c'est un contrôle de signature :
  1. cookie `app_session_id` présent et non vide (`:11`) ;
  2. `MANUS_JWT_SECRET` et `MANUS_PROJECT_ID` non vides côté serveur
     (`:12`, `env.ts:2-9`) ;
  3. JWT validé en `HS256` uniquement, avec le secret comme clé (`:14-18`) ;
  4. `payload.appId === MANUS_PROJECT_ID` (`:20`) ;
  5. `payload.openId` est une chaîne commençant par `cron_` (`:21-22`) — d'où
     le `cron_local_dev` du script.
- Pour que le tick traite réellement quelque chose, il faut en base des lignes
  `monitors` avec `enabled = 1` et `nextCheckAt <= now` (`tick.ts:51`) ; sinon
  `due: 0` et `processed: 0` — un `200` qui ne prouve rien.
- Si la base est indisponible : `503 DATABASE_UNAVAILABLE` (`routes.ts:21-28`) ;
  dans la boucle interne, `runSchedulerTick` lève et l'erreur est loguée en
  `scheduler_loop_error` (`tick.ts:33-34`, `loop.ts:24-33`).
- Même chemin pour la boucle interne : l'appel manuel est strictement
  équivalent à un réveil du cron, ce qui rend le debug reproductible.

---

## 12. Ce qui reste non vérifié

- L'effet réel du cron plateforme sur l'infrastructure managée (le client
  d'enregistrement est `_core/heartbeat.ts`, le service distant n'est pas dans
  le dépôt) : comportement observé en production — non vérifié.
- Le comportement de `timeout` de `http.request` (inactivité socket vs durée
  totale) est documenté par la sémantique Node, pas par une assertion de test
  du dépôt : non vérifié ici.
- `server/checks/engine.ts` n'a pas de fichier de test dédié ; ses chemins sont
  couverts indirectement par `server/incidents/state.test.ts` (décision) et
  `server/checks/client.test.ts` (mesure).
- Le `type` de livraison `"test"` existe dans l'enum (`schema.ts:234-238`) mais
  aucune écriture ne l'utilise : la route de test envoie sans persister de
  ligne (`server/notifications/routes.ts:189-195`).

## 13. Limites assumées

- 50 monitors/minute au total de l'instance, 10 en parallèle : un parc plus
  dense avec des `intervalSeconds` à 300 s nécessite plusieurs passes
  (`tick.ts:17`, `limits.ts:1`).
- La fenêtre de claim de 6 min est un littéral sans nom (`engine.ts:96`) :
  un réglage passe par une modification de code.
- `nextCheckAt` reste à `now + 6 min` si la transaction finale échoue après le
  claim : le monitor se reprend tout seul, mais son rythme est décalé d'autant.
