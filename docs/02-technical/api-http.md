# Référence API HTTP

> Page de référence exhaustive : chaque route, chaque garde, chaque borne
> zod, chaque code d'erreur, avec la ligne du dépôt qui la fonde. Les
> citations `fichier:ligne` renvoient aux fichiers réels, relus un à un ;
> la liste succincte de `docs/02-technical/api.md` est dépassée sur
> plusieurs points (elle omet notamment `POST /api/monitors/:id/check`,
> `GET /api/plans`, et documente pause/resume sans le garde-fou réel).

Sources reluées intégralement : `server/_core/index.ts`, `server/_core/http.ts`,
`server/_core/trpc.ts`, `server/_core/systemRouter.ts`, `server/_core/oauth.ts`,
`server/_core/context.ts`, `server/_core/sdk.ts`, `server/_core/env.ts`,
`server/_core/publicConfig.ts`, `server/auth/routes.ts`, `server/auth/session.ts`,
`server/auth/rateLimit.ts`, `server/auth/owner.ts`, `server/monitors/routes.ts`,
`server/monitors/ssrf.ts`, `server/notifications/routes.ts`,
`server/statuspages/routes.ts`, `server/qa/routes.ts`, `server/qa/tickets.ts`,
`server/admin/routes.ts`, `server/routes/dashboard.ts`,
`server/scheduler/routes.ts`, `server/scheduler/heartbeatAuth.ts`,
`server/scheduler/register.ts`, `server/scheduler/limits.ts`,
`server/plans/service.ts`, `server/plans/respond.ts`, `server/routers.ts`,
`shared/contracts.ts`, `shared/const.ts`, `client/src/main.tsx`.

Total documenté : **47 endpoints HTTP** (dont `GET
/api/oauth/callback`, dormant, détaillé au §6) + le montage tRPC
(2 procédures).

---

## 1. Enveloppe commune

### 1.1 `sendError` — forme de toute erreur

`res.status(status).json({ error: { code, message } })`, plus un en-tête
`Retry-After` (en secondes) posé seulement si fourni
(`server/_core/http.ts:36-45`). Aucun autre champ n'existe dans l'enveloppe
d'erreur. `asyncHandler` enveloppe chaque handler car Express 4 ne propage
pas les rejets async au pipeline d'erreur (`server/_core/http.ts:11-34`), et
`errorHandler` doit rester le dernier middleware monté
(`server/_core/index.ts:79-81`).

### 1.2 `errorHandler` — table de correspondance terminale

| Condition détectée                                                                                                                  | Réponse                                                   | Citation                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| `error.type === "entity.too.large"` (ou `status`/`statusCode` 413)                                                                  | 413 `PAYLOAD_TOO_LARGE` « Request body is too large »     | `server/_core/http.ts:124-127,141-147` |
| `error.type === "entity.parse.failed"` (ou `status`/`statusCode` 400)                                                               | 400 `VALIDATION_ERROR` « Request body is malformed »      | `server/_core/http.ts:125-128,149`     |
| code SQL/réseau ∈ `ECONNREFUSED`, `ETIMEDOUT`, `PROTOCOL_CONNECTION_LOST`, `ER_ACCESS_DENIED_ERROR`, `ENOTFOUND`, `ER_BAD_DB_ERROR` | 503 `DATABASE_UNAVAILABLE` + log JSON `database_error`    | `server/_core/http.ts:97-110,151-161`  |
| tout le reste                                                                                                                       | 500 `INTERNAL_ERROR` + log JSON `unhandled_request_error` | `server/_core/http.ts:163-171`         |

Si les en-têtes sont déjà envoyés, l'erreur est repassée à `next` sans
réponse (`server/_core/http.ts:136`).

### 1.3 `notFoundHandler` sur `/api/*`

`app.use("/api", notFoundHandler)` : tout chemin API inconnu répond
404 `NOT_FOUND` « Route not found » en JSON, et surtout ne retombe jamais
sur le SPA (qui répondrait 200 + HTML à un client JSON)
(`server/_core/index.ts:68-70`, `server/_core/http.ts:174-176`).

### 1.4 Montage global (avant toutes les routes)

