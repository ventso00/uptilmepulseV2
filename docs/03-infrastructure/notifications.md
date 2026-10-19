# Notifications — le seul canal qui existe

Fichiers couverts : `server/notifications/{dispatcher,telegram,crypto,routes}.ts`,
`shared/db/schema.ts` (tables `notification_channels`, `notification_deliveries`),
`shared/contracts.ts`, `server/checks/engine.ts`, `server/scheduler/tick.ts`.

---

## 1. Périmètre, dit honnêtement

| Canal                 | Statut réel               |
| --------------------- | ------------------------- |
| Telegram              | **seul canal implémenté** |
| E-mail                | inexistant                |
| Webhook générique     | inexistant                |
| Slack / Discord / SMS | inexistants               |

- `notificationChannelTypeValues = ["telegram"]` : l'enum MySQL ne connaît
  qu'une valeur (`shared/db/schema.ts:233`), et le contrat de réponse le répète
  (`shared/contracts.ts:307`, `z.enum(["telegram"])`).
- « Canal » est donc **une interface avec un seul implémenteur, pas une
  promesse** : la branche de dispatch est un test littéral
  `channel.type === "telegram" ? decryptTelegramConfig(...) : null`, et `null`
  lève `Unsupported notification channel`
  (`server/notifications/dispatcher.ts:57-61`). Il n'y a pas de registre, pas de
  typage d'adaptateur, pas de second constructeur.
- L'envoi est codé en dur sur Telegram : `sendTelegramMessage` est le seul
  émetteur appelé, tant pour une alerte (`dispatcher.ts:61`) que pour le test
  manuel (`server/notifications/routes.ts:191`).
- Le schéma chiffré lui-même est Telegram-spécifique :
  `{ botToken, chatId }` (`server/notifications/crypto.ts:11`), et la route
  d'ajout n'accepte que `type: "telegram"` (`routes.ts:15-19`).
- Un 3ᵉ type de livraison `"test"` existe dans l'enum
  (`shared/db/schema.ts:234-238`) : **aucune ligne n'est jamais écrite avec
  cette valeur**. La route de test envoie sans persister (`routes.ts:189-195`),
  et la reprise ignore tout type autre que `failure`/`recovery`
  (`dispatcher.ts:216-217`). Valeur morte, non vérifié : aucune migration ne la
  supprime.

---

## 2. Le secret au repos

### 2.1 Chiffrement

| Élément                | Valeur                                    | Citation                    |
| ---------------------- | ----------------------------------------- | --------------------------- |
| Algorithme             | `aes-256-gcm`                             | `notifications/crypto.ts:8` |
| Version d'enveloppe    | `v1`                                      | `crypto.ts:9`               |
| Clé                    | SHA-256 de la chaîne d'environnement      | `crypto.ts:17`              |
| Variable               | `UPTIMEPULSE_ENCRYPTION_KEY` (nom seul)   | `crypto.ts:14`              |
| Plancher de longueur   | 16 caractères, sinon `throw`              | `crypto.ts:15-16`           |
| IV                     | 12 octets aléatoires **par chiffrement**  | `crypto.ts:21`              |
| Tag d'authentification | `cipher.getAuthTag()`                     | `crypto.ts:27`              |
| Enveloppe              | `v1.<iv>.<tag>.<ciphertext>` en base64url | `crypto.ts:28-33`           |
| Colonne                | `configurationEncrypted` (`text`)         | `schema.ts:253`             |

- La clé n'est **pas** une clé brute : `UPTIMEPULSE_ENCRYPTION_KEY` est hachée
  en SHA-256 pour tenir 32 octets (`crypto.ts:17`). Conséquence : une clé de 16
  caractères est acceptée mais réduite à un dérivé fixe ; aucun sel, aucun KDF à
  coût (pas de scrypt/PBKDF2) — la force de la clé au repos vaut celle de la
  chaîne d'environnement.
- Le `throw` de `getKey()` (« `Encryption key is not configured` »,
  `crypto.ts:16`) est levé **à l'usage**, `getKey` n'étant appelé que depuis
  `encryptTelegramConfig` (`:22`) et `decryptTelegramConfig` (`:44`) : une
  instance sans clé démarre, puis échoue à la création ou à l'envoi d'un canal.
