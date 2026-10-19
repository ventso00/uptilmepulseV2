# Architecture, données et contrat API

## Architecture

Le navigateur consomme des endpoints REST sous `/api` pour les interactions applicatives. Express sert les endpoints HTTP nécessaires à la santé, l’authentification, les monitors et Heartbeat. Drizzle encapsule la base MySQL-compatible managée. Le scheduler appelle `/api/scheduled/checks`, qui sélectionne les monitors dus, exécute un lot borné et persiste ping logs et transitions.

## Tables

Les tables métier sont `users`, `user_credentials`, `sessions`, `plans`, `monitors`, `ping_logs`, `incidents`, `notification_channels`, `notification_deliveries`, `status_pages` et les buckets de rate limit si nécessaires. Le module qualité ajoute `qa_tickets`, `qa_ticket_events` (chronologie à deux visibilités, `public` / `internal`) et `qa_runs` (registre d’idempotence, unique sur `(kind, periodKey)`). La table `plans` porte les quotas éditables du modèle freemium ; `users.planId` (nullable, `NULL` = palier intégré `free`) et `users.trialEndsAt` rattachent un compte à un palier, `monitors.keyword` et `monitors.keywordMode` portent l’assertion de contenu. Les index prioritaires sont `(monitor_id, checked_at DESC)`, `(enabled, next_check_at)`, `(user_id, email_normalized)`, `(expires_at)`, `(user_id, status)` pour la file de tickets et `plans_slug_unique`. `qa_tickets.reporter_token` et `qa_tickets.fingerprint` sont uniques. Les migrations sont additives et versionnées.

## API

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