| Mesure                             | Valeur                                                                                                                                                        | Citation                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `x-powered-by`                     | désactivé                                                                                                                                                     | `server/_core/index.ts:25`    |
| `trust proxy`                      | `1` (un seul mandataire en amont ; conditionne `req.ip`, donc toutes les clés de rate limit basées sur l'IP)                                                  | `server/_core/index.ts:26`    |
| En-têtes posés sur chaque réponse  | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`         | `server/_core/index.ts:27-35` |
| Limite de corps JSON et urlencoded | **64 kb** (l'ancienne limite 50 mb était une surface de DDoS ; aucune route n'accepte un payload plus gros)                                                   | `server/_core/index.ts:36-39` |
| Ordre d'enregistrement             | OAuth → auth → monitors → dashboard → scheduler → notifications → statuspages → QA → plans → admin → tRPC → `notFoundHandler` → SPA/statique → `errorHandler` | `server/_core/index.ts:50-81` |

### 1.5 Rate limiter : le moteur

Compteur en `Map` mémoire du processus (aucune table SQL), fenêtre fixe,
bornée à 10 000 clés avec balayage opportuniste puis éviction des plus
anciennes (`server/auth/rateLimit.ts:1-31,33-61`). Le refus appelle toujours
`sendError(..., 429, "RATE_LIMITED", ...)` avec le `retryAfterSeconds` du
compteur. Journal complet §7.

---

## 2. Les quatre royaumes d'authentification

### Royaume A — session applicative (cookie)

- Cookie `uptimepulse_session` (`server/auth/session.ts:8`).
- Jeton opaque : `randomBytes(32).toString("base64url")` — 32 octets
  aléatoires, jamais stockés en clair ; seule leur empreinte
  `SHA-256 hex` entre dans `sessions.tokenHash` (`server/auth/session.ts:11-13,32-37`).
- Validation : jointure `sessions`→`users` avec `revokedAt IS NULL` et
  `expiresAt > now` (`server/auth/session.ts:46-67`).
- TTL : 30 jours (`SESSION_TTL_MS`, `server/auth/session.ts:9`) ; le cookie
  est `httpOnly, secure, sameSite=none, path=/` (`server/auth/session.ts:16-22`).
- Garde REST : `requireUser` (`server/_core/http.ts:61-77`) — après la
  session, l'adresse du compte doit être celle du créateur
  (`isOwnerEmail`, `server/auth/owner.ts:19-21`, variable
  `UPTIMEPULSE_OWNER_EMAIL`) ; sinon 403 `ACCESS_RESERVED`
  (`server/_core/http.ts:72-75`). L'utilisateur résolu est mémoïsé sur la
  requête pour que REST + contexte tRPC ne paient qu'une jointure
  (`server/_core/http.ts:65-67`). `requireAdmin` ajoute `users.role === 'admin'`
  et répond un 403 `FORBIDDEN` indiscernable (`server/_core/http.ts:84-95`).

### Royaume B — jeton de reporter QA (dans le CHEMIN)

Le jeton n'est ni un cookie ni un en-tête : c'est un segment d'URL.
16 octets aléatoires en hexadécimal → 32 caractères hex
(`newReporterToken`, `server/qa/tickets.ts:27-29`), régénéré à la création
du ticket avec `withReporterToken: true` (`server/qa/tickets.ts:212`). Les
routes `/api/public/qa/tickets/:token` et `.../messages` valident la forme
`/^[0-9a-f]{32}$/` avant toute requête SQL et répondent 404 en cas de
forme invalide ou de jeton inconnu (`server/qa/routes.ts:36-37,248-249,280-281`),
puis requêtent `qaTickets.reporterToken = token` (`server/qa/routes.ts:258-262,298-302`).
La vue reporter n'expose que les événements `public`
(`server/qa/routes.ts:269-271,336`).

### Royaume C — cron / plateforme (JWT HS256, `openId` préfixé `cron_`)

`POST /api/scheduled/checks` vérifie le cookie `app_session_id` comme un JWT
`HS256` signé avec le secret de plateforme (nom de variable
`MANUS_JWT_SECRET`, `server/_core/env.ts:6-8`), et exige `appId` égal
`MANUS_PROJECT_ID` et un `openId` commençant par `cron_`
(`server/scheduler/heartbeatAuth.ts:10-27`, `server/_core/sdk.ts:200,215-224,336`).
Le battement est enregistré auprès du service de cron de la plateforme
(chemin `/api/scheduled/checks`, méthode POST, cadence
`"0 * * * * *"` — une fois par minute, `server/scheduler/register.ts:4,12-19`),
activé seulement si `MANUS_API_URL`/`MANUS_API_KEY` existent
(`server/scheduler/register.ts:7`, `server/_core/env.ts:22-27`). Un ordonnanceur
interne de secours démarre aussi à l'écoute (`startInternalScheduler`,
`server/_core/index.ts:92-93`). Qui signe le premier JWT `cron_` : émission
côté plateforme, **non vérifié** dans le dépôt.

### Royaume D — anonyme

Aucun garde : `GET /api/health`, `GET /api/platform/config.js`,
`GET /api/plans`, `GET /api/public/status/:slug`,
`POST /api/public/qa/tickets` (intake). Les surfaces publiques ne passent
jamais par `requireUser` (`server/_core/http.ts:56-59`, commentaire
d'archive) ; la publication d'un `PUT /api/status-page` et de l'intake QA
compense par rate limit + bornes zod strictes.

### Le client n'utilise PAS tRPC — vérifié

Grep de `trpc|TRPC|appRouter` sous `client/` : zéro occurrence de code ;
seul le commentaire de `client/src/main.tsx:6-11` confirme que le client
tRPC, React Query et superjson ont été retirés du bundle ; l'accès aux
données passe par le client REST typé (`client/src/main.tsx:7`).
Pourtant tRPC reste monté (`server/_core/index.ts:61-67`,
`createExpressMiddleware` sur `/api/trpc`) avec exactement deux procédures
(`server/routers.ts:4-10`, commentaire : « kept only for the platform
health probe ») :

| Procédure            | Garde                                                      | Entrée                       | Sortie                 | Citation                                                           |
| -------------------- | ---------------------------------------------------------- | ---------------------------- | ---------------------- | ------------------------------------------------------------------ |
| `system.health`      | `publicProcedure`                                          | `{ timestamp: nombre ≥ 0 }`  | `{ ok: true }`         | `server/_core/systemRouter.ts:6-14`                                |
| `system.notifyOwner` | `adminProcedure` (rôle admin, sinon `TRPCError FORBIDDEN`) | `{ title ≥ 1, content ≥ 1 }` | `{ success: booléen }` | `server/_core/systemRouter.ts:16-28`, `server/_core/trpc.ts:30-45` |

Le contexte tRPC résout l'utilisateur via la session applicative
`getApplicationUser` (`server/_core/context.ts:11-23`) — pas via
`sdk.authenticateRequest` — et les erreurs tRPC suivent l'enveloppe
`TRPCError`, pas `sendError` (`server/_core/trpc.ts:16-18`).

---

## 3. Répertoire des endpoints

Convention de lecture : royaume A = session cookie, B = jeton reporter,
C = JWT cron, D = anonyme. « garde » = la fonction appelée dans le handler.

### 3.0 Plateforme et sondes (montés dans `_core/index.ts`)

#### GET /api/health — D, aucun garde, aucune limite

- Réponse : `{ "status": "ok" }`, `Cache-Control: no-store` (`server/_core/index.ts:40-43`).
- Codes : 200 uniquement.

#### GET /api/platform/config.js — D, aucun garde, aucune limite

- Réponse : `application/javascript`, `Cache-Control: no-store`, corps
  `window.__MANUS_CONFIG__={...}` avec quatre champs publics :
  `projectId`, `oauthPortalUrl`, `apiUrl`, `apiBrowserKey`, alimentés par
  les **noms** de variables `MANUS_PROJECT_ID`, `MANUS_OAUTH_PORTAL_URL`,
  `MANUS_API_URL`, `MANUS_API_BROWSER_KEY` ; `<` est échappé en `\u003c`
  contre l'injection de script (`server/_core/publicConfig.ts:1-19`,
  `server/_core/index.ts:44-49`).

#### GET /api/trpc/\* — voir §2 (montage dormant côté client)

- `server/_core/index.ts:61-67`.

### 3.1 Authentification applicative (`server/auth/routes.ts`)

Le champ `user` des réponses suit `publicUser` = `{ id, email, name, role }`
(`server/auth/routes.ts:24-36`), validé côté client par
`authUserResponseSchema` (`shared/contracts.ts:151-159`).

#### POST /api/auth/register — D à l'entrée, aucun garde

- Limites : `register:{ip}` 5/15 min **puis** `register-ip:{ip}` 20/15 min
  (clé aggregate contre le credential stuffing multi-adresses)
  (`server/auth/routes.ts:60-64`).
- Corps `registerSchema` (`shared/contracts.ts:15-18`) :
  `email` — trim, minuscule, email valide, max 320 (`shared/contracts.ts:3`) ;
  `password` — 12–128 (`shared/contracts.ts:4`).
- Comportement : l'adresse doit être celle du créateur, refus **avant**
  tout bcrypt (`server/auth/routes.ts:85-95`) ; rôle forcé `admin`
  (`server/auth/routes.ts:112-119`), `openId` = `local_` + base64url de
  18 octets (`server/auth/routes.ts:110`) ; insert users + credentials dans
  une transaction (`server/auth/routes.ts:111-134`) ; session créée.
- Réponse : 201 `{ user }` (`server/auth/routes.ts:144`).
- Codes : 429 `RATE_LIMITED` ; 400 `VALIDATION_ERROR` (`:66-73`) ;
  503 `DATABASE_UNAVAILABLE` (`:76-82`) ; 403 `REGISTRATION_CLOSED`
  (`:89-95`) ; 409 `EMAIL_TAKEN` (`:101-107`) ; 500 `REGISTRATION_FAILED`
  si la relure échoue (`:136-142`).

#### POST /api/auth/login — D, aucun garde

- Limites : `login:{ip}:{email}` 10/15 min — la clé utilise `email` ou la
  chaîne `"invalid"` si le corps ne se parse pas — puis
  `login-ip:{ip}` 40/15 min (`server/auth/routes.ts:151-156`).
- Corps : `loginSchema` = alias de `registerSchema`
  (`shared/contracts.ts:20`) : mêmes bornes `email`/`password`.
- Comportement : comparaison bcrypt contre un hash factice quand le compte
  est inconnu, pour égaliser le temps (`server/auth/routes.ts:17-18,181-184`) ;
  un mot de passe correct sur un compte non créateur répond comme un
  mauvais (`server/auth/routes.ts:193-202`) ; `lastSignedIn` mis à jour,
  session créée (`server/auth/routes.ts:204-208`).
- Réponse : 200 `{ user }`.
- Codes : 429 ; 400 `VALIDATION_ERROR` (`:157-163`) ; 503 ;
  401 `INVALID_CREDENTIALS` (`:185-191,196-202`).

#### POST /api/auth/logout — A, session lue mais non exigée

- Aucune limite. Toujours 204, avec ou sans cookie : révocation par
  `tokenHash` puis `clearCookie` (`server/auth/routes.ts:213-219`,
  `server/auth/session.ts:69-87`).

#### GET /api/auth/me — A, `requireUser`

- Aucune limite. Réponse 200 `{ user }`, `Cache-Control: private, no-store`
  (`server/auth/routes.ts:221-229`).
- Codes : 401 `UNAUTHORIZED`, 403 `ACCESS_RESERVED`
  (`server/_core/http.ts:69,73`), 503 (`server/auth/session.ts:50-51`
  renvoie null → 401).

#### POST /api/auth/password — A, `requireUser`

- Limite : `password:{userId}` 5/15 min — bcrypt cost 12 non plafonné
  serait un épuiseur de CPU (`server/auth/routes.ts:236-238`).
- Corps `changePasswordSchema` (`shared/contracts.ts:22-25`) :
  `currentPassword`, `newPassword` — tous deux `passwordSchema` 12–128
  (`shared/contracts.ts:4`).
- Comportement : vérification de l'actuel, puis transaction
  rotation du hash + révocation de TOUTES les sessions actives, et nouvelle
  session (`server/auth/routes.ts:272-282`).
- Réponse : 200 `{ success: true }` (`server/auth/routes.ts:283`).
- Codes : 429 ; 400 `VALIDATION_ERROR` (`:240-242`) ; 503 ;
  400 `INVALID_PASSWORD` (`:257-270`).

### 3.2 Monitors (`server/monitors/routes.ts`)

Sérialisation commune `serializeMonitor`
(`server/monitors/routes.ts:51-93`) : `id, name, url, intervalSeconds,
timeoutMs, keyword, keywordMode, enabled, status` (dérivé : `PAUSED` si
désactivé, `server/monitors/routes.ts:64`), `consecutiveFailures`,
`consecutiveSuccesses`, `nextCheckAt`, `lastCheckAt`, `uptimePercent`,
`averageResponseTimeMs`, `latestCheck` (statut + temps par phase
dns/tcp/tls/ttfb + classification + date), `ssl` `{ issuer, subject,
validTo }` ou null. Le client valide `monitorSchema`
(`shared/contracts.ts:189-215`). Fenêtre d'analyse : 30 jours
(`server/monitors/routes.ts:29,47-49`).
Garde d'écriture commun `limitMonitorWrites` : clé
`monitor-write:{ip}` 30/60 s (`server/monitors/routes.ts:107-122`).

#### GET /api/monitors — A, `requireUser`, aucune limite

- Réponse : 200 `{ monitors: [...] }` (`monitorListResponseSchema`,
  `shared/contracts.ts:218-220`), tri `createdAt DESC`
  (`server/monitors/routes.ts:138-151`), `private, no-store`.
- Codes : 401/403, 503 (`:130-137`).

#### POST /api/monitors — A, `requireUser` + `limitMonitorWrites`

- Limite : `monitor-write:{ip}` 30/60 s (`:158`).
- Corps `monitorCreateSchema` (`shared/contracts.ts:27-34`) :
  `name` 1–120 trim (`:5`) ; `url` 1–2048 trim (`:29`) ;
  `intervalSeconds` int 300–86 400, défaut 300 (`:12,30`) ;
  `timeoutMs` int 1 000–30 000, défaut 10 000 (`:13,31`) ;
  `keyword` 1–160, nullish (`:32`) ; `keywordMode`
  `must_contain|must_not_contain`, défaut `must_contain` (`:6-10,33`).
- Contrôle de cible : `validateUrlSyntax` — HTTP/HTTPS seulement, ni
  identifiants ni port explicite, `localhost` et adresses privées/réservées
  refusés (`server/monitors/ssrf.ts:62-102`) ; codes portés par
  `TargetValidationError` (`server/monitors/ssrf.ts:5-13`), émis par
  (`server/monitors/routes.ts:95-105`).
- Bornes de plan (jamais codées en dur) : `assertKeywordAllowed`,
  `assertIntervalAllowed`, `assertTimeoutAllowed`
  (`server/monitors/routes.ts:180-189`, `server/plans/service.ts:163,178,193`),
  traduites en 403/400/409 par `respondPlanError`
  (`server/plans/respond.ts:13-44`).
- Quota : `count` + `insert` dans la même transaction pour que deux
  requêtes parallèles ne prennent pas le dernier slot
  (`server/monitors/routes.ts:191-215`, `server/plans/service.ts:133`).
- Réponse : 201 `{ monitor }` sans stats (`:222-223`).
- Codes : 429, 401/403, 400 `VALIDATION_ERROR`, 400 `INVALID_TARGET` /
  `BLOCKED_TARGET`, 403 `FEATURE_UNAVAILABLE`, 400 `VALIDATION_ERROR`
  (borne de plan), 409 `QUOTA_EXCEEDED`, 503.

#### GET /api/monitors/:id/history — A, `requireUser`, aucune limite

- Params/query : `:id` entier > 0 via `parseId` (`server/_core/http.ts:47-50`) ;
  `period` ∈ `24h|7d|30d`, défaut `24h` (`shared/contracts.ts:51`,
  `server/monitors/routes.ts:31-35`) ; `limit` entier, défaut 240, plafond
  500 (`server/monitors/routes.ts:25-26,37-45,258-262`) ;
  `before` = curseur keyset sur `ping_logs.id` (`:268-274`).
- Réponse : `{ logs, total, hasMore }` — `logs` = lignes brutes de
  `ping_logs` (`:289`), `total` compté en SQL (`:283`) ; forme validée par
  `historyResponseSchema` (`shared/contracts.ts:263-275,296-300`) ;
  `private, no-store`.
- Codes : 400 `VALIDATION_ERROR` (id, period, `:232-234,255-257`),
  404 `NOT_FOUND` (monitor pas à soi — réponse identique qu'inexistant ou
  à un autre, `:243-249`), 503.

#### GET /api/monitors/:id/incidents — A, `requireUser`, aucune limite

- Query : `limit` défaut 25, plafond 100 (`server/monitors/routes.ts:27,320-324`).
- Réponse : `{ incidents }` tri `startedAt DESC` (`:325-332`),
  `incidentsResponseSchema` (`shared/contracts.ts:284-303`).
- Codes : 400 `VALIDATION_ERROR`, 404 `NOT_FOUND`, 503.

#### GET /api/monitors/:id — A, `requireUser`, aucune limite

- Réponse : `{ monitor }` avec stats 30 jours (`:352-361`).
- Codes : 400, 404 `NOT_FOUND`, 503.

#### PUT /api/monitors/:id — A, `requireUser` + `limitMonitorWrites`

- Limite : `monitor-write:{ip}` 30/60 s (`:367`).
- Corps `monitorUpdateSchema` (`shared/contracts.ts:42-49`) : chaque champ
  `.optional()` explicite, SANS défaut — voir le piège §5. `keyword`
  `nullish` : absent = inchangé, `null` = retiré
  (`server/monitors/routes.ts:405-410`).
- Écriture : seuls les champs fournis entrent dans le patch ;
  `keywordMode` ignoré si aucun keyword effectif (`:408-423`) ;
  propriété incluse dans le prédicat du UPDATE — pas de fenêtre
  check-write (`:391-392,425-428`) ; `nextCheckAt` reprogrammée (`:412-413`).
- Contrôle cible si `url` fourni (`:381-382`) ; bornes de plan seulement
  sur les champs présents (`:393-403`).
- Réponse : `{ monitor }` sérialisé sans stats (`:436-438`).
- Codes : 429, 401/403, 400 `VALIDATION_ERROR`, 400 `INVALID_TARGET`/
  `BLOCKED_TARGET`, 403 `FEATURE_UNAVAILABLE`, 400 plan (bornes), 503,
  404 `NOT_FOUND` (affectRows = 0, `:429-430`). Le PUT ne teste PAS le
  quota de monitors — seul le POST le fait (`:191-199`).

#### DELETE /api/monitors/:id — A, `requireUser` + `limitMonitorWrites`

- Suppression avec `userId` dans le prédicat (`:459-461`).
- Réponse : 204 (`:464`). Codes : 429, 400, 404 `NOT_FOUND`, 503.

#### POST /api/monitors/:id/check — A, `requireUser` + `limitMonitorWrites`

- Force `nextCheckAt` à `maintenant − 1 s` arrondi à la seconde (la
  colonne a une précision seconde et MySQL arrondit au-dessus de 0,5 s, ce
  qui ferait rejeter le claim par lui-même) (`server/monitors/routes.ts:499-517`).
- `runMonitorCheck` ne gagne le bail qu'une fois : le perdant ressort en
  409 (`:518-525`).
- Réponse : `{ check: { isUp, statusCode, responseTimeMs, dnsMs, ttfbMs,
classification, incidentAction } }` (`:526-537`),
  `manualCheckResultSchema` (`shared/contracts.ts:222-234`),
  `incidentAction` ∈ `none|failure|recovery`.
- Codes : 429, 400 `VALIDATION_ERROR`, 404 `NOT_FOUND`,
  409 `MONITOR_PAUSED` (`:492-498`), 409 `CHECK_IN_PROGRESS`, 503.

#### POST /api/monitors/:id/pause et /resume — A, `requireUser` + `limitMonitorWrites`

- Boucle unique sur `["pause"=false, "resume"=true]`
  (`server/monitors/routes.ts:540-588`) : pose `enabled`,
  `currentStatus` = `PAUSED` ou `UNKNOWN`, remet les compteurs consécutifs
  à 0, reprogramme `nextCheckAt` (`:566-575`).
- Réponse : `{ monitor }` ; codes : 429, 400, 404 `NOT_FOUND`, 503.

### 3.3 Notifications (`server/notifications/routes.ts`)

#### GET /api/notification-channels — A, `requireUser`, aucune limite

- Réponse : `{ channels }` avec UNIQUEMENT `id, type, enabled, createdAt,
updatedAt` — jamais le blob chiffré (`:53-64`),
  `channelsResponseSchema` (`shared/contracts.ts:305-315`).

#### POST /api/notification-channels — A, `requireUser`

- Limite : `channel:{userId}` 5/15 min (`:73`).
- Corps : schéma LOCAL `telegramChannelSchema`, pas `contracts.ts`
  (`server/notifications/routes.ts:15-19`) : `type` littéral `"telegram"` ;
  `botToken` trim 10–512 ; `chatId` trim 1–128.
- Comportement : config chiffrée avant stockage
  (`encryptTelegramConfig`, `:91-94`) ; quota canaux count+insert en
  transaction (`:96-112`, `server/plans/service.ts:146`).
- Réponse : 201 `{ channel: { id, type, enabled } }` (`:118-124`).
- Codes : 429, 401/403, 400 `VALIDATION_ERROR`, 409 `QUOTA_EXCEEDED`, 503.

#### DELETE /api/notification-channels/:id — A, `requireUser`, aucune limite

- 204 ; 400 `VALIDATION_ERROR` (id), 404 `NOT_FOUND`, 503 (`:128-156`).

#### POST /api/notification-channels/:id/test — A, `requireUser`

- Limite : `channel-test:{userId}` 3/15 min (`:163`).
- Le canal doit exister, appartenir, ET être `enabled`, sinon 404 (`:176-188`).
- Réponse : `{ success: true }` ; en cas d'échec d'envoi ou de
  déchiffrement : 502 `DELIVERY_FAILED` (`:189-203`).

### 3.4 Pages de statut (`server/statuspages/routes.ts`)

Sérialisation `{ id, slug, title, description, createdAt }` (`:13-21`).

#### GET /api/status-page — A, `requireUser`, aucune limite

- Réponse : `{ statusPage }` ou `{ statusPage: null }` (`:54-63`),
  `statusPageResponseSchema` (`shared/contracts.ts:349-351`).

#### PUT /api/status-page — A, `requireUser` + limite

- Limite : `status-page-write:{ip}` 20/60 s (`:23-38`, appelé `:69`).
- Corps `statusPageUpsertSchema` (`shared/contracts.ts:334-338`) :
  `slug` minuscules/chiffres/tirets, bord non vide, regex
  `/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])$|^[a-z0-9]$/`
  (`shared/contracts.ts:325-332`) ; `title` = `monitorNameSchema` 1–120 ;
  `description` trim max 500, nullish, défaut null.
- Upsert : update si la page du compte existe, sinon insert
  (`server/statuspages/routes.ts:94-123`) ; message zod du premier problème
  renvoyé tel quel (`:72-79`).
- Codes : 429, 401/403, 400 `VALIDATION_ERROR`, 409 `SLUG_TAKEN` sur
  `ER_DUP_ENTRY` (`:124-132`), 500 `INTERNAL_ERROR` si la relue post-insert
  est vide (`:115-121`), 503.
- Réponse : `{ statusPage }`.

#### DELETE /api/status-page — A, `requireUser` + `status-page-write:{ip}`

- Supprime toute page du compte, 204 idempotent (`:139-156`).

#### GET /api/public/status/:slug — D, aucun garde

- Limite : `public-status:{ip}` 60/60 s (`:161-173`).
- Slug testé contre le même regex que le contrat (`:10-11,175-176`) ;
  invalidité et inconnu répondent tous deux 404 `NOT_FOUND`
  « Page de statut introuvable » (`:175-176,191-192`).
- Réponse : payload `buildPublicStatusPayload`
  (`server/statuspages/analysis.ts`, appelé `:194`), forme
  `publicStatusResponseSchema` : `title, description, overall`
  (`operational|outage|empty`), `days`, `summary`, `methodology`,
  `monitors[]` (jours, fenêtres d1/d7/d30/d90, heures, latence p50/p90/p95,
  phases, échecs, incidents, certificat, couverture, SLA), `incidents[]`,
  `generatedAt` (`shared/contracts.ts:353-548`).
- `Cache-Control: public, max-age=30` (`server/statuspages/routes.ts:195`).

### 3.5 Dashboard (`server/routes/dashboard.ts`)

#### GET /api/dashboard — A, `requireUser`, aucune limite

- Fenêtre 30 jours, 20 incidents actifs max, 30 checks récents par monitor
  (`server/routes/dashboard.ts:12-14`).
- Tout est agrégé en SQL ; les checks récents sont tronqués par monitor
  puis rendus du plus ancien au plus récent pour la bande HTML
  (`:90-124,126-148,169`).
- Réponse `{ summary, monitors, incidents }` (`:151-177`) :
  `summary` = total/up/down/paused/uptimePercent/activeIncidents/
  averageResponseTimeMs ; `monitors[]` comme `serializeMonitor` +
  `recentChecks` (`:16-63`) ; `incidents[]` = incident + `monitorName` +
  `monitorUrl`, statut `confirmed` uniquement (`:98-109`).
  Forme client : `dashboardResponseSchema` (`shared/contracts.ts:236-261`).
- `private, no-store` (`:150`) ; codes : 401/403, 503 (`:71-78`).

### 3.6 Qualité / QA (`server/qa/routes.ts`)

Aide commune : `limited(...)` préfixe la clé par `:{ip}`
(`server/qa/routes.ts:80-101`) ; `validationMessage` renvoie le premier
problème zod avec le nom du champ en français (« Champ « x » : … »)
(`:71-78`) ; jeton reporter = motif 32 hex (§2 royaume B, `:36-37`).

#### POST /api/public/qa/tickets — D (intake anonyme)

- Limite : `qa-intake:{ip}` 10/15 min (`:165`).
- Corps `qaTicketCreateSchema` (`shared/contracts.ts:687-705`) :
  `title` 5–160 trim ; `clientMessage` 10–4 000 trim ; `kind`
  `bug|behaviour|ux` défaut `bug` (`:561`) ; `steps` max 2 000 nullish ;
  `expected`/`actual` max 1 000 nullish ; `reporterName` max 120 nullish ;
  `reporterEmail` = `emailSchema` nullish ; `pageUrl` max 2 048 nullish ;
  `statusSlug` regex slug nullish (`:697-702`) ; `evidence` =
  `qaEvidenceSchema` nullish (`shared/contracts.ts:647-679` :
  `capturedAt` ≤ 40, `route`/`userAgent` ≤ 300, `locale` ≤ 35,
  `viewport` 0–10 000 par axe, `javaScriptErrors` ≤ 10 entrées
  (message/source ≤ 300, at ≤ 40), `failedRequests` ≤ 10 (path ≤ 300,
  durationMs 0–600 000)) ; `website` max 200 défaut "" — c'est le
  honeypot (`shared/contracts.ts:684-685,704`).
- Honeypot rempli → 201 factice bien formé mais inutilisable :
  `{ id: 0, reference: "UP-00000", reporterToken: "0"×32 }` — sans
  signaler le piège (`server/qa/routes.ts:175-183`).
- Rattachement : `statusSlug` fourni → propriétaire de la page de statut
  correspondante (404 si slug inconnu, `:197-206`) ; sinon compte QA
  (`qaOwnerUserId`, `:207-216`) ; le client ne peut jamais choisir un id
  de compte (`:193-196`).
- Réponse : 201 `{ id, reference, reporterToken }` — référence dérivée de
  l'id, `UP-` + zéros (`shared/contracts.ts:621-624`), schéma
  `qaTicketCreatedResponseSchema` (`:880-887`).
- Codes : 429, 400 `VALIDATION_ERROR` (message par champ), 404 `NOT_FOUND`,
  503 (`server/qa/routes.ts:162-241`).

#### GET /api/public/qa/tickets/:token — B

- Limite : `qa-followup-read:{ip}` 60/60 s (`:246`).
- Token hors motif ou inconnu → 404 `NOT_FOUND` « Signalement introuvable »
  (`:248-249,263-264`).
- Réponse `qaPublicTicketResponseSchema` (`shared/contracts.ts:806-812`) :
  `{ ticket, events }` — vue reporter sans e-mail ni note interne
  (`qaPublicTicketSchema` `:759-775`), événements `public` uniquement
  (`server/qa/routes.ts:267-271`) ; `private, no-store`.

#### POST /api/public/qa/tickets/:token/messages — B

- Limite : `qa-followup-write:{ip}` 20/60 min (`:278`).
- Corps `qaTicketEventCreateSchema` (`shared/contracts.ts:717-720`) :
  `body` 1–4 000 trim ; `visibility` `public|internal` défaut `public` —
  mais la route FORCE `public` pour la parole du reporter
  (`server/qa/routes.ts:307-313`).
- Effet de bord : un ticket `waiting_client` repart automatiquement en
  `in_progress` avec un événement de transition citant les 500 premiers
  caractères de la réponse (`:315-328`).
- Réponse : même forme que le GET follow-up (`:330-337`).
- Codes : 429, 404, 400 `VALIDATION_ERROR`, 503.

#### GET /api/qa/overview — A, `requireUser`, aucune limite

- Quatre lectures parallèles : liste, totaux, dernier auto-test, dernier
  digest (`:358-364`).
- Réponse `qaOverviewResponseSchema` (`shared/contracts.ts:848-855`) :
  `{ totals, tickets, lastSelfTest, digest, generatedAt }` ;
  `totals` = `open, fresh, waitingClient, autoOpen, resolvedThisWeek,
