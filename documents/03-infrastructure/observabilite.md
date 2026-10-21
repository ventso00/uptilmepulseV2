# Observabilité

## Ce qui existe, et ce qui n'existe pas

Le projet n'embarque ni APM, ni métriques Prometheus, ni journalisation sur
fichier, ni service de tracing. L'observabilité se réduit à deux canaux, tous
deux sur la sortie standard du processus :

1. des **lignes JSON structurées** portant un champ `event`, émises par le code
   applicatif ;
2. des **lignes libres** (`console.log` / `console.error` non sérialisés)
   réservées au démarrage, à l'erreur terminale et à la sphère plateforme.

Il n'y a pas de niveau de log configurable, pas de filtre, pas de seuil : le
seul tri disponible est le choix de `console.log`, `console.warn` ou
`console.error`, qui détermine le flux (`stdout` ou `stderr`). Rien ne sépare
l'informationnel du diagnostique ailleurs que dans ce choix.

Absence à connaître : **aucune durée de requête n'est journalisée** côté HTTP.
La seule latence mesurée et tracée est celle du check sortant
(`responseTimeMs` dans l'événement `monitor_check`). Un opérateur qui veut des
percentiles de temps de réponse API doit les ajouter, pas les activer.

## Convention

Chaque événement applicatif suit ce motif :

```ts
console.log(JSON.stringify({ event: "nom_evenement", ...champs }));
```

Le nom est en `snake_case`, la ligne tient en une seule ligne physique (les
objets sont compactés par `JSON.stringify`), et `jq` peut la relire sans
prétraitement. Les champs portent systématiquement des **identifiants techniques**
(`monitorId`, `incidentId`, `deliveryId`, `planId`, `actorId`, `targetUserId`) et
des compteurs ou durées. Aucun champ ne porte de jeton, de mot de passe, de
contenu de message ou d'adresse e-mail — voir plus bas la règle appliquée aux
événements d'administration.

## Les vingt-trois événements émis par le code de production

Dénombrement mesuré : 25 sites d'émission, 23 noms distincts
(`notification_delivery` est émis depuis deux endroits selon l'issue).

### Cycle de check — `server/checks/engine.ts`

| Événement                      | Niveau | Émission                     | Champs                                                                    | Ce que ça raconte                                                                                                                                                                                                                                   |
| ------------------------------ | ------ | ---------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `monitor_check`                | log    | `server/checks/engine.ts:65` | `monitorId`, `classification`, `isUp`, `responseTimeMs`, `incidentAction` | La passe d'un moniteur s'est terminée. C'est l'unité de base du diagnostic : `classification` explique la décision, `incidentAction` dit si un incident a été ouvert ou refermé.                                                                    |
| `incident_confirmed`           | log    | `server/checks/engine.ts:75` | `monitorId`, `incidentId`                                                 | Émis seulement quand `incidentAction === "failure"` (`:73`) : le seuil de trois échecs consécutifs est atteint.                                                                                                                                     |
| `incident_resolved`            | log    | `server/checks/engine.ts:83` | `monitorId`, `incidentId`, `durationSeconds`                              | Émis seulement quand `incidentAction === "recovery"` (`:81`). `durationSeconds` est la durée totale de l'incident, pas celle du check.                                                                                                              |
| `notification_dispatch_failed` | error  | `server/checks/engine.ts:54` | `incidentId`, `message`                                                   | L'envoi est laissé flottant (`void dispatchIncidentNotification(...)`, `:41`) et son `catch` a tiré. Ce n'est **pas** une perte d'alerte : la ligne dans `notification_deliveries` est insérée avant l'envoi, donc la passe de reprise la rejouera. |

Le détail de la chronologie claim → check → décision → notification est dans
[`checks.md`](checks.md).

### Tick du scheduler — `server/scheduler/`

| Événement                       | Niveau | Émission                          | Champs                                                                                        | Ce que ça raconte                                                                                                                                          |
| ------------------------------- | ------ | --------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheduler_tick`                | log    | `server/scheduler/tick.ts:103`    | `due`, `processed`, `failed`, `retriedNotifications`, `retention`, `batchSize`, `concurrency` | Le bilan d'une passe. `failed = due.length - processed` (`:98`) : un `processed` nul avec `due` non nul indique des claims perdus, pas une base vide.      |
| `monitor_check_failed`          | error  | `server/scheduler/tick.ts:66`     | `monitorId`, `message`                                                                        | Une exception a traversé la passe d'un moniteur ; le batch continue (`:57`).                                                                               |
| `notification_retry_error`      | warn   | `server/scheduler/tick.ts:42`     | `message`                                                                                     | La reprise des livraisons échouées a levé avant de sélectionner les moniteurs dus. Les checks tournent quand même.                                         |
| `retention_sweep_error`         | warn   | `server/scheduler/tick.ts:82`     | `message`                                                                                     | La purge n'a pas pu s'exécuter : les tables `ping_logs` et `incidents` grossissent au-delà de la fenêtre.                                                  |
| `scheduler_loop_error`          | error  | `server/scheduler/loop.ts:28`     | `message`                                                                                     | La passe complète a levé dans la boucle interne. La boucle n'est pas interrompue : `finally` remet `running` à `false` (`:34-36`), le tick suivant repart. |
| `heartbeat_registered`          | log    | `server/scheduler/register.ts:23` | `job`                                                                                         | Le cron de plateforme a été créé ou retrouvé actif. Émis uniquement si `MANUS_API_URL` et `MANUS_API_KEY` sont présents (`:7`).                            |
| `heartbeat_registration_failed` | warn   | `server/scheduler/register.ts:27` | `job`                                                                                         | L'appel au registre a jeté. Sans ampleur : c'est un `catch` sans paramètre. La boucle interne couvre le besoin réel de tic.                                |

### Notifications — `server/notifications/dispatcher.ts`

| Événement                             | Niveau | Émission                                 | Champs                                       | Ce que ça raconte                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------ | ---------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notification_delivery` (succès)      | log    | `server/notifications/dispatcher.ts:73`  | `deliveryId`, `status: "sent"`, `attempts`   | La livraison a abouti au `attempt`-ième essai de cette passe.                                                                                                                                                                                                                                                                                 |
| `notification_delivery` (échec)       | warn   | `server/notifications/dispatcher.ts:97`  | `deliveryId`, `status: "failed"`, `attempts` | Les trois tentatives de la passe sont épuisées. Le compteur est cumulatif : `previousAttempts + 3` (`:100`), donc ce champ n'est jamais 3 tout seul sauf sur une première passe.                                                                                                                                                              |
| `notification_delivery_insert_failed` | error  | `server/notifications/dispatcher.ts:126` | `incidentId`, `channelId`, `message`         | L'insertion de la ligne de livraison a levé pour autre chose qu'une collision d'unicité ; le `message` vient de `safeErrorMessage`. L'erreur est relancée (`:132`) : c'est le seul endroit où une alerte peut être perdue, et il est bruyant depuis la correction qui refusait d'interpréter une panne de base comme un doublon (`:120-122`). |

### Passe qualité — `server/qa/`

| Événement                   | Niveau | Émission                    | Champs                            | Ce que ça raconte                                                                                                                                |
| --------------------------- | ------ | --------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `qa_self_test`              | log    | `server/qa/selfTest.ts:573` | `periodKey`, `status`, `failures` | L'auto-test du jour a gagné la revendication et s'est terminé. `failures` compte les résultats `!ok` (`:577`).                                   |
| `qa_self_test_ticket_error` | warn   | `server/qa/selfTest.ts:502` | `checkId`, `message`              | L'anomalie détectée n'a pas pu produire de ticket. La passe continue, mais le point ne devient pas vert pour autant (`:497-498`).                |
| `qa_self_test_error`        | warn   | `server/qa/selfTest.ts:583` | `message`                         | Toute la passe a levé. Elle est avalée et renvoie `null` (`:588`) : un auto-test cassé ne doit jamais interrompre les checks.                    |
| `qa_daily_digest`           | log    | `server/qa/digest.ts:388`   | `date`, `status`, `newCount`      | Le point quotidien a été **produit**. Ce n'est pas un envoi : aucun transport n'existe (voir `docs/02-technical/qa-support.md` §7).              |
| `qa_daily_digest_error`     | warn   | `server/qa/digest.ts:397`   | `message`                         | Le point n'a pas pu être calculé. Aucune file d'attente de rattrapage : la journée est perdue jusqu'au prochain tick qui gagne la revendication. |

### Administration — `server/admin/routes.ts`

| Événement             | Niveau | Émission                     | Champs                                             |
| --------------------- | ------ | ---------------------------- | -------------------------------------------------- |
| `admin_plan_created`  | log    | `server/admin/routes.ts:346` | `actorId`, `planId`, `slug`                        |
| `admin_plan_updated`  | log    | `server/admin/routes.ts:437` | `actorId`, `planId`, `slug`                        |
| `admin_plan_assigned` | log    | `server/admin/routes.ts:505` | `actorId`, `targetUserId`, `planSlug`, `trialDays` |

La règle de confidentialité y est appliquée par construction : un changement de
palier affecte un utilisateur, et le log ne porte que `targetUserId`. L'adresse
e-mail affectée n'apparaît jamais dans la ligne, pas plus que le contenu d'un
palier. `slug` est présent parce qu'il est une clé métier, non une donnée
personnelle.

### HTTP — `server/_core/http.ts`

| Événement                 | Niveau | Émission                   | Champs                      | Réponse envoyée                     |
| ------------------------- | ------ | -------------------------- | --------------------------- | ----------------------------------- |
| `database_error`          | error  | `server/_core/http.ts:153` | `path`, `code`, `message`   | `503 DATABASE_UNAVAILABLE` (`:159`) |
| `unhandled_request_error` | error  | `server/_core/http.ts:164` | `method`, `path`, `message` | `500 INTERNAL_ERROR` (`:170`)       |

La classification `database_error` repose sur une liste blanche de six codes
(`ECONNREFUSED`, `ETIMEDOUT`, `PROTOCOL_CONNECTION_LOST`,
`ER_ACCESS_DENIED_ERROR`, `ENOTFOUND`, `ER_BAD_DB_ERROR` —
`server/_core/http.ts:98-104`), testée par `isDatabaseError` (`:107-109`).
`isDatabaseError` ne lit pas `.code` sur l'erreur jetée mais le code renvoyé par
`driverErrorCode` (`server/_core/db-error.ts:17`), qui descend la chaîne des
`.cause` jusqu'à cinq niveaux : Drizzle (0.44.6) enveloppe chaque requête échouée
dans un `DrizzleQueryError` dont le `message` est le SQL et ses valeurs liées,
qui porte l'erreur du pilote sur `.cause` et qui n'a **aucun `.code` propre**.
Avant ce déballage, un test `error.code === …` ne correspondait à rien et une
panne de pool répondait `500 INTERNAL_ERROR` au lieu de `503 DATABASE_UNAVAILABLE`.
Un échec dont le code — une fois déballé — n'est pas dans la liste tombe dans
`unhandled_request_error` et renvoie un `500` : la distinction 503/500 reste donc
un indicateur de « le pool est injoignable » plutôt que de « la base a répondu
une erreur ».

Règle à retenir, une fois pour toutes : **toute ligne de log bâtie à partir d'une
erreur de base passe par `safeErrorMessage`** (`server/_core/db-error.ts:47`). Le
champ `message` des deux événements HTTP est calculé une seule fois
(`server/_core/http.ts:137`) par cet appel : pour une enveloppe de requête il
retourne le message du pilote (le `.cause`), sinon le message de l'erreur, sinon
un repli — jamais le texte SQL. Le `code` journalisé vient de `driverErrorCode`
(`server/_core/http.ts:155`). C'est ce qui garde les hachures de mot de passe et
les tokens Telegram chiffrés, qui transitent par ces mêmes insertions, hors des
logs ; le corps de réponse, lui, reste générique.

## Les lignes libres, et pourquoi elles dérogent

Seize sites n'émettent pas de champ `event`. Ils se répartissent en trois
familles, et ce sont des zones volontaires plutôt que des oublis :

**Démarrage et mort du processus** — ces lignes précèdent ou suivent tout
état structuré, et n'ont donc pas de contexte à sérialiser :

- `Server listening on port ${port}` (`server/_core/index.ts:92`) : le seul
  témoin visuel que le bind a réussi, émis juste avant
  `ensureHeartbeatJob()` et `startInternalScheduler()` (`:93-94`) ;
- `Server failed:` + message (`server/_core/index.ts:88`) suivi de
  `process.exit(1)` (`:89`) — une erreur d'écoute est terminale ;
- la trace complète en cas d'échec de `startServer()`
  (`server/_core/index.ts:99-100`) : c'est le seul `console.error(error)` brut du
  point d'entrée.

**Base de données** — `server/db.ts` préfère la dégradation silencieuse à
l'exception, donc les trois lignes sont le seul signe visible :

- `[Database] Failed to connect:` (`server/db.ts:39`) puis remise de `_db` à
  `null` (`:40`) ;
- `[Database] Failed to upsert user:` (`server/db.ts:99`) — relancée ensuite
  (`:100`) ;
- `[Database] Cannot get user: database not available` (`server/db.ts:107`).

**Sphère plateforme et développement** — hors du périmètre produit :
les six lignes d'`server/_core/sdk.ts` (`:38` `[OAuth] Initialized with
baseURL:`, `:40`, `:209`, `:226`, `:236`, `:318`), les deux lignes de
`server/_core/notification.ts` (`:99`, `:109`), l'erreur de
`server/_core/oauth.ts:75`, et le `console.error` de
`server/_core/static.ts:10-13` quand le dossier de build est absent.

Le point pratique pour un opérateur : **filtrer sur `event:` ne couvre pas tout**.
Un `Could not find the build directory` ou un `[Database] Failed to connect` ne
remontent jamais dans une recherche d'événements structurés.

## Les erreurs qui ne sont jamais journalisées

Trois cas, tous délibérés, à connaître pour ne pas chercher un log qui n'existe
pas :

- le préflight du moniteur refusé par la liste SSRF : `validateUrlSyntax` lève
  `TargetValidationError` (`server/monitors/ssrf.ts:67-127`), la route la
  reconvertit en réponse (`server/monitors/routes.ts:100`) et aucune ligne
  n'est écrite côté serveur ;
- un appel de rate limit refusé : `sendError(res, 429, "RATE_LIMITED", ...)`
  sans journalisation, par exemple `server/monitors/routes.ts:114-121` (six
  fichiers de route répètent ce motif) ;
- une revendication de passe qualité déjà gagnée : `claimRun` reconnaît un
  doublon via `isDuplicateKeyError` (`server/qa/runs.ts:25`) et renvoie `null`,
  et l'appelant s'arrête là (`server/qa/digest.ts:223-224`). Un second exemplaire
  passe donc son tour en silence, sans journaliser `qa_self_test_error`. Le
  trente-ième tick du jour ne produit ainsi aucun bruit, et aucun signe non plus :
  l'absence de point du jour ne se lit que dans `qa_runs`.

## Les lire en pratique

Aucune de ces lignes n'est routée ailleurs que vers la sortie du processus.
Selon l'exécution :

```bash
# dev : directement dans le terminal
pnpm dev 2>&1 | grep -o '"event":"[^"]*"' | sort | uniq -c

# conteneur
docker logs uptimepulse 2>&1 | grep -o '"event":"[^"]*"' | sort | uniq -c

# un tick complet, déballé
docker logs uptimepulse 2>&1 | grep '"event":"scheduler_tick"' | tail -1 | jq .
```

`jq` suppose que les lignes ne sont pas tronquées : la limite de 500 caractères
s'applique au champ `lastError` écrit **en base** par
`server/notifications/dispatcher.ts:82-84` (`safeErrorMessage`, puis coupe à 500
caractères), pas aux logs, qui portent le message entier du tiers.

## Point de santé

`GET /api/health` répond `{ status: "ok" }` avec `Cache-Control: no-store`
(`server/_core/index.ts:41-44`). C'est une vérification de processus, pas de
dépendance : l'endpoint ne touche ni la base, ni DNS, ni Telegram. Un conteneur
peut donc être « healthy » alors qu'aucun check ne part. Le `HEALTHCHECK` de
l'image Docker teste exactement ce signal, et rien d'autre
(`Dockerfile:45-46`).

La page publique `/api/platform/config.js` est dans le même registre : elle
n'expose que les quatre valeurs destinées au navigateur
(`server/_core/publicConfig.ts:3-9`), avec échappement de `<` en `\u003c` pour
empêcher la sortie de balise (`server/_core/publicConfig.ts:15-17`).

## Ce qu'il faudrait ajouter pour une vraie observabilité

Liste non exhaustive, par ordre d'utilité pour ce produit, et sans engagement :

1. une durée pour `scheduler_tick` et pour les checks — aujourd'hui, `due` et
   `processed` ne disent pas si une passe est lente ;
2. un compteur de `429` par clé, sinon l'effet du `MAX_BUCKETS = 10_000`
   (`server/auth/rateLimit.ts:10`, balayage + éviction FIFO `:17-31`) reste
   invisible ;
3. la journalisation du nombre de lignes supprimées par la purge de rétention en
   dehors du champ `retention` du tick ;
4. un compteur des `heartbeat_registration_failed`, parce que le warn n'a aucune
   portée et que l'absence de cron de plateforme ne se voit que si on cherche la
   boucle interne.