- L'enveloppe est segmentée par `payload.split(".")` : une version autre que
  `v1`, ou un segment manquant, lève `Encrypted configuration is invalid`
  (`crypto.ts:37-40`).
- Le tag est imposé avant le flux (`crypto.ts:46`) et `decipher.final()`
  authentifie le chiffré (`crypto.ts:47-50`) : une ligne altérée, tronquée ou
  réordonnée lève, elle ne se déchiffre jamais « à peu près ».
- Validation **après** déchiffrement, jamais à l'aveugle : `JSON.parse`, puis
  `botToken` chaîne de ≥ 10 caractères et `chatId` chaîne non vide, sinon
  `Telegram configuration is invalid` (`crypto.ts:51-59`).

### 2.2 Rotation de la clé

- La clé dérivée n'est stockée nulle part : la re-deriver à partir de
  l'environnement est le seul mécanisme (`crypto.ts:13-18`).
- **Changer `UPTIMEPULSE_ENCRYPTION_KEY` rend illisibles tous les tokens déjà
  en base.** L'IV et le tag sont dans la ligne, mais le GCM échoue à
  s'authentifier avec une autre clé : `decryptTelegramConfig` lève
  (`crypto.ts:41-50`).
- Effet observable : chaque livraison retombe dans le `catch` de la boucle
  d'envoi et écrit `status: "failed"` + `lastError`
  (`dispatcher.ts:57-60`, `:80-93`) ; la route de test répond
  `502 DELIVERY_FAILED` (`routes.ts:189-203`). Rien n'auto-répare : il faut
  recréer le canal avec le token en clair.
- Une rotation propre exige donc de re-saisir chaque canal. Déroulement
  documenté ailleurs — non vérifié : le dépôt ne contient pas d'utilitaire de
  rotation.

---

## 3. Ce qui déclenche un envoi

- Un seul appelant de `dispatchIncidentNotification` : le moteur de check, et
  seulement quand `incidentAction !== "none"`
  (`server/checks/engine.ts:36-40`).
- `incidentAction` ne vaut `"failure"` que sur une transition `confirmed`, et
  `"recovery"` que sur une transition `resolved`
  (`engine.ts:172`, `:194`, `:213`).

| Transition d'incident                               | Notification |
| --------------------------------------------------- | ------------ |
| `suspect_started` (1ᵉʳ échec)                       | **aucune**   |
| `confirmed` (3ᵉ échec consécutif)                   | `failure`    |
| `suspect_resolved` (un incident suspect refermé)    | **aucune**   |
| `resolved` (2 succès consécutifs après `confirmed`) | `recovery`   |

- Seuils : `INCIDENT_RULES = { failureThreshold: 3, recoveryThreshold: 2 }`
  (`shared/contracts.ts:69-73`), appliqués par `server/incidents/state.ts:43-61`
  et `:79-81`. Un état `suspect` n'émet **jamais** rien — c'est ce qui évite
  d'alerter sur un pic réseau isolé.
- L'envoi est **fire-and-forget** : `void dispatchIncidentNotification(...)`
  (`engine.ts:40`) car jusqu'à trois allers-retours Telegram par canal
  immobiliseraient le slot du scheduler ; les lignes de livraison sont écrites
  avant l'envoi, donc la passe de reprise ramasse ce qui échoue là
  (`engine.ts:36-39`).

### 3.1 Message exact

`formatMessage` (`server/notifications/dispatcher.ts:29-44`), lignes jointes par
`\n` (`:42`) :

| #   | Ligne                                                                | Source          |
| --- | -------------------------------------------------------------------- | --------------- |
| 1   | `UptimePulse — Incident confirmé` ou `UptimePulse — Service rétabli` | `:29-30`, `:32` |
| 2   | `Monitor : <nom>`                                                    | `:33`           |
| 3   | `URL : <url du monitor>`                                             | `:34`           |
| 4   | `Classification : <classification du check>`                         | `:35`           |
| 5   | `Code HTTP : <code>` ou `—`                                          | `:36`           |
| 6   | `Temps de réponse : <n> ms` ou `—`                                   | `:37`           |
| 7   | `Détection : <ISO 8601>`                                             | `:38`           |
| 8   | `Durée de l’incident : <n> s` — **uniquement en rétablissement**     | `:40-41`        |

- Ligne 8 absente en `failure` ; en reprise, la durée vient de la ligne
  d'incident (`dispatcher.ts:239`).
