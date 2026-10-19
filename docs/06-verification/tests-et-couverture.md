# Stratégie de tests et couverture

Cette page décrit la vérification **telle qu'elle existe dans le dépôt**, en
se fondant uniquement sur : `vitest.config.ts`, les 23 fichiers `*.test.ts`,
`package.json`, `.github/workflows/ci.yml`, `CONTRIBUTING.md` et les fichiers
source qu'ils importent. Tout a été vérifié par lecture ; le total de tests a
été vérifié par exécution de `pnpm exec vitest run`
(23 fichiers verts, 223 tests, ~4,2 s sur l'environnement de développement).

## 1. Configuration

Un **seul projet vitest**, sans fichier `vitest.workspace.*` ni clé `projects`
(absence vérifiée dans `vitest.config.ts` et à la racine du dépôt).

| Point           | Valeur                                                                                     | Preuve                                     |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Racine forcée   | `root: repoRoot`, résolu via `import.meta.dirname`                                         | `vitest.config.ts:4`, `vitest.config.ts:7` |
| Environnement   | `environment: "node"` global                                                               | `vitest.config.ts:15`                      |
| Alias `@`       | → `client/src`                                                                             | `vitest.config.ts:10`                      |
| Alias `@shared` | → `shared/`                                                                                | `vitest.config.ts:11`                      |
| Globs `include` | `server/**`, `shared/**` (`.test.ts`/`.spec.ts`) + `client/src/lib/**/*.test.ts` seulement | `vitest.config.ts:18-26`                   |

- **Pas de jsdom** : aucune dépendance jsdom dans `package.json:21-65`,
  aucun environnement `jsdom` dans la config. Conséquence : **aucun test de
  rendu React n'est possible ni présent** ; le commentaire de la config
  l'assume : seuls entrent les modules client « browser-free », « rendering
  components would need a DOM environment » (`vitest.config.ts:23-25`).
- **Pas de `setupFiles`** ni de section `coverage` : le bloc `test` ne contient
  que `environment` et `include` (`vitest.config.ts:14-27`). Aucun taux de
  couverture n'est donc jamais mesuré ni publié.
- **`shared` se résout par alias, pas par son `package.json`** :
  `shared/package.json` n'a ni `main`, ni `exports`, ni `types`
  (`shared/package.json:1-11`, seuls `name`/`type`/`dependencies`). Les tests
  l'importent soit par alias (`@shared/contracts` dans
  `server/qa/report.test.ts:2-3`, `@shared/db/schema` dans
  `server/qa/tickets.test.ts:2`), soit en chemin relatif
  (`./contracts` dans `shared/contracts.test.ts:36`). Les mêmes alias sont
  déclarés pour tsc dans `tsconfig.json:19-22`.

## 2. Inventaire fichier par fichier

Deux colonnes de compte : **blocs écrits** (`it(`/`it.each`, comptés par grep
des lignes de déclaration) et **tests à l'exécution** (`it.each` se déplie par
cas). Seul `ssrf.test.ts` diffère : ses 4 `it.each`
(`server/monitors/ssrf.test.ts:14`, `:40`, `:49`, `:59`) produisent
9 + 4 + 5 + 3 = 21 cas, soit 24 tests pour 7 blocs.

