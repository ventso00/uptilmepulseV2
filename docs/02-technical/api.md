# Architecture, données et contrat API

## Architecture

Le navigateur consomme des endpoints REST sous `/api` pour les interactions applicatives. Express sert les endpoints HTTP nécessaires à la santé, l’authentification, les monitors et Heartbeat. Drizzle encapsule la base MySQL-compatible managée. Le scheduler appelle `/api/scheduled/checks`, qui sélectionne les monitors dus, exécute un lot borné et persiste ping logs et transitions.

## Tables

**Convention d'écriture à connaître avant d'écrire du SQL.** Le schéma
Drizzle (`shared/db/schema.ts`) nomme ses colonnes en `camelCase` et ne passe
aucun `snake_case` : les colonnes réelles sont donc `checkedAt`, `nextCheckAt`,
`emailNormalized`, `expiresAt`, `reporterToken`, `monitorId`. Le générateur
Drizzle les entoure d'accents graves dans le SQL publié (`shared/db/*.sql`), ce
qui signifie qu'une requête console doit écrire `` `checkedAt` `` ou
`checkedAt`, jamais `checked_at`. Toute copie d'une documentation antérieure au
projet en `snake_case` renverra `Unknown column`.

Les tables métier sont `users`, `user_credentials`, `sessions`, `plans`,
`monitors`, `ping_logs`, `incidents`, `notification_channels`,
`notification_deliveries`, `status_pages`. Le module qualité ajoute
`qa_tickets`, `qa_ticket_events` (chronologie à deux visibilités, `public` /
`internal`) et `qa_runs` (registre d'idempotence). Il n'existe **aucune table de
rate limit** : le compteur est une `Map` en mémoire de processus
(`server/auth/rateLimit.ts:10`, bornée à 10 000 clés), comme le décrit
`security.md`.

`plans` porte les quotas éditables du modèle freemium ; `users.planId`
(nullable, `NULL` = palier intégré `free`) et `users.trialEndsAt` rattachent un
compte à un palier ; `monitors.keyword` et `monitors.keywordMode` portent
l'assertion de contenu. Les index, relevés un à un depuis
`shared/db/schema.ts` :

| Table                     | Index                                          | Colonnes                                   |
| ------------------------- | ---------------------------------------------- | ------------------------------------------ |
| `plans`                   | `plans_slug_unique` (unique)                   | `slug`                                     |
| `plans`                   | `plans_sort_order_idx`                         | `sortOrder`                                |
| `user_credentials`        | `user_credentials_email_unique` (unique)       | `emailNormalized`                          |
| `sessions`                | `sessions_token_hash_unique` (unique)          | `tokenHash`                                |
| `sessions`                | `sessions_user_expiry_idx`                     | `userId`, `expiresAt`                      |
| `monitors`                | `monitors_owner_due_idx`                       | `userId`, `enabled`, `nextCheckAt`         |
| `monitors`                | `monitors_enabled_next_check_idx`              | `enabled`, `nextCheckAt`                   |
| `ping_logs`               | `ping_logs_monitor_checked_idx`                | `monitorId`, `checkedAt` — **sans `DESC`** |
| `incidents`               | `incidents_monitor_status_idx`                 | `monitorId`, `status`                      |
| `notification_channels`   | `notification_channels_user_type_idx`          | `userId`, `type`                           |
| `notification_deliveries` | `notification_deliveries_incident_channel_idx` | `incidentId`, `channelId`                  |
| `notification_deliveries` | `..._incident_channel_type_unique` (unique)    | `incidentId`, `channelId`, `type`          |
| `notification_deliveries` | `notification_deliveries_retry_queue_idx`      | `status`, `createdAt`                      |
| `status_pages`            | contraintes `unique` en colonne                | `userId`, `slug`                           |
| `qa_tickets`              | `qa_tickets_owner_status_idx`                  | `userId`, `status`                         |
| `qa_tickets`              | `qa_tickets_open_idx`                          | `status`, `createdAt`                      |
| `qa_tickets`              | `qa_tickets_source_idx`                        | `source`, `createdAt`                      |
| `qa_tickets`              | contraintes `unique` en colonne                | `reporterToken`, `fingerprint`             |
| `qa_ticket_events`        | `qa_ticket_events_ticket_created_idx`          | `ticketId`, `createdAt`                    |
| `qa_runs`                 | `qa_runs_kind_period_unique` (unique)          | `kind`, `periodKey`                        |

Le `DESC` absent de `ping_logs_monitor_checked_idx` est délibérément non
documenté comme un défaut : MySQL sait parcourir un index B-tree à rebours, et
les lectures d'historique sont triées en SQL. Les migrations sont additives et
versionnées dans `shared/db/` (pas dans un dossier `drizzle/`).

## API

Cette liste est un sommaire. La fiche exhaustive — garde d'accès, clé et
paramètres exacts de rate limit pour chaque route, bornes zod champ par champ,
forme de réponse, table des codes d'erreur et audit du débit — est dans
[`api-http.md`](api-http.md). En cas de divergence, `api-http.md` fait foi parce
qu'il est ancoré ligne par ligne sur les fichiers de route.

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password` — l’inscription est réservée à l’adresse du créateur (`403 REGISTRATION_CLOSED`) et toute route authentifiée refuse un autre compte (`403 ACCESS_RESERVED`) : voir `access-model.md`
- `GET/POST /api/monitors`, `GET/PUT/DELETE /api/monitors/:id`
- `POST /api/monitors/:id/pause`, `POST /api/monitors/:id/resume`
- `GET /api/monitors/:id/history`, `GET /api/monitors/:id/incidents`, `GET /api/dashboard`
- `GET/POST/DELETE /api/notification-channels`, `POST /api/notification-channels/:id/test`
- `GET/PUT/DELETE /api/status-page`, `GET /api/public/status/:slug` (public, rate-limité, `Cache-Control: public, max-age=30`)
- `POST /api/public/qa/tickets` (intake anonyme, honeypot `website`), `GET /api/public/qa/tickets/:token`, `POST /api/public/qa/tickets/:token/messages` (suivi confidentiel du client, jeton 32 hex)
- `GET /api/qa/overview`, `GET /api/qa/tickets`, `GET/PATCH /api/qa/tickets/:id`, `POST /api/qa/tickets/:id/events`, `POST /api/qa/tickets/:id/reply`, `GET /api/qa/digest`, `POST /api/qa/digest/run`, `POST /api/qa/self-tests/run`
- `GET /api/plans` (public, tri par prix croissant avec `free` en tête, paliers `isPublic` uniquement), `GET /api/plan` (le plan effectif du compte signé et sa consommation)
- `GET /api/admin/overview`, `GET/POST /api/admin/plans`, `PUT /api/admin/plans/:id`, `PUT /api/admin/users/:id/plan` (réservé `users.role = 'admin'`, écritures limitées à 60/min par IP)
- `GET /api/health`, `POST /api/scheduled/checks`

Les erreurs utilisent des codes stables et des payloads Zod validés. `UNAUTHORIZED` et `FORBIDDEN` ne révèlent pas si une ressource existe chez un autre utilisateur. Les refus du couche plans sont normalisés par `server/plans/respond.ts` : `QUOTA_EXCEEDED` (409), `FEATURE_UNAVAILABLE` (403) et `VALIDATION_ERROR` (400) avec la borne du plan et la valeur demandée. Les réponses du dashboard et de l’historique sont `private, no-store`.

## Monitors

Quotas, intervalle minimum, timeout maximum et accès à la vérification de contenu sont **lus du plan** du compte (`server/plans/service.ts`), jamais codés en dur : voir `plans-and-billing.md`. La borne technique globale reste un plancher : aucun plan ne peut autoriser un intervalle sous 300 secondes, parce que l’échantillon d’analyse du statut public est dimensionné à partir de cette valeur. Une URL est validée à la création et à la modification ; la résolution DNS et le contrôle de l’adresse réellement utilisée sont répétés au moment du check. Compter puis insérer un moniteur ou un canal se fait dans la même transaction, pour que deux requêtes parallèles ne décrochent pas le même dernier slot.

Un `PUT` ne renvoie aucun défaut : `monitorUpdateSchema` liste ses champs en `.optional()` explicite, parce qu’un `.partial()` de Zod 4 réappliquerait les valeurs par défaut et réinitialiserait intervalle, timeout ou mot-clé à chaque renommage.

## États

Un monitor est `UNKNOWN` avant le premier check, `UP` après un succès stabilisé, `DOWN` après incident confirmé et `PAUSED` lorsque désactivé. Un échec isolé garde un incident suspect interne ; trois échecs consécutifs confirment, deux succès consécutifs résolvent.