- En reprise (`retryFailedNotificationDeliveries`), le `Code HTTP`, le temps et
  la classification sont relus depuis **le dernier `ping_logs` du monitor**
  (`dispatcher.ts:218-224`, `:235-237`) et `Détection` vaut
  `confirmedAt ?? startedAt` (`:238`) : le message rejoué peut donc différer du
  message original si d'autres checks sont passés entre-temps. C'est un choix
  du code, pas une dérive.
- Message de test : `UptimePulse — notification de test réussie.`
  (`routes.ts:193`), sans persistance.

### 3.2 Transport

- Un seul aller simple : `POST https://api.telegram.org/bot<token>/sendMessage`
  (`telegram.ts:13-14`), le token passé **dans le chemin**, encodé
  (`encodeURIComponent`).
- Corps JSON : `chat_id`, `text`, `disable_web_page_preview: true`
  (`telegram.ts:21-25`) ; aucun Markdown/HTML n'est demandé, donc le texte est
  brut.
- Délai : 8 s puis `AbortController.abort()` (`telegram.ts:10-11`), `clearTimeout`
  dans le `finally` (`telegram.ts:33-35`).
- Succès = `response.ok` ; tout autre statut lève
  `Telegram delivery failed with status <code>` (`telegram.ts:29-32`).

---

## 4. Idempotence : pas de double avertissement

- Index unique : `notification_deliveries_incident_channel_type_unique` sur
  `(incidentId, channelId, type)` (`shared/db/schema.ts:291-293`).
- Garantie : deux ticks concurrents, ou cron externe + boucle interne, ne
  peuvent pas créer deux avertissements pour le même incident sur le même canal
  — la seconde insertion heurte l'index.
- Insertion : `status: "pending"`, `attempts: 0`
  (`dispatcher.ts:111-117`), **avant** tout envoi — la file existe donc même si
  le process meurt dans la seconde.
- Conflit de clé : `isDuplicateKeyError` ne vit plus dans `dispatcher.ts`, il est
  partagé dans `server/_core/db-error.ts:26`. L'erreur jetée est une enveloppe de
  requête (`DrizzleQueryError`, Drizzle 0.44.6) : son `message` porte le SQL et
  ses valeurs liées, elle n'a **aucun `.code` propre**, et l'authentique erreur
  du pilote est sur `.cause` — le test historique `error.code === "ER_DUP_ENTRY"`
  ne se déclenchait donc jamais. `isDuplicateKeyError` descend la chaîne des
  `.cause` jusqu'à cinq niveaux (la marche `driverErrorCode`, `db-error.ts:17`)
  et reconnaît `ER_DUP_ENTRY` (MySQL) ou le code `23505` (`db-error.ts:29`) sur
  n'importe quel niveau, ou un message contenant `Duplicate entry` porté par un
  niveau qui n'est pas lui-même une enveloppe de requête (`db-error.ts:31-37`) ;
  c'est là que l'aplatissement par les drivers/proxies reste couvert. La même
  fonction sert à `server/qa/runs.ts:25`, `server/statuspages/routes.ts:126` et
  ici.
- Reprise sur la ligne existante : re-sélection par le triplet
  (`dispatcher.ts:134-144`), puis :
  - `status === "sent"` → `null`, on n'envoie **pas** deux fois (`:145`) ;
  - `pending` ou `failed` → l'id de la ligne est renvoyé et l'envoi reprend
    dessus (`:146`, puis `dispatcher.ts:165-167`).
- Distinction importante : seuls les conflits d'unicité sont traités comme
  « déjà en file ». Toute autre erreur d'insertion est journalisée
  `notification_delivery_insert_failed` **puis relancée**
  (`dispatcher.ts:123-133`) : avaler une panne de base l'aurait confondue avec
  un dédupissage réussi et l'alerte était perdue en silence (commentaire
  `:120-122`).
- Un incident peut donc produire au plus : 1 ligne `failure` + 1 ligne
  `recovery` par canal.
- Faiblesse assumée : `dispatchIncidentNotification` écrivant la ligne
  lui-même (`dispatcher.ts:165`), si le process meurt entre la transaction de
  confirmation (`engine.ts:185-194`) et l'insertion, aucune ligne n'existe — la
  reprise ne peut rien rejouer. Non vérifié : aucun mécanisme de rattrapage de
  ce cas.