| Fichier                               | Ce qu'il verrouille                                                                                                                                                 |   Blocs |   Tests |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------: | ------: |
| `client/src/lib/qaContext.test.ts`    | Tampon de preuves client : route sans query string, captures de 10, troncature 300/60, instant injecté                                                              |       7 |       7 |
| `server/_core/db-error.test.ts`       | Déballage des erreurs driver derrière `DrizzleQueryError` : code lu via `.cause`, doublon reconnu sur les deux formes, message jamais porteur du SQL                |       3 |       3 |
| `server/_core/http.test.ts`           | Gardes `requireUser`/`requireAdmin` (401/403/owner, session lue 1×) et `asyncHandler` ; `vi.mock` de la session (`:3-4`)                                            |       8 |       8 |
| `server/auth/owner.test.ts`           | Comparaison d'adresse propriétaire : casse/espaces, suffixe trompeur refusé, override `UPTIMEPULSE_OWNER_EMAIL`                                                     |       3 |       3 |
| `server/auth/rateLimit.test.ts`       | Fenêtre, `retryAfterSeconds`, isolement par clé, balayage borné à 20 000 clés                                                                                       |       5 |       5 |
| `server/checks/client.test.ts`        | `performHttpCheck` et `validateResolvedAddresses` ; hook `lookup` `{all:true}` ; **réseau réel** (cf. §3)                                                           |       9 |       9 |
| `server/checks/content.test.ts`       | Assertion mot-clé : insensible à la casse, corps tronqué ⇒ `unknown`, binaire jamais inspecté                                                                       |       7 |       7 |
| `server/incidents/state.test.ts`      | Machine à états : suspect au 1ᵉʳ échec, confirmé au 3ᵉ, résolu après 2 succès                                                                                       |       4 |       4 |
| `server/monitors/ssrf.test.ts`        | Refus loopback/RFC1918/169.254, IPv6 tunnels/réservés, ports et protocoles non HTTP                                                                                 |       7 |      24 |
| `server/monitors/stats.test.ts`       | `calculateUptime` : % arrondi, moyenne, `null` sans check                                                                                                           |       2 |       2 |
| `server/notifications/crypto.test.ts` | Round-trip AES-256-GCM de la config Telegram                                                                                                                        |       1 |       1 |
| `server/plans/service.test.ts`        | Quotas/limites/gating de plan + `resolvePlan` sur `fakeDb`                                                                                                          |      10 |      10 |
| `server/platform.test.ts`             | Config publique sans fuite de secrets, cookies, signature JWT de session, `errorHandler` (503/500/413/400), `parseId`, déballage Drizzle → 503 sans SQL dans le log |      13 |      13 |
| `server/qa/digest.test.ts`            | Clé de période du digest : jour UTC strict, tri lexical                                                                                                             |       2 |       2 |
| `server/qa/report.test.ts`            | Documents Markdown FR : rapport interne et réponse client, champs manquants, preuves, relance                                                                       |      20 |      20 |
| `server/qa/routes.test.ts`            | `requestOrigin` seul : `APP_BASE_URL` autoritaire, forwarded-host, injection d'en-tête refusée                                                                      |       6 |       6 |
| `server/qa/runs.test.ts`              | `parseDetail` : JSON corrompu ⇒ liste vide, jamais un crash                                                                                                         |       3 |       3 |
| `server/qa/selfTest.test.ts`          | 7 invariants auto-test : clé de période 15 min, textes FR, `stubDb`, échec de lecture = anomalie                                                                    |      17 |      17 |
| `server/qa/tickets.test.ts`           | Transitions d'état, token 32 hex, bornes de preuve, sérialisation publique sans fuite                                                                               |      13 |      13 |
| `server/scheduler/pool.test.ts`       | `mapWithConcurrency` : ordre, plafond d'in-flight, propagation d'erreur                                                                                             |       5 |       5 |
| `server/scheduler/retention.test.ts`  | Bornes `RETENTION` et calcul des cutoffs depuis une date fournie                                                                                                    |       3 |       3 |
| `server/statuspages/analysis.test.ts` | Maths de page publique : percentiles nearest-rank, fenêtres, buckets horaires, budget d'erreur, compte à rebours TLS                                                |      16 |      16 |
| `shared/contracts.test.ts`            | Contrats zod serveur↔client : formes de réponses, défauts, rejets, table de transitions QA, parité enum↔schéma                                                    |      42 |      42 |
| **Total**                             |                                                                                                                                                                     | **206** | **223** |