overdue` (`:777-786`, seuil de relance 48 h `:583-588`).

#### GET /api/qa/tickets — A, `requireUser`, aucune limite

- Query `status`, `source` : passés tels quels, CAST non validé zod à ce
  niveau (`server/qa/routes.ts:389-398`) — comportement d'une valeur
  inattendue : délégué à `listTickets`, **non vérifié** ici.
- Réponse : `{ tickets, totals }` (`:399-402`),
  `qaTicketsResponseSchema` (`shared/contracts.ts:788-792`).
  Pas d'en-tête `Cache-Control` sur cette route (`:399`).

#### GET /api/qa/tickets/:id — A, `requireUser`, aucune limite

- id invalide → 400 `INVALID_ID` (`:411-413`).
- Réponse `detailPayload` : `{ ticket, events (publics ET internes),
reporterToken (brut, pour construire le lien), internalReport (Markdown
régénéré à la lecture) }` (`:125-154,424-426`),
  `qaTicketDetailResponseSchema` (`shared/contracts.ts:794-804`).

#### PATCH /api/qa/tickets/:id — A, `requireUser`

- Limite : `qa-operator-write:{ip}` 60/60 s (`:432`).
- Corps `qaTicketUpdateSchema` (`shared/contracts.ts:709-714`) :
  `status` ∈ 6 statuts (`:563-570`), `severity` ∈ `P1..P4` (`:562`),
  `kind` ∈ `bug|behaviour|ux` (`:561`), `title` 5–160 — tous `.optional()`.
- Ordre : requalification (champs + événement interne « Fiche mise à
  jour : … », `:457-478`) PUIS transition validée contre la ligne réellement
  stockée (`:480-488`) ; transition refusée → 409 `INVALID_TRANSITION`
  avec le motif de la table `QA_STATUS_TRANSITIONS`
  (`shared/contracts.ts:626-634`, `server/qa/tickets.ts:53-60`) ;
  patch vide → 400 `VALIDATION_ERROR` « Aucune modification fournie »
  (`:490-499`).
- Réponse : `{ ticket }` (`:501-506`).

#### POST /api/qa/tickets/:id/events — A, `requireUser`

- Limite : `qa-operator-write:{ip}` 60/60 s (`:513`).
- Corps `qaTicketEventCreateSchema` (`shared/contracts.ts:717-720`) ;
  auteur forcé `support`, visibilité celle du corps
  (`server/qa/routes.ts:538-543`).
- Réponse : `detailPayload` relu (l'événement a bougé `updatedAt`, donc le
  compteur d'inactivité affichera l'activité, `:544-551`).

#### POST /api/qa/tickets/:id/reply — A, `requireUser`, AUCUNE limite

- Corps `qaTicketReplyRequestSchema` (`shared/contracts.ts:863-865`) :
  `kind` ∈ `acknowledgement|clarification|resolution`.
- Ne génère aucune écriture : brouillon de réponse française seulement ;
  l'opérateur le copie en note publique
  (`server/qa/routes.ts:555-601`).
- Réponse `{ template: { kind, body } }` (`:591-599`),
  `qaTicketReplyResponseSchema` (`shared/contracts.ts:867-870`).
- L'URL de suivi intégrée au texte dépend d'`APP_BASE_URL` (nom de
  variable) ou, en secours dev, des en-têtes `x-forwarded-host`/`Host`
  validés par motif + `x-forwarded-proto` (`server/qa/routes.ts:41-64`).

#### GET /api/qa/digest — A, `requireUser`, aucune limite

- 404 `NOT_FOUND` « Aucun point quotidien enregistré » si vierge
  (`:616-623`) ; sinon `qaDigestResponseSchema` :
  `{ date, status, markdown, totals, newCount, resolvedCount, autoCount,
generatedAt }` (`shared/contracts.ts:836-846`).

#### POST /api/qa/digest/run — A, `requireUser`

- Limite : `qa-force-run:{ip}` 6/60 s (`:632`).
- `buildDailyDigest(force)` ; 409 `RUN_IN_PROGRESS` si la période est déjà
  prise (`:643-650`) ; réponse = digest.

#### POST /api/qa/self-tests/run — A, `requireUser`

- Limite : `qa-force-run:{ip}` 6/60 s, MÊME clé que le digest (`:658`).
- 409 `RUN_IN_PROGRESS` (`:670-676`) ; réponse `{ run }` (`:677`),
  `qaSelfTestRunSchema` : `{ periodKey, status ok|attention|failed,
startedAt, finishedAt, results[] }` (`shared/contracts.ts:814-834`).

### 3.7 Plans et console (`server/admin/routes.ts`)

#### GET /api/plans — D (public), aucun garde

- Limite : aucune (lecture SQL, `Cache-Control: public, max-age=60`,
  `server/admin/routes.ts:110`).
- Filtre `isPublic`, tri prix croissant puis `free` épinglé en tête quoi
  qu'il arrive — `sortOrder` appartient à la console (`:98-114,61-70`).
- Réponse `{ plans }` en `planPublicSchema` (`shared/contracts.ts:912-923`,
  `planListResponseSchema` `:949-951`) ; champs console (`id`, `isPublic`,
  `sortOrder`) retirés (`server/admin/routes.ts:51-59`).

#### GET /api/plan — A, `requireUser`, aucune limite

- Réponse `{ plan, usage: { monitors, channels }, trialEndsAt }`
  (`server/admin/routes.ts:125-145`), `myPlanResponseSchema`
  (`shared/contracts.ts:958-962`) ; `private, no-store`.

#### GET /api/admin/overview — A+, `requireAdmin`, aucune limite

- `requireAdmin` = session + owner + rôle admin (`server/_core/http.ts:84-95`).
- Plafond de comptes rendus : 200, tri `lastSignedIn DESC`
  (`server/admin/routes.ts:31,193-208`).
- Les comptes sans plan explicite (`planId NULL`) sont repliés sur la
  ligne `free` ; s'il n'existe pas, une ligne synthétique
  « Free (plan absent) » est ajoutée (`:27-29,211-255`).
- Réponse `adminOverviewResponseSchema` (`shared/contracts.ts:979-997`) :
  `{ totals: { users, admins, monitors, openIncidents, keywordMonitors },
plans: [{ slug, name, priceCents, userCount, monitorCount }],
users: [{ id, email, name, role, planSlug, planName, monitorsUsed,
maxMonitors, trialEndsAt, lastSignedIn }] }` ; incidents « ouverts » =
  `suspect|confirmed` (`server/admin/routes.ts:32,180-183`).

#### GET /api/admin/plans — A+, `requireAdmin`, aucune limite

- Tous les plans, console complète (`planAdminSchema`,
  `shared/contracts.ts:925-930,952-954`)
  (`server/admin/routes.ts:287-301`).

#### POST /api/admin/plans — A+, `requireAdmin` + `admin-write:{ip}` 60/60 s

- Corps `planUpsertSchema` (`shared/contracts.ts:932-946`) :
  `slug` `/^[a-z][a-z0-9_-]{1,39}$/` minuscule (`:901-905`) ;
  `name` 1–60 ; `maxMonitors` 1–10 000 ; `minIntervalSeconds` **300**–86 400
  (le plancher 300 s est inviolable : l'échantillonnage des percentiles de
  la page publique en dépend, `:936-938`) ; `maxTimeoutMs` 1 000–30 000 ;
  `maxChannels` 1–50 ; `allowKeyword` booléen ; `priceCents`
  0–1 000 000 ; `trialDays` 0–365 ; `isPublic` défaut true ;
  `sortOrder` 0–100 défaut 0.
- Slug déjà pris → 409 `CONFLICT` (`:319-330`).
- Réponse 201 `{ plan }` + log JSON d'audit `admin_plan_created`
  (`:344-352`).

#### PUT /api/admin/plans/:id — A+, `requireAdmin` + `admin-write:{ip}`

- Même corps ; 400 `VALIDATION_ERROR` id ou corps (`:362-377`) ;
  404 `NOT_FOUND` (`:380-386`) ; 409 `CONFLICT` : `free` ne peut être
  renommé, `free` est réservé, slug dupliqué d'un autre plan
  (`:387-418`). Les monitors hors bornes après abaissement du plan sont
  CONSERVÉS (`:433-434`). Réponse `{ plan }` + audit (`:435-443`).

#### PUT /api/admin/users/:id/plan — A+, `requireAdmin` + `admin-write:{ip}`

- Corps `userPlanAssignmentSchema` (`shared/contracts.ts:1000-1004`) :
  `planSlug` (même regex), `trialDays` int 0–365 défaut 0.
- 404 si compte ou slug de plan inconnus (`server/admin/routes.ts:471-489`) ;
  `trialDays > 0` ⇒ `trialEndsAt = maintenant + n×86 400 000`, sinon `null` ;
  assigner `free` écrit `planId = NULL` (`:490-502`).
- Réponse `{ ok: true }` + audit `admin_plan_assigned` (`:503-512`).

### 3.8 Scheduler (`server/scheduler/routes.ts`)

#### POST /api/scheduled/checks — C, `verifyHeartbeatRequest`, aucune limite

- Corps : ignoré (aucun champ lu).
- 401 `UNAUTHORIZED` « Scheduled callback authentication failed » si le
  JWT du cookie `app_session_id` est absent, mal signé, d'un autre
  `appId`, ou sans `openId` préfixé `cron_`
  (`server/scheduler/routes.ts:14-20`, `server/scheduler/heartbeatAuth.ts:10-27`).
- 503 `DATABASE_UNAVAILABLE` (`:21-28`).
- Exécute un tick : sélection des monitors dus, lot borné `BATCH_SIZE = 50`
  (`server/scheduler/limits.ts:1`, `server/scheduler/routes.ts:30-36`).
- Réponse 200 `{ accepted: true, processed, retriedNotifications,
batchSize }` (`:31-36`).

---

## 4. Table des codes stables

| Code                   | HTTP | Émis par / où                                                                                                   | Citation                                                                                                           |
| ---------------------- | ---- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `UNAUTHORIZED`         | 401  | `requireUser` sans session valide ; callback cron                                                               | `server/_core/http.ts:69` ; `server/scheduler/routes.ts:16-20`                                                     |
| `ACCESS_RESERVED`      | 403  | `requireUser` : session valide mais compte ≠ créateur                                                           | `server/_core/http.ts:72-75`                                                                                       |
| `REGISTRATION_CLOSED`  | 403  | register : adresse ≠ créateur, refus avant bcrypt                                                               | `server/auth/routes.ts:89-95`                                                                                      |
| `EMAIL_TAKEN`          | 409  | register : `emailNormalized` déjà présent                                                                       | `server/auth/routes.ts:101-107`                                                                                    |
| `INVALID_CREDENTIALS`  | 401  | login : mot de passe faux, COMPTE INCONNU, et compte valide mais non créateur (réponse identique, pas d'oracle) | `server/auth/routes.ts:185-191,196-202`                                                                            |
| `RATE_LIMITED`         | 429  | toute la couche rate limit (voir §7), toujours avec `Retry-After`                                               | `server/auth/routes.ts:46-53` et homologues (§7)                                                                   |
| `QUOTA_EXCEEDED`       | 409  | `respondPlanError` sur QuotaExceededError — POST monitors, POST notification-channels                           | `server/plans/respond.ts:14-21` ; `server/monitors/routes.ts:199` ; `server/notifications/routes.ts:104`           |
| `FEATURE_UNAVAILABLE`  | 403  | `respondPlanError` sur FeatureUnavailableError — keyword sur plan qui ne l'autorise pas                         | `server/plans/respond.ts:23-31` ; `server/monitors/routes.ts:183,395`                                              |
| `VALIDATION_ERROR`     | 400  | rejet zod de chaque route ; JSON du parser (`entity.parse.failed`) ; PlanLimitError (borne de plan)             | `server/_core/http.ts:149` ; `server/plans/respond.ts:32-42` ; ex. `server/auth/routes.ts:66-73`                   |
| `INVALID_TRANSITION`   | 409  | PATCH ticket : statut refusé par `QA_STATUS_TRANSITIONS`, motif dans `message`                                  | `server/qa/routes.ts:483-488` ; `shared/contracts.ts:626-634`                                                      |
| `DATABASE_UNAVAILABLE` | 503  | pré-check `getDb()` de chaque route + `errorHandler` sur les codes pilote/SQL                                   | `server/_core/http.ts:97-110,151-161` ; ex. `server/auth/routes.ts:76-82`                                          |
| `NOT_FOUND`            | 404  | `notFoundHandler` sur `/api/*` ; et 404 applicatifs (monitors, channels, tickets, digest, slug public, admin)   | `server/_core/http.ts:174-176` ; ex. `server/monitors/routes.ts:248-249`                                           |
| `PAYLOAD_TOO_LARGE`    | 413  | `errorHandler` sur `entity.too.large` — corps > 64 kb                                                           | `server/_core/http.ts:124,141-147` ; limite `server/_core/index.ts:38-39`                                          |
| `FORBIDDEN`            | 403  | `requireAdmin` : compte valide, rôle ≠ admin — réponse indiscernable d'un refus ordinaire                       | `server/_core/http.ts:84-95`                                                                                       |
| `INTERNAL_ERROR`       | 500  | `errorHandler` (fourre-tout final) ; relecture post-écriture vide (status-page, plans)                          | `server/_core/http.ts:163-171` ; `server/statuspages/routes.ts:115-121` ; `server/admin/routes.ts:337-343,426-431` |

Codes hors de la liste des quinze, réellement dans le code :

| Code                                | HTTP | Route                                    | Citation                                                                   |
| ----------------------------------- | ---- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `INVALID_PASSWORD`                  | 400  | POST /api/auth/password                  | `server/auth/routes.ts:264-269`                                            |
| `REGISTRATION_FAILED`               | 500  | POST /api/auth/register                  | `server/auth/routes.ts:136-142`                                            |
| `INVALID_TARGET` / `BLOCKED_TARGET` | 400  | POST/PUT monitors (SSRF syntaxe)         | `server/monitors/routes.ts:95-105` ; `server/monitors/ssrf.ts:5-13,62-102` |
| `MONITOR_PAUSED`                    | 409  | POST /api/monitors/:id/check             | `server/monitors/routes.ts:492-498`                                        |
| `CHECK_IN_PROGRESS`                 | 409  | POST /api/monitors/:id/check             | `server/monitors/routes.ts:519-525`                                        |
| `SLUG_TAKEN`                        | 409  | PUT /api/status-page (`ER_DUP_ENTRY`)    | `server/statuspages/routes.ts:124-132`                                     |
| `DELIVERY_FAILED`                   | 502  | POST /api/notification-channels/:id/test | `server/notifications/routes.ts:196-203`                                   |
| `INVALID_ID`                        | 400  | routes QA opérateur (:id non numérique)  | `server/qa/routes.ts:411-413,436-437,517-518,567-568`                      |
| `RUN_IN_PROGRESS`                   | 409  | POST digest/run, self-tests/run          | `server/qa/routes.ts:644-650,670-676`                                      |
| `CONFLICT`                          | 409  | POST/PUT /api/admin/plans… (slug)        | `server/admin/routes.ts:324-330,387-418`                                   |

---

## 5. Le piège du `PUT` : `.optional()` explicites, pas `.partial()`

`monitorUpdateSchema` redéclare champ par champ au lieu d'un
`monitorCreateSchema.partial()` — et le commentaire du contrat l'explique :
**Zod 4 réapplique la valeur par défaut d'un `.default()` quand la clé est
absente** (`shared/contracts.ts:36-41`). Or `monitorCreateSchema` porte
trois défauts : `intervalSeconds` 300, `timeoutMs` 10 000,
`keywordMode` `must_contain` (`shared/contracts.ts:30-33`).

Conséquence d'un `.partial()` : tout `PUT` partiel — par exemple un simple
renommage `{ name }` — empoisonnerait le payload avec les trois défauts, et
côté serveur la boucle « n'écrire que les champs fournis »
(`server/monitors/routes.ts:408-423`) les verrait présents et les
écrirait : l'intervalle d'un monitor 15 min repartirait à 300 s, le timeout
à 10 s, le mode du mot-clé serait réinitialisé à chaque renommage. Le
schéma d'update n'a donc AUCUN `.default()` (`shared/contracts.ts:42-49`) :
« absent » reste `undefined`, et le patch ne contient que ce qui était
vraiment dans le corps (`server/monitors/routes.ts:414-423`).

Deux nuances du même schéma : `keyword` est `nullish()` des deux côtés —
absent = inchangé, `null` = retiré (`server/monitors/routes.ts:405-410`,
`shared/contracts.ts:32,47`) — et `keywordMode` fourni sans mot-clé
effectif est ignoré, pas stocké (`server/monitors/routes.ts:421-423`).
Le `PUT` ne renvoie par ailleurs aucun défaut côté réponse
(`docs/02-technical/api.md:81`).

---

## 6. Monté mais inatteignable (dormant, pas absent)

Grep vérifié avant écriture : dans `client/`, zéro occurrence de
`trpc`, `oauth`, `webdev_app_session` en code (seul le commentaire
`client/src/main.tsx:6-11`) ; dans tout le dépôt, `/api/oauth` n'apparaît
que dans `server/_core/oauth.ts:19`, et `sdk.authenticateRequest`
uniquement à sa définition (`server/_core/sdk.ts:265`) et ses commentaires
(`server/_core/sdk.ts:338`, `docs/04-project/documentation-ledger.md:140`).

1. **Domaine OAuth plateforme** — `GET /api/oauth/callback` est bien
   monté (`server/_core/index.ts:50`, `server/_core/oauth.ts:18-82`) :
   garde CSRF sur le nonce `__Host-oauth_state`
   (`shared/const.ts:11`, `server/_core/oauth.ts:31-43`), échange
   code→token→userInfo via le SDK (`:46-47`), upsert de l'utilisateur
   (`:54-60`), session JWT HS256 d'un an signée par `sdk.createSessionToken`
   (`:62-65`, `shared/const.ts:2`, `server/_core/sdk.ts:195-203`) posée
   sous le cookie `webdev_app_session` (`shared/const.ts:1`), redirection
   302 vers `/` (`:73`), réponses brutes hors enveloppe `sendError`
   (400/403/500 en `{ error: "..." }`, `:23-26,35-38,74-80`).
   Aucun émetteur d'état n'existe dans le dépôt (le `startLogin` mentionné
   par le commentaire `server/_core/oauth.ts:29` n'a pas de correspondant
   HTTP monté) et aucun appelant côté client : **dormant**. À noter : le
   cookie que pose ce callback (`webdev_app_session`) n'est pas celui que
   lit `requireUser` (`uptimepulse_session`) — les deux royaumes A et C
   sont réellement parallèles.
2. **`sdk.authenticateRequest`** (`server/_core/sdk.ts:265-333`) — le
   gestionnaire complet cookie OAuth + repli Bearer + identité cron
   (`isCron`, `taskUid`, `:292-299`) n'est appelé par AUCUNE route du
   dépôt ; le contexte tRPC lui-même utilise `getApplicationUser`, pas le
   SDK (`server/_core/context.ts:16`). **Dormant.**
3. **Montage tRPC `/api/trpc`** — monté (`server/_core/index.ts:61-67`)
   avec les deux procédures `system.health` / `system.notifyOwner`
   (§2) ; le client REST ne l'appelle pas (`client/src/main.tsx:6-11`) ;
   réservé à la sonde de santé de la plateforme
   (`server/routers.ts:4-6`). Qui l'appelle réellement en production :
   **non vérifié** (hors dépôt).

---

## 7. Journal complet des limites de débit

Moteur unique : `consumeRateLimit(key, limit, windowMs)` en Map mémoire,
fenêtre fixe, refus 429 + `Retry-After` (`server/auth/rateLimit.ts:33-61`).
`{ip}` = `req.ip` sous `trust proxy 1` ; `{userId}` = id du compte signé.

| Clé                      | Limite | Fenêtre | Route(s)                                                                         | Citation                                                           |
| ------------------------ | ------ | ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `register:{ip}`          | 5      | 15 min  | POST /api/auth/register                                                          | `server/auth/routes.ts:61`                                         |
| `register-ip:{ip}`       | 20     | 15 min  | POST /api/auth/register                                                          | `server/auth/routes.ts:64`                                         |
| `login:{ip}:{email}`     | 10     | 15 min  | POST /api/auth/login (email `invalid` si corps non parsé)                        | `server/auth/routes.ts:153-155`                                    |
| `login-ip:{ip}`          | 40     | 15 min  | POST /api/auth/login                                                             | `server/auth/routes.ts:156`                                        |
| `password:{userId}`      | 5      | 15 min  | POST /api/auth/password                                                          | `server/auth/routes.ts:238`                                        |
| `monitor-write:{ip}`     | 30     | 60 s    | POST /api/monitors ; PUT/DELETE /api/monitors/:id ; POST check, pause, resume    | `server/monitors/routes.ts:107-122`, appels `:158,367,445,471,547` |
| `channel:{userId}`       | 5      | 15 min  | POST /api/notification-channels                                                  | `server/notifications/routes.ts:73`                                |
| `channel-test:{userId}`  | 3      | 15 min  | POST /api/notification-channels/:id/test                                         | `server/notifications/routes.ts:163`                               |
| `status-page-write:{ip}` | 20     | 60 s    | PUT, DELETE /api/status-page                                                     | `server/statuspages/routes.ts:23-38`, appels `:69,142`             |
| `public-status:{ip}`     | 60     | 60 s    | GET /api/public/status/:slug                                                     | `server/statuspages/routes.ts:161-165`                             |
| `qa-intake:{ip}`         | 10     | 15 min  | POST /api/public/qa/tickets                                                      | `server/qa/routes.ts:165` (clé `:87-88`)                           |
| `qa-followup-read:{ip}`  | 60     | 60 s    | GET /api/public/qa/tickets/:token                                                | `server/qa/routes.ts:246`                                          |
| `qa-followup-write:{ip}` | 20     | 60 min  | POST /api/public/qa/tickets/:token/messages                                      | `server/qa/routes.ts:278`                                          |
| `qa-operator-write:{ip}` | 60     | 60 s    | PATCH /api/qa/tickets/:id ; POST /api/qa/tickets/:id/events                      | `server/qa/routes.ts:432,513`                                      |
| `qa-force-run:{ip}`      | 6      | 60 s    | POST /api/qa/digest/run ; POST /api/qa/self-tests/run (clé partagée)             | `server/qa/routes.ts:632,658`                                      |
| `admin-write:{ip}`       | 60     | 60 s    | POST /api/admin/plans ; PUT /api/admin/plans/:id ; PUT /api/admin/users/:id/plan | `server/admin/routes.ts:76-91`, appels `:308,361,452`              |

Sans limite, à auditer : `GET /api/health`, `GET /api/platform/config.js`,
tous les GET de lecture (monitors, dashboard, channels, status-page,
plans, admin, QA overview/liste/détail/digest), `POST
/api/qa/tickets/:id/reply` (`server/qa/routes.ts:561` — lecture +
génération uniquement), `POST /api/scheduled/checks` (garde JWT, `:11`),
`POST /api/auth/logout` (idempotent, `:213`). L'in-memory par processus
signifie aussi qu'un déploiement multi-instance multiplierait d'autant
chaque compteur (`server/auth/rateLimit.ts:3`).