---

## 5. La file de retry

- Point d'entrée : `retryFailedNotificationDeliveries()` appelé **en tête de
  chaque passe** du tick, avant la sélection des monitors
  (`server/scheduler/tick.ts:37-39`) ; ses échecs sont journalisés
  `notification_retry_error` sans bloquer les checks (`tick.ts:39-46`).
- Signature et bornes (`dispatcher.ts:183-212`) :

| Paramètre                         | Valeur                         | Citation                                                   |
| --------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| lot                               | 20 lignes                      | `dispatcher.ts:184` (`limit = 20`), `.limit(limit)` `:212` |
| âge minimum d'une ligne `pending` | 60 s                           | `dispatcher.ts:188`, `:207-210`                            |
| lignes `failed`                   | reprises sans condition d'âge  | `dispatcher.ts:205`                                        |
| jointures                         | canal + incident + monitor     | `dispatcher.ts:197-202`                                    |
| types ignorés                     | tout sauf `failure`/`recovery` | `dispatcher.ts:216-217`                                    |
| aucune borne sur `attempts`       | reprise infinie                | `dispatcher.ts:203-212`                                    |

- Le filtre est `status = 'failed' OR (status = 'pending' AND createdAt <
now − 60 s)` (`dispatcher.ts:203-211`) : le plancher de 60 s sur `pending`
  évite de doubler un envoi encore en vol (le premier essai synchrone peut
  durer 3 × 8 s, `telegram.ts:11`).
- Trois tentatives **dans la même passe** : `for (let offset = 1; offset <= 3;
offset += 1)` (`dispatcher.ts:53`), autour du même
  `sendTelegramMessage` (`:61`).