Mon compte de blocs (206) et le total annoncé par le dépôt (223 à l'exécution)
sont **réconciliables sans écart** : 206 − 4 `it.each` + 21 cas dépliés = 223,
confirmé par `pnpm exec vitest run` (« Tests 223 passed (223) »).

## 3. Comment le temps et le réseau sont traités

### Temps : injection, jamais simulation

- Zéro occurrence de `vi.useFakeTimers`, `vi.setSystemTime` ou
  `vi.advanceTimers` dans les 23 fichiers (grep exhaustif : 0 résultat).
- Le temps est **passé en paramètre** par les fonctions pures, ce que les
  tests verrouillent : `consumeRateLimit(key, limit, windowMs, now)` avec
  `now = Date.now()` par défaut (`server/auth/rateLimit.ts:33-37`) et utilisé
  figé dans `server/auth/rateLimit.test.ts:22-25` ;
  `retentionCutoffs(now: Date)` (`server/scheduler/retention.ts:19`, testé
  `server/scheduler/retention.test.ts:13-14`) ; `digestPeriodKey(now)`
  (`server/qa/digest.ts:38`) ; les checks auto-test `run(db, now)`
  (`server/qa/selfTest.ts:66`, constante `NOW` à
  `server/qa/selfTest.test.ts:18`) ; `serializeTicket(…, { now })`
  (`server/qa/tickets.test.ts:13,130`) ; `certificateFrom(monitor, now)`
  (`server/statuspages/analysis.test.ts:161`) ; `captureEvidence(NOW, …)`
  (`client/src/lib/qaContext.test.ts:16,25`).
- Exceptions assumées : le balayage de 20 000 clés
  (`server/auth/rateLimit.test.ts:34-42`) et le pool
  (`server/scheduler/pool.test.ts:4`) consomment de vraies millisecondes
  (le test rateLimit dure ~2,2 s à l'exécution).

### Réseau : un seul mock, un fichier qui sort sur le réseau réel

- `vi.mock` n'apparaît **qu'une fois** dans tout le dépôt :
  `server/_core/http.test.ts:4` (`vi.mock("../auth/session", …)` avec le
  `vi.hoisted` de `:3`). Motif : les gardes `requireUser`/`requireAdmin`
  doivent être testées indépendamment du cookie et de la base ; le mock
  fournit des utilisateurs préfabriqués (`:40`, `:49-53`, `:61-65`) et un
  compteur d'appels (`:80`).
- `server/checks/client.test.ts` sort sur le **réseau réel** :
  `https://example.com` (`:62`, `:73`), `https://open.spotify.com/` (`:94`,
  commentaire `:91` citant explicitement Spotify), résolution DNS réelle d'un
  domaine `.invalid` (`:113-115`) avec timeouts réels jusqu'à 30 s (`:99`).
  Le seul serveur local (`:29-37`, 127.0.0.1) sert à prouver que le garde SSRF
  **bloque** cette cible (`:101-110`), pas à émuler une cible saine.
- **Contradiction avec `CONTRIBUTING.md`** : la règle des « Données et
  secrets » impose « Utiliser uniquement des cibles HTTP de test contrôlées par
  le projet. Ne jamais tester avec des services tiers comme Google ou GitHub »
  (`CONTRIBUTING.md:55`). `example.com` (IANA) et `open.spotify.com` sont des
  tiers non contrôlés par le projet. Conséquences : le suite dépend de la
  connectivité sortante de la machine (CI GitHub : oui ; runner hors ligne ou
  blocage egress : échecs `:61-99`), et la classification exacte de ces pages
  peut dériver sans faute de code. La règle n'est pas appliquée à
  `CONTRIBUTING.md:9-17` (rien n'automatise le contrôle des cibles).
- Écriture brute d'environnement sans restauration : un seul test fait
  `process.env.UPTIMEPULSE_ENCRYPTION_KEY = "…"`
  (`server/notifications/crypto.test.ts:6-7`) ; le fichier (18 lignes) n'a
  **aucun `afterEach`/`unstub`**, la variable reste posée après le test. Le
  risque est réel car `getKey()` relit `process.env` à chaque appel
  (`server/notifications/crypto.ts:13-14`) : tout futur test d'absence de clé
  (« doit lever si la clé manque ») serait rendu faux-négatif s'il est
  planifié sur le même worker (détail d'ordonnancement des workers vitest :
  non vérifié ici). Contrastes : `owner.test.ts` utilise `vi.stubEnv` +
  `vi.unstubAllEnvs` (`server/auth/owner.test.ts:24,33`),
  `platform.test.ts:13-16` idem, et `qa/routes.test.ts` sauvegarde/restaure
  `APP_BASE_URL` dans son helper (`:16-24`) et en `afterEach` (`:27-29`).

## 4. Base de données

- **Aucun test n'ouvre de connexion.** grep : aucune occurrence de `mysql`,
  `createPool` ou `getDb` dans les 23 fichiers. Le module `server/db.ts` crée
  son pool **paresseusement** (`server/db.ts:13-24`), et le seul import
  concerné dans un test est de type pur, effacé à la compilation :
  `import type { Database } from "../db"` (`server/qa/selfTest.test.ts:2`).
  Les erreurs de base sont simulées par fabulation : `ECONNREFUSED` synthétique
  injecté dans `errorHandler` (`server/platform.test.ts:115-117`).
  Point d'honnêteté mesuré : ce cas (`:103`) lançait une erreur **nue** portant
  `.code`, exactement la forme que Drizzle 0.44 ne produit plus — elle enveloppe
  l'échec dans un `DrizzleQueryError`, le code glissant sur `.cause` — si bien
  que le test est resté vert pendant que le chemin de production était cassé. Le
  cas ajouté `server/platform.test.ts:132-167` lance volontairement la forme
  enveloppée, et `server/_core/db-error.test.ts` verrouille le déballage
  (`driverErrorCode`, `isDuplicateKeyError`, `safeErrorMessage`).
- **`fakeDb`** (`server/plans/service.test.ts:133-161`) : chaîne
  `select→from→where→limit` servant des lignes en tableau et un
  `update→set` qui capture les valeurs écrites (`:150-156`). Il prouve les
  décisions de `resolvePlan` : lecture de la ligne de plan assigné
  (`:164-181`), repli sur le plan free sans affectation (`:184-189`), et
  ré-ancrage `update({ planId: null })` quand la ligne de plan a été supprimée
  (`:192-196`) — sans ORM ni dialecte.
- **`stubDb`** (`server/qa/selfTest.test.ts:24-35`) : chaîne
  `select/from/where/orderBy` se résolvant sur `.limit()`, répondant une
  collection prête par ordre d'appel ; **`failingDb`** (`:37-43`) lève
  `ECONNREFUSED` dès `select()`. Ce couple verrouille le principe énoncé dans
  l'en-tête du fichier : « an unrunnable check is a failure, never a silent
  pass » (`server/qa/selfTest.test.ts:13-14`). Le test clé exige qu'une
  **vérification illisible soit une anomalie et non un succès** :
  `database_reachable` sur `failingDb` ⇒ `ok === false` et `actual` contenant
  « Erreur de lecture : ECONNREFUSED » (`:115-119`). Les autres tests
  verrouillent le mesurage du retard d'ordonnanceur avec attribution au
  compte (`:130-148`), le service Down sans incident ouvert (`:192-222`) et
  l'identité du compte QA propriétaire (`qaOwnerUserId`, `:247-262`).
- **Conséquence à écrire clairement** : la CI verte ne dit **rien** de la
  justesse des migrations. Aucun test n'exécute de SQL ; `shared/db/schema.ts`
  n'est épingle que sur la parité enum↔zod
  (`shared/contracts.test.ts:873-879`). La génération Drizzle
  (`CONTRIBUTING.md:41-44`), les contraintes MySQL réelles (UNIQUE de la
  période `(kind, periodKey)` du ledger, invoquée par commentaire seulement
  dans `server/qa/digest.test.ts:5-8`) et l'application de `pnpm db:migrate`
  (`package.json:16-17`) ne sont vérifiées par aucune automatisation dans le
  dépôt.
  Une migration fausse peut donc passer sous les cinq portes (§6) ; seule la
  fumée conteneur CI (`ci.yml:39-53`) touche un process réel, mais **sans base
  de données** (`ci.yml` ne fournit aucun `DATABASE_URL`, et le handler fumé ne
  consulte rien : `server/_core/index.ts:41-44`).
  Deux de ces trous ont été comblés **à la main, sans automatisation**, le
  2026-10-19 : la chaîne complète `0000`→`0007` a été rejouée sur un schéma
  local vierge (huit lignes au journal, quatorze tables, `plans` à trois
  paliers, second `migrate` sans effet), et l'index `qa_runs_kind_period_unique`
  a été lu dans `information_schema.STATISTICS` sur ce schéma neuf. La mesure,
  ses chiffres et sa réserve (MariaDB 11.4.5, pas Oracle MySQL) tiennent dans
  `docs/03-infrastructure/deploiement.md`, §« Base de données au premier
  déploiement ». Rien de tout cela n'est rejouable par la CI : tant qu'aucun
  service de base n'y est déclaré, la porte reste manuelle.

## 5. Ce qui n'est testé du tout

22 fichiers source sont importés (comme valeurs) par les tests :
`_core/{db-error,http,cookies,publicConfig,sdk}`, `auth/{owner,rateLimit,session}`,
`checks/client`, `monitors/{ssrf,stats}`, `notifications/crypto`,
`plans/service`, `qa/{digest,report,routes,runs,selfTest,tickets}`,
`scheduler/{pool,retention}`, `statuspages/analysis`, `incidents/state`,
`shared/{const,contracts,db/schema}`, `client/src/lib/qaContext`. Tout le
reste est jamais exécuté par `pnpm test`.

### Démarrage Express — 0 test

- `server/_core/index.ts` (101 lignes) : `express()` (`:24`), middlewares JSON
  64 kb (`:39-40`), health `/api/health` (`:41`), montage des 10 registres de
  routes (`:51-60`), `notFoundHandler` (`:71`), `errorHandler` final (`:82`),
  `listen` (`:91`). Aucune de ces lignes ne tourne sous vitest ; seul le
  conteneur CI touche le health (`ci.yml:43`).
- `server/_core/vite.ts` (`setupVite:7`), `server/_core/static.ts`
  (`serveStatic:5`, extrait du `vite.ts` au refactor),
  `server/_core/context.ts` (`createContext:11`),
  `server/_core/trpc.ts` (`protectedProcedure:28`, `adminProcedure:30`),
  `server/_core/systemRouter.ts` (`:5`), `server/routers.ts` (12 lignes),
  `server/_core/env.ts` (`ENV:2`), `server/_core/heartbeat.ts`
  (`createHeartbeatJob:131`…), `server/_core/notification.ts`
  (`notifyOwner:64`), `server/_core/oauth.ts` (`registerOAuthRoutes:18`),
  `server/_core/types/manusTypes.ts`.

### Routes HTTP — 45 handlers enregistrés, 0 exercé

Total des `app.get/post/patch/put/delete` : `monitors/routes.ts` 9,
`auth/routes.ts` 5, `notifications/routes.ts` 4, `admin/routes.ts` 7,
`qa/routes.ts` 12, `statuspages/routes.ts` 4, `scheduler/routes.ts` 1,
`dashboard/routes.ts` 1, `_core/index.ts` 2. Aucun test ne fait de requête
HTTP (pas de supertest dans `package.json:21-46`). Nuance importante :
`server/qa/routes.test.ts` n'appelle que `requestOrigin`
(`server/qa/routes.ts:50`) ; `registerQaRoutes` (`:156`) et les 11 autres
endpoints QA ne sont pas touchés. **Testé au niveau fonction mais pas au
niveau route** : SSRF (`ssrf.test.ts` vs les 9 routes monitors qui l'appellent),
uptime (`stats.test.ts` vs `monitors/routes.ts`), maths de statut
(`analysis.test.ts` vs les 4 routes `statuspages/routes.ts` ; le test contrat
ne fait que « miroiter » le payload, commentaire `shared/contracts.test.ts:400-403`),
machine à incidents (`state.test.ts` vs son appelant `checks/engine.ts:26`),
plans (`service.test.ts` vs `admin/routes.ts` + `plans/respond.ts:13`
`respondPlanError` jamais importé), limites digest — `digest.test.ts` n'attaque que
`digestPeriodKey:38`, tandis que `buildDailyDigest:214`,
`lastDailyDigest:334` et `maybeRunDailyDigest:378` restent sans test),
ledger (`runs.test.ts` ne teste que `parseDetail:67` ; `claimRun:17`,
`finishRun:36`, `latestRun:52` non testés).

### Ordonnanceur — fonction oui, pulsation non

Testés : `pool.ts` (concurrence) et `retention.ts` (bornes + cutoffs).
Jamais importés : `scheduler/loop.ts` (`startInternalScheduler:17`),
`scheduler/tick.ts` (`runSchedulerTick:32` — l'orchestration DB→engine→
dispatch), `scheduler/register.ts` (`ensureHeartbeatJob:6`),
`scheduler/heartbeatAuth.ts` (`verifyHeartbeatRequest:10` — **le token cron
n'a aucun test**), `scheduler/limits.ts` (`BATCH_SIZE = 50:1`, aucune
assertion ne l'epingle).

### Notifications — la crypto seule

Testé : `notifications/crypto.ts`. Jamais testés :
`dispatcher.ts` (`formatMessage:29` — **non exporté, donc inatteignable en
l'état** ; `dispatchIncidentNotification:150`,
`retryFailedNotificationDeliveries:171`, `listNotificationDeliveries:236`),
`telegram.ts` (`sendTelegramMessage:7`, appel réel `api.telegram.org:14`),
`notifications/routes.ts` (4 handlers).

### Auth

`rateLimit.ts` et `owner.ts` testés ; `session.ts` n'est que **mocké**
(`server/_core/http.test.ts:4`) ou lu pour deux constantes
(`server/platform.test.ts:9,51-53`) : `createSession:25`,
`getApplicationUser:46` (validation cookie↔base), `revokeSession:69` ne sont
jamais exercés. `auth/password.ts` (`hashPassword:5`, `verifyPassword:9`) et
`auth/routes.ts` (5 handlers, dont inscription/connexion) : 0 test — la
politique de mot de passe n'est verrouillée que côté schéma zod
(`shared/contracts.test.ts:331-341`), pas côté hachage bcrypt.

### Client (React)

43 des 44 fichiers de `client/src` sont hors de portée des globs
(`vitest.config.ts:18-26`) : les 11 pages, les 23 composants (dont
`ErrorBoundary.tsx`, `status/StatusAnalytics.tsx`, `qa/QaTicketDetail.tsx`),
les 3 hooks (dont `useAutoRefresh.ts`), `contexts/ThemeContext.tsx`,
`App.tsx`/`main.tsx`, `lib/api.ts` (431 lignes : tout le parsing des
réponses par les contrats zod, jamais exécuté sous vitest) et `lib/utils.ts`.
Seul `lib/qaContext.ts` est testé, précisément parce que sans DOM
(`vitest.config.ts:23-25`).

### Shared et schéma

`shared/_core/errors.ts` (`HttpError:5`, `ForbiddenError:15`) n'est jamais
importé par un test — seul `server/_core/sdk.ts` s'en sert, sur quatre
`throw`. De
`shared/db/schema.ts` seule la liste `checkClassificationValues` est épinglée
(`shared/contracts.test.ts:2,873-879`) ; colonnes, index et relations ne sont
testés nulle part.

### Gaps fonctionnels nommés, en bref

1. Création d'incident réelle (chemin `engine.ts` + écriture DB + enqueue
   notification) — aucune intégration.
2. Cycle de vie notification : file, re-tentatives, doublons
   (`isDuplicateKeyError`, `server/_core/db-error.ts:26`).
3. Auto-test de bout en bout : les 7 invariants sont testés fonction par
   fonction, mais leur exécution planifiée, la déduplication par `fingerprint`
   et l'ouverture de ticket (`tickets.ts` ne couvre pas la création côté
   route) ne le sont pas.
4. Digest quotidien : idempotence par `(kind, periodKey)` seulement
   documentée (`server/qa/digest.test.ts:5-8`), pas prouvée.
5. Connexion/déconnexion/inscription (bcrypt, cookies, révocation).
6. Token cron du scheduler (`heartbeatAuth.ts:10`).
7. Rendu et parsing client (§ ci-dessus) : la chaîne « une dérive serveur →
   erreur visible », raison d'être des contrats (`CONTRIBUTING.md:30-33`),
   n'est prouvée que sur les schémas, jamais sur `lib/api.ts`.

## 6. Les cinq portes, puis la CI

Les cinq commandes, dans l'ordre où `CONTRIBUTING.md:11-17` les exige (et
celui de `ci.yml:30-34`) :

| #   | Commande            | Script                                         | Ce qu'elle attrape                                                                                  |
| --- | ------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | `pnpm format:check` | `prettier --check .` (`package.json:12`)       | Dérive de formatage vs `.prettierrc` (dont `printWidth: 80`, `.prettierrc:4`)                       |
| 2   | `pnpm lint`         | `oxlint --deny-warnings .` (`package.json:15`) | Erreurs statiques, avertissements bloquants                                                         |
| 3   | `pnpm check`        | `tsc --noEmit` (`package.json:10`)             | Typage strict des 3 plans + configs (`tsconfig.json:2,8`) — couvre donc les fichiers **non testés** |
| 4   | `pnpm test`         | `vitest run` (`package.json:13`)               | Les 223 tests du §2 (logique pure, contrats)                                                        |
| 5   | `pnpm build`        | `vite build && esbuild …` (`package.json:8`)   | Résolution d'imports, bundle client + serveur                                                       |

Ordre logique : du moins coûteux (format) au plus coûteux (build), le type
check précédant le test pour que les erreurs de compilation ne masquent pas
les échecs de comportement.

La CI ajoute quatre étapes après (`ci.yml:35-57`) : `pnpm audit --audit-level
high` (`:36`), `docker build -t uptimepulse:ci .` (`:38`), fumée conteneur :
`docker run` sans base ni env, 30 essais `curl /api/health` (`:39-53` ; le
handler ne consulte rien, `server/_core/index.ts:41-44`), et gitleaks
(`:54-57`). Déclenchement : PR et push sur `main`, avec annulation des runs
périmés (`ci.yml:3-12`).

Lacunes **vérifiées** :

- **Aucun service MySQL** : `ci.yml` ne déclare pas de bloc `services` et
  n'injecte pas de `DATABASE_URL` ; ni la suite de tests ni la fumée ne
  touchent de base (§4).
- **Image construite mais jamais poussée** : aucune étape
  `docker login`/`docker push` dans `ci.yml` ; le tag `uptimepulse:ci` meurt
  avec le runner.
- **Aucun second workflow** : `.github/workflows` ne contient que `ci.yml`
  (vérifié par listing) — pas de publication, pas de déploiement, pas de
  tâche nocturne qui réveillerait les tests réseau.
- **Aucun hook de pré-commit** : pas de `.husky/`, pas de clé `lint-staged`,
  pas de `.pre-commit-config.yaml` (vérifié à la racine) ; les cinq portes ne
  sont donc appliquées qu'en CI, après coup.

## 7. Comment ajouter un test ici

Conventions réellement en vigueur (déduites des 23 fichiers) :

1. **Imports explicites** : chaque fichier d'import commence par
   `import { describe, expect, it } from "vitest"` — ex.
   `server/monitors/ssrf.test.ts:1`. Les 23 fichiers le font (vérifié par
   grep `grep -L 'from "vitest"'` : 0 manquant), obligation dictée par
   `tsconfig.json:18` dont `types` liste `["node", "vite/client"]` sans
   `vitest/globals`.
2. **Colocalisation** : le test porte le nom du module testé, à côté de lui
   (`qa/report.ts` ↔ `qa/report.test.ts`) ; seul le glob
   `vitest.config.ts:18-26` l'exécute — côté client, uniquement dans
   `client/src/lib`.
3. **Temps injecté** : passer `now`/`NOW` en paramètre ou en argument du
   `run(db, now)` (`server/qa/selfTest.test.ts:18,116`) ; ne jamais utiliser
   d'horloge simulée ni `Date.now()` nu dans une assertion. Pour env, préférer
   `vi.stubEnv` + `unstubAllEnvs` (`server/auth/owner.test.ts:24,33`) à
   l'écriture brute de `process.env` (cf. §3, exception à ne pas reproduire).
4. **Faux objets fabriqués à la main** : `fakeDb`/`stubDb` (§4) ; `vi.mock`
   réservé à une frontière non franchissable, un seul précédent
   (`server/_core/http.test.ts:4`). Aucun import de `getDb` dans un test.
5. **Libellés `it` en anglais, assertions en français quand le produit l'est** :
   les titres sont tous en anglais ; les textes métier FR sont verrouillés
   tels quels (`"moniteurs"` dans `server/plans/service.test.ts:55`,
   `"Transition refusée : closed → in_progress"` dans
   `server/qa/tickets.test.ts:64-65`, documents Markdown FR de
   `server/qa/report.test.ts:90-97`). Une nouvelle constante de plan, seuil ou
   libellé vit d'abord dans `shared/contracts.ts` (`CONTRIBUTING.md:35-37`).
6. **Parité zod ↔ enum MySQL déjà couverte** : ne pas la re-écrire ; le test
   existant est `shared/contracts.test.ts:873-879` (« keeps the database enum
   and the wire enum on the same values », comparant `checkClassificationValues`
   de `shared/contracts.ts` à celui de `shared/db/schema.ts`, import
   `:2`). Toute nouvelle classification doit être ajoutée **aux deux listes
   dans le même commit**, ce test la refuse sinon.
7. **Cibles réseau** : `CONTRIBUTING.md:55` impose des cibles contrôlées par
   le projet ; le précédent `server/checks/client.test.ts` (example.com,
   Spotify) est toléré mais contesté (§3) — un nouveau test doit préférer un
   serveur local non bloqué par le garde SSRF ou une injection, sinon la
   suite devient dépendante de l'egress.
8. **Avant la PR** : les cinq portes dans l'ordre (§6),
   `pnpm exec vitest run` pour le compte local, et pas de faux
   positifs : `pnpm test` ne lance ni base, ni migration, ni rendu — un test
   « vert » n'y prouve que la logique pure.