- Le compteur **s'accumule entre les passes** : `attempt = previousAttempts +
offset` (`dispatcher.ts:54`), et `previousAttempts` est l'`attempts` lu de la
  ligne (`dispatcher.ts:241`) ; il est réécrit à chaque issue (`:68` en succès,
  `:89` en échec). Un premier envoi synchrone part de `0`
  (`dispatcher.ts:50`, défaut `previousAttempts = 0`).
- Ce que ça implique : après une passe entièrement échouée, `attempts` vaut
  déjà 3 ; la passe suivante écrira 4, 5, 6. Il n'y a pas de plafond dans la
  requête (`:203-212`), donc une livraison condamnée est rejouée à chaque tick
  (toutes les 30 s avec la boucle interne, `loop.ts:18`) jusqu'à suppression ou
  succès.
- **Invariant d'auto-test** : `MAX_ATTEMPTS_BEFORE_EXHAUSTED = 3`
  (`server/qa/selfTest.ts:37`) sélectionne `status = 'failed' AND attempts >= 3`
  (`selfTest.ts:284-287`). Il sonne donc **dès la première passe entièrement
  échouée** — ce n'est pas « trois passes ratées », c'est « trois tentatives
  consommées », et une seule passe les consomme (`dispatcher.ts:53-54`).
  L'invariant ouvre un ticket P3 « Tentatives de notification épuisées »
  (`selfTest.ts:272-275`).

---

## 6. `lastError` : ce qui est stocké, et le point de vigilance

- Écriture : `error.message` → sauts de ligne remplacés par un espace → coupe à
  **500 caractères** (`server/notifications/dispatcher.ts:81-84`) ; colonne
  `varchar(500)` (`shared/db/schema.ts:281`), remis à `null` en cas de succès
  (`dispatcher.ts:68`).
- Source des messages : soit `Telegram delivery failed with status <code>`
  (`server/notifications/telegram.ts:30-31`), soit l'erreur du `fetch` lui-même
  (abort, DNS, TLS), soit une erreur de déchiffrement
  (`notifications/crypto.ts:40`, `:58`).
- Le `fetch` dont l'URL **porte le `botToken`** (`telegram.ts:14`) est donc
  l'erreur qui alimente `lastError` (`dispatcher.ts:82`).
- **Pourquoi rien ne fuit aujourd'hui** :
  1. le seul message fabriqué par le code est le statut HTTP, sans URL
     (`telegram.ts:29-32`) ;
  2. Node n'inclut pas l'URL dans `error.message` d'un `fetch` en échec — le
     message reste du type `fetch failed` / `This operation was aborted`
     (sémantique Node, **non assertie par un test du dépôt** : non vérifié
     ici) ;
  3. aucune ligne du pipeline n'ajoute l'URL au message
     (`telegram.ts:13-32`, `dispatcher.ts:80-93`).
- **Pourquoi c'est un point de vigilance permanent** : la protection repose
  sur une coïncidence d'implémentation (deux messages fabriqués à la main + le
  comportement de `undici`), pas sur une politique. Un `console`/`interceptor`,
  un `cause` remonté (`error.cause?.message`), un `String(error)` sur un objet
  d'erreur enrichi, ou un `fetch` qui echoit sa requête écriraient le token
  dans une colonne lue par l'API et par les exports. Le même chemin expose
  `attempts` et `status` (`schema.ts:280-284`), donc la table est une surface
  de lecture de secrets potentiels.
- Aucune requête de l'application n'expose `lastError` au client : le champ
  n'est ni sélectionné (`routes.ts:54-60`) ni sérialisé
  (`contracts.ts:305-311`). Non vérifié : l'absence de lecture via un `SELECT *`
  d'un futur endpoint.

---

## 7. Routes de canal

| Route                                      | Rôle                    | Limites    | Citations           |
| ------------------------------------------ | ----------------------- | ---------- | ------------------- |
| `GET /api/notification-channels`           | liste sans le chiffré   | —          | `routes.ts:40-66`   |
| `POST /api/notification-channels`          | créer un canal Telegram | 5 / 15 min | `routes.ts:68-126`  |
| `POST /api/notification-channels/:id/test` | envoi de test           | 3 / 15 min | `routes.ts:158-205` |
| `DELETE /api/notification-channels/:id`    | supprimer               | aucune     | `routes.ts:128-156` |

- Toutes exigent `requireUser` (`routes.ts:43`, `:71`, `:131`, `:161`) : pas de
  route publique, pas de route machine.
- Bornes zod du corps (`routes.ts:15-19`) :

| Champ      | Règle                 | Citation       |
| ---------- | --------------------- | -------------- |
| `type`     | `"telegram"` littéral | `routes.ts:16` |
| `botToken` | `trim()`, 10 → 512    | `routes.ts:17` |
| `chatId`   | `trim()`, 1 → 128     | `routes.ts:18` |

- Le `trim()` est délibéré : un espace collé au collage d'un token ferait
  échouer au moment de l'usage plutôt que la création
  (`routes.ts:13-14`). Corps invalide → `400 VALIDATION_ERROR` (`:75-82`), sans
  message zod détaillé (pas de fuite de contrainte).
- Quota : `count` + `insert` dans **une seule transaction** pour que deux
  requêtes parallèles ne lisent pas le même slot libre (`routes.ts:96-112`),
  borné par `assertChannelQuota(plan, total)` (`:104`,
  `server/plans/service.ts:146-158`) ; `plan.maxChannels` est lui-même borné
  1 → 50 (`shared/contracts.ts:940`). Dépassement → erreur plan traduite par
  `respondPlanError` (`routes.ts:113-116`).
- Réponse `201` : `{ channel: { id, type, enabled } }` — jamais le token,
  jamais le chiffré (`routes.ts:118-124`).
- `GET` : sélection explicite de `id/type/enabled/createdAt/updatedAt`
  (`routes.ts:54-60`), donc `configurationEncrypted` ne quitte jamais la base
  (`:253`), et `Cache-Control: private, no-store` (`:63`).
- `DELETE` : suppression scopée `id` + `userId` (`routes.ts:144-151`),
  `404 NOT_FOUND` si 0 ligne (`:152-153`), `204` sinon (`:154`). Un canal
  supprimé cascade sur ses livraisons (`schema.ts:273-275`).
- `TEST` : exige un canal **activé** appartenant à l'utilisateur
  (`routes.ts:176-188`), déchiffre, envoie (`:190-194`) ; tout échec est ramené
  à un seul `502 DELIVERY_FAILED` sans motif (`:196-203`) — le `catch` jette le
  détail, qui n'est lisible que dans `lastError` des livraisons d'incident.
- Limites de débit (`routes.ts:21-37`) : clés `channel:{userId}` 5 / 900 000 ms
  (`:73`) et `channel-test:{userId}` 3 / 900 000 ms (`:163`) ; refus →
  `429 RATE_LIMITED` avec `retryAfterSeconds` (`:29-35`).
- Nature du limiteur : buckets **en mémoire par process**
  (`server/auth/rateLimit.ts:3`), fenêtre glissante à partir du premier
  appel (`:41-43`), carte bornée à 10 000 clés avec purge opportuniste
  (`:10`, `:17-31`). Il ne survit donc pas à un redémarrage et n'est pas partagé
  entre instances.
- Le routeur est branché au boot HTTP (`server/_core/index.ts:56`), dans le
  même enfilement que les routes de scheduler.

---

## 8. Événements journalisés et observation d'un échec

| Événement                             | Niveau  | Émetteur                | Contenu                                                     |
| ------------------------------------- | ------- | ----------------------- | ----------------------------------------------------------- |
| `notification_delivery` (succès)      | `log`   | `dispatcher.ts:71-78`   | `deliveryId`, `status:"sent"`, `attempts`                   |
| `notification_delivery` (échec)       | `warn`  | `dispatcher.ts:95-102`  | `deliveryId`, `status:"failed"`, `attempts` (=`previous+3`) |
| `notification_delivery_insert_failed` | `error` | `dispatcher.ts:136-143` | `incidentId`, `channelId`, `message`                        |
| `notification_dispatch_failed`        | `error` | `engine.ts:51-59`       | `incidentId`, `message`                                     |
| `notification_retry_error`            | `warn`  | `tick.ts:40-46`         | `message`                                                   |

- Règle de discrétion : ces objets ne contiennent que des identifiants
  numériques, un statut et un `error.message`. Ni le token, ni le `chatId`, ni
  le texte du message, ni l'e-mail d'un utilisateur ne passent par un `console`
  du module (`dispatcher.ts:71-78`, `:95-102`, `:136-143`) ; le texte n'est
  jamais journalisé, il n'existe qu'en argument de `sendTelegramMessage`
  (`:61`).
- Les mêmes réserves que §6 s'appliquent au champ `message` : c'est un
  `error.message` brut, donc une surface à surveiller, pas une garantie.

Comment observer un échec d'envoi, dans l'ordre pratique :

1. Les logs JSON : filtrer `notification_delivery` avec `"status":"failed"`
   (`dispatcher.ts:95-102`) — le `warn` est l'unique signal temps réel, car
   `dispatchIncidentNotification` n'attend pas le résultat côté requête
   (`engine.ts:40`).
2. La table : `notification_deliveries` (`status`, `attempts`, `lastError`,
   `sentAt`, `createdAt`, `updatedAt`) (`shared/db/schema.ts:266-285`) —
   `lastError` donne le motif tronqué à 500 caractères
   (`dispatcher.ts:81-84`).
3. La file qui ne se vide pas : `status = 'failed'` et `attempts` qui croît de
   3 par passe signale une cause durable (canal révoqué, clé tournée,
   `chatId` invalide) (`dispatcher.ts:54`, `:203-212`).
4. L'auto-test QA : invariant `notification_exhausted` (`server/qa/selfTest.ts:273-304`),
   qui ouvre un ticket P3 — c'est le seul chemin par lequel un échec remonte
   jusqu'à l'interface d'exploitation.
5. La route de test : `POST /api/notification-channels/:id/test` (`routes.ts:158`)
   confirme en direct si un canal est vivant, au prix d'un message réel dans la
   conversation Telegram (`:191-194`).

- Surface manquante : `listNotificationDeliveries(incidentId)` existe
  (`dispatcher.ts:248-255`) mais **n'a aucun appelant** dans `server/` et
  `client/` (vérifié par recherche) — l'API n'expose ni l'historique ni l'état
  des livraisons à l'utilisateur. Il n'y a pas non plus de route de retry
  manuelle ni de réactivation d'une ligne `failed`.

## 9. Non vérifié

- Comportement exact des messages d'erreur `fetch` de Node en dehors des trois
  cas cités en §6 (assertion de test absente).
- Effet réel d'un Telegram `429` côté plateforme : le code ne le distingue
  d'aucun autre statut, il ne lit ni `retry_after` ni le corps
  (`telegram.ts:29-32`) — un backoff spécifique à Telegram n'existe pas.
- Deliverability multi-comptes : le dispatch filtre les canaux par
  `event.userId` (`dispatcher.ts:167-175`), donc un moniteur hébergé par un
  autre compte n'alerte pas ; politique produit à confirmer.
