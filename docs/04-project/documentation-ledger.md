# Registre des corrections documentaires

Ce fichier trace chaque affirmation corrigée dans la documentation du dépôt,
avec la mesure qui a tranché. Il existe pour une raison précise : une
documentation non contestable n'est utile que si l'on sait ce qu'elle a
abandonné comme hypothèse.

La méthode utilisée pour chaque point : lire le symbole dans le code, ou
l'exécuter. Aucune correction n'a été faite « parce qu'une autre page dit le
contraire ».

## 1. Identifiants de base de données

Le schéma Drizzle nomme ses colonnes en `camelCase` et le SQL généré les entoure
d'accents graves. Toute recopie d'un identifiant `snake_case` dans une console
MySQL renvoie `Unknown column` : c'est le type d'erreur qui fait perdre une
après-midi.

| Emplacement corrigé                  | Écrivait                                                                                                                            | Réel                                                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `api.md` §Tables                     | `checked_at`, `next_check_at`, `email_normalized`, `expires_at`, `reporter_token`, `(user_id, status)`                              | `checkedAt`, `nextCheckAt`, `emailNormalized`, `expiresAt`, `reporterToken`, `qa_tickets_owner_status_idx (userId, status)` |
| `api.md` §Tables                     | index `(monitor_id, checked_at DESC)`                                                                                               | `ping_logs_monitor_checked_idx (monitorId, checkedAt)`, **déclaré ascendant** (`shared/db/schema.ts:190-193`)               |
| `api.md` §Tables                     | index `(expires_at)` isolé                                                                                                          | `sessions_user_expiry_idx (userId, expiresAt)` composite (`schema.ts:90-93`)                                                |
| `api.md` §Tables                     | « les buckets de rate limit » comme table                                                                                           | aucune table : `Map` en mémoire de processus, bornée à 10 000 (`server/auth/rateLimit.ts:3,10`)                             |
| `qa-support.md` §2                   | `reporter_token`                                                                                                                    | `reporterToken` (`schema.ts:358`)                                                                                           |
| `status-page-analysis.md` §2, §3, §6 | `checked_at`, `started_at`, `resolved_at`, `duration_seconds`, `monitor_id`, `is_up`, `ssl_valid_to` / `ssl_issuer` / `ssl_subject` | `checkedAt`, `startedAt`, `resolvedAt`, `durationSeconds`, `monitorId`, `isUp`, `sslValidTo` / `sslIssuer` / `sslSubject`   |
| `decisions.md` ADR-004               | « les monitors dus par `next_check_at` »                                                                                            | `lte(monitors.nextCheckAt, …)` (`server/scheduler/tick.ts:52`)                                                              |

La liste complète des index, relevée table par table dans `shared/db/schema.ts`,
est maintenant publiée dans `api.md` §Tables.

## 2. Le régime visuel

Trois fichiers décrivaient un thème sombre réservé aux routes d'exploitation,
dérivé du chemin dans `client/src/App.tsx` via une fonction `isClientRoute`.

Mesure : `isClientRoute` n'apparaît **que** dans `docs/02-technical/access-model.md`.
Le code monte un unique `<ThemeProvider defaultTheme="light">`
(`client/src/App.tsx:28`), sans `forcedTheme` ni `switchable`. Le bloc `.dark`
(`client/src/index.css:141-194`) et la plomberie de `ThemeContext.tsx` existent
mais n'ont aucun appelant.

Corrections : ADR-017 marqué **reversé** et conservé comme historique, ADR-018
écrit pour la décision actuelle, `access-model.md` réécrit, `cahier-des-charges.md`
§4 et les légendes des figures 2, 3, 4 mises à jour, ligne « tableau de bord
sombre » supprimée. Deux pièges pour une future réactivation sont nommés : `ui/sonner.tsx:5`
lit le `useTheme()` de next-themes et non celui du provider monté, et
`.auth-input` est utilisé bien au-delà des écrans d'authentification (`Dashboard`,
`Settings`, `QaQueue`, `AdminConsole`, `QaTicketDetail`).

`README.md` porte la même affirmation erronée ; il est réécrit intégralement à la
phase suivante plutôt que corrigé deux fois.

## 3. Le plafond d'échantillonnage de latence

Quatre passages écrivaient « borné à 4 032 lignes ». La constante appliquée est
`LATENCY_SAMPLE_CAP_PER_MONITOR = 2 × 7 × 288 + 288 = 4 320`
(`server/statuspages/analysis.ts:36-39`) : 4 032 est le **pire cas théorique**
sur 14 jours à l'intervalle minimum de 300 s, 288 est la marge d'une journée.
`status-page-analysis.md` §4, lui, était juste : les quatre autres passages
recopiaient la moitié de sa phrase en perdant la marge.

Corrigé dans `cahier-des-charges.md` EF-17, figure 7, Annexe A, et
`plans-and-billing.md`. Vérifié au passage : le panneau méthodologie de la page
publique affiche `methodology.latencySampleCap`, donc la valeur réellement
affichée à l'écran est 4 320.

## 4. Un symbole inventé

`cahier-des-charges.md` Annexe A ouvrait sur `CLAIM_LEASE 360 000 ms`. Aucun
symbole de ce nom n'existe dans `server/` ni `shared/` : le bail de six minutes
est un littéral inline, `new Date(Date.now() + 6 * 60 * 1000)`, écrit dans l'UPDATE
conditionnel qui sert de claim atomique (`server/checks/engine.ts:97-108`).
L'annexe nomme désormais le comportement et sa ligne, pas un constant imaginaire.

## 5. Ce qui est semé, et ce qui ne l'est pas

`qa-support.md` §12 et `status-page-analysis.md` §9 disaient d'ouvrir
`/status/demo-services`. Mesure : `demo-services` n'apparaît dans le dépôt **que**
dans des fixtures de test (`server/qa/report.test.ts`), aucun seed ni migration
ne l'insère, et l'unique seed SQL du projet écrit les trois paliers de `plans`
(`shared/db/0007_clever_kulan_gath.sql`). La commande copiée répondait donc
`404 NOT_FOUND` sur une base neuve.

Même cause pour `access-model.md` qui affirmait que les comptes
`demo@uptimepulse.dev` et `demo@uptimepulse.local` étaient « toujours en base » :
aucun artefact du dépôt ne les crée, l'affirmation portait sur une base de
développement qui n'est pas livrée.

Les deux procédures décrivent maintenant le geste réel (créer un moniteur et une
page de statut depuis `/settings`, lire le slug). Les légendes des captures
`docs/images/` portent une reserve de provenance : elles montrent un instant
donné, pas un jeu de données rejouable, et deux d'elles montrent un régime sombre
qui n'existe plus.

## 6. Compteurs et chiffres

| Affirmation                       | Mesure                                                                                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qa-support.md` : « 184 tests »   | `pnpm exec vitest run` du 2026-10-19 : **22 fichiers, 219 tests passés**. La note indique aussi que `server/checks/client.test.ts` sort sur le réseau (`example.com`, un `.invalid`, une page réelle > 256 Ko), ce que `CONTRIBUTING.md` interdit. |
| `decisions.md` changelog : ESLint | aucun fichier de configuration ESLint et aucune dépendance ; l'analyseur est oxlint (`package.json:15,67`, aucune `.oxlintrc.json` dans le dépôt)                                                                                                  |
| `cahier-des-charges.md` §0        | branche `refactor/restructure-architecture`, base `0ebf423`, remote `UptimePusle.git` : le dépôt local est maintenant `main` @ `979ed3a`, **sans aucun remote** configuré                                                                          |
| Annexe A : limites de débit       | liste incomplète — ajout de 10 par 15 min (intake QA, `qa/routes.ts:165`), 5 par 15 min (`password:{userId}`, `channel:{userId}`) et 3 par 15 min (`channel-test:{userId}`, `notifications/routes.ts:163`)                                         |
| Annexe A : « 3 tentatives »       | précisé : trois tentatives **dans la même passe** (`dispatcher.ts:53-54`), le compteur `attempts` s'accumule entre les passes, et l'auto-test alerte dès `attempts >= 3` (`selfTest.ts:36,286`)                                                    |

## 7. Le point quotidien : produit, mais transporté par personne

`cahier-des-charges.md` EF-41 note la livraison du digest **ABSENT**. Cette
correction va dans l'autre sens qu'on attendrait : la génération, elle, est bien
automatique — chaque tick de 30 s appelle `maybeRunDailyDigest`
(`server/scheduler/tick.ts:92-93`), qui réserve une place sur une clé de jour UTC
(`digest.ts:219-222`). Ce qui manque est le **transport** : aucun SMTP, aucun
envoi vers les canaux de notification, aucun cron externe qui récupère le point.
`qa-support.md` §7 et son tableau de missions l'écrivent maintenant noir sur
blanc, avec les deux fenêtres (contenu sur 24 h glissantes, passe réservée par
jour UTC) et la façon dont un échec reste invisible
(`digest.ts:381-382,394-402`).

## 8. Vocabulaire technique

`security.md` parlait de « token bucket » pour deux des trois passages.
`consumeRateLimit` implémente une **fenêtre fixe** : un compteur remis à zéro
quand `resetAt` est dépassé (`rateLimit.ts:41-42`), pas un bassin qui se
réapprovisionne en continu. La nuance change le comportement observable — une
rafale en début de fenêtre est refusée alors qu'un token bucket l'aurait passée.
La section explique aussi désormais le balayage et l'éviction FIFO au-delà de
10 000 clés (`rateLimit.ts:17-31`).

## 9. Chemins de répertoires

`README.md` (table d'architecture) et `.env.example` pointerent un dossier
`drizzle/`. Les migrations et le schéma vivent dans `shared/db/`
(`drizzle.config.ts:9-10`). `.env.example` corrigé ici ; `README.md` à la phase
suivante.

`.env.example` déclarait 8 variables alors que le code en lit 15. Les sept
manquantes sont ajoutées, avec pour chacune son régime : `UPTIMEPULSE_OWNER_EMAIL`
et `SCHEDULER_INTERNAL` sont utiles dès qu'on sort du poste du créateur, les sept
`MANUS_*` et `OWNER_OPEN_ID` appartiennent au domaine plateforme **dormant** (le
client ne fait aucun appel vers `/api/oauth`, et `sdk.authenticateRequest` n'a
aucun appelant). Le décompte complet, variable par variable avec son site de
lecture, est dans `docs/03-infrastructure/environnement.md`.

## Une mesure qui n'était pas une correction documentaire

Rédiger `docs/03-infrastructure/deploiement.md` a produit autre chose qu'une
correction de texte : le bundle serveur `dist/index.js` importait statiquement
`vite`, `@vitejs/plugin-react` et `@tailwindcss/vite`
(`server/_core/index.ts:9` → `server/_core/vite.ts:6-7`, les deux d'alors →
`vite.config.ts:1-2`), alors que ces trois paquets sont en `devDependencies`
(`package.json:47,48,53,63`) et que le stage runtime de l'image installe avec
`--prod` (`Dockerfile:35`). Le conteneur ne pouvait donc pas démarrer. Reproduit
en renommant `node_modules/vite` puis en lançant `node dist/index.js` :
`ERR_MODULE_NOT_FOUND: Cannot find package 'vite'`. Le CI qui lance l'image et
sonde `/api/health` (`.github/workflows/ci.yml:39-53`) l'aurait refusé ; il n'a
jamais tourné. Ce n'était pas une affirmation documentaire fausse mais un défaut
de code.

## Deux défauts de code trouvés en documentant, et corrigés

**`83ca3a8` — le bundle de production importait des dépendances de
développement.** Corrigé par import dynamique de Vite dans `setupVite`
(`server/_core/vite.ts:10`), lecture de la config par Vite lui-même (`:13`,
`configFile:`) et sortie de `serveStatic` vers son propre module
(`server/_core/static.ts`). Mesuré après coup : plus aucun paquet Vite dans les
imports statiques de `dist/index.js`, et `NODE_ENV=production node dist/index.js`
démarre avec `node_modules/vite`, `node_modules/@tailwindcss/vite` et
`node_modules/@vitejs/plugin-react` renommés. L'image elle-même reste à
construire : Docker n'est pas installé sur ce poste.

**`3728469` — quatre détections d'erreur de base étaient inertes.** Drizzle 0.44
enveloppe chaque échec d'instruction dans un `DrizzleQueryError` qui ne porte pas
`code` (il est sur `.cause`) et dont le message est le texte SQL avec ses valeurs
liées. Les tests `error.code === "ER_DUP_ENTRY"` du saut de période QA
(`server/qa/runs.ts:25`), du `409 SLUG_TAKEN` (`server/statuspages/routes.ts:126`)
et de la déduplication des notifications
(`server/notifications/dispatcher.ts:123`) ne se déclenchaient donc jamais, pas
davantage que la liste `DATABASE_HINTS` du gestionnaire d'erreur
(`server/_core/http.ts:98-105`, `:107-109`) : une panne de base répondait `500`
au lieu de `503`. Le déballage est désormais centralisé dans
`server/_core/db-error.ts`, et la journalisation passe par `safeErrorMessage`
(`:47`) pour que le texte de la requête — et les valeurs liées qui passent par
les mêmes insertions que les hachages de mot de passe et les tokens chiffrés — ne
puisse plus atteindre un log ni un ticket QA.

Preuve observée du second défaut, relevée pendant la vérification du premier : le
démarrage du bundle journalisait
`{"event":"qa_self_test_error","message":"Failed query: insert into `qa_runs` …
params: self_test,2026-10-19T12:00"}` alors qu'un autre processus de développement
tenait déjà la période. Le saut silencieux attendu produisait donc un message
d'erreur. Après le correctif, le même démarrage ne journalise rien.

Les tests existants n'ont rien vu passer : `server/platform.test.ts` fabriquait
un `Error` portant `.code` au premier niveau, précisément la forme que Drizzle ne
produit plus. Le cas ajouté jette maintenant la forme de l'enveloppe. C'est la
leçon à retenir pour toute assertion sur une erreur de pilote : construire
l'objet d'erreur que le code reçoit vraiment.

## Les numéros de ligne après les deux correctifs

Les commits `83ca3a8` et `3728469` ajoutent ou retirent des lignes en tête de
onze modules : `import { safeErrorMessage } …` en ligne 2 de `selfTest.ts`,
`digest.ts`, `tick.ts`, `loop.ts` et `engine.ts`, import de `db-error` dans
`http.ts`, sortie de `serveStatic` vers son propre module, et suppression de
douze lignes dans `dispatcher.ts`. Toute citation `fichier:ligne` écrite avant
ces commits désignait donc une à quinze lignes trop haut.

- **38 citations repositionnées.** Pour chacune, la fenêtre des trois lignes du
  fichier tel qu'il était à `df4db5c` est cherchée dans le fichier actuel ; une
  citation n'est déplacée que si la fenêtre tombe **exactement une fois**, et
  seulement sur les lignes de documentation inchangées depuis `df4db5c` — les
  lignes réécrites à la main avaient déjà été revérifiées.
- **Le recalcul arithmétique est un faux ami.** Appliqué mécaniquement, il
  aurait « corrigé » `server/qa/runs.ts:25`, qui désigne bien depuis `3728469` le
  `if (isDuplicateKeyError(error)) return null;`, en `:26`. Une citation écrite
  après le correctif est juste et ne doit pas bouger : c'est précisément la
  règle « ligne de doc inchangée depuis `df4db5c` » qui protège ces cas.
- **Deux dérives que l'alignement des lignes ne voyait pas.**
  `docs/01-product/vision.md:25` est une ligne vide, l'affirmation citée est en
  `:26` ; `docs/02-technical/qa-support.md:185-187` a glissé, la purge y est
  décrite en `:195`. La seconde a permis de lever une réserve : la purge de
  rétention tourne à chaque passe (`server/scheduler/tick.ts:77-79`) et la passe
  a lieu toutes les 30 s (`server/scheduler/loop.ts:19,38`) ; le « once per
  minute » de `shared/db/schema.ts:294-295` décrit le scan d'avant l'index, pas
  la cadence. `modele-donnees.md` portait cette réserve en l'état, elle est
  remplacée par la mesure.
- **Un compte erroné dans une page sœur.** `observabilite.md` annonçait
  « quatorze sites sans champ `event` » et en énumérait seize, `server/_core/sdk.ts:38`
  étant compté une fois dans le chapeau et une fois dans la liste des lignes
  d'`sdk.ts`. Recompté site par site (`db.ts` 3, `sdk.ts` 6, `notification.ts` 2,
  `oauth.ts` 1, `static.ts` 1, `index.ts` 3) : **seize**. Le chiffre et la phrase
  d'introduction sont corrigés, ainsi que `00-sommaire.md` qui colportait 14.
- **L'état du dépôt.** `cahier-des-charges.md` annonçait « `main`, un seul
  commit ». Mesuré à ce moment-là : la branche de travail est
  `refactor/restructure-architecture`, sept commits depuis `979ed3a`, et `main`
  s'arrête à `df4db5c` avec cinq commits. Le premier chiffre est une date, pas
  un état : la branche a grandi depuis et se recompte avec
  `git rev-list --count 979ed3a..HEAD`.

Contrôle final de cette passe : 999 citations balayées dans 30 fichiers
markdown, aucune hors plage, aucun ancrage tombant sur une ligne vide ou sur de
la simple ponctuation. Ce compte-là vient d'un contrôle ponctuel antérieur à
l'outil et n'est pas rejouable. Ce qui est mesuré, en revanche : le corpus de
l'époque (à `36687b8`) contenait déjà 967 références à chemin complet et 810
références à nom de fichier seul. Le chiffre courant, plus élevé, vient donc de
l'élargissement du balayage par `scripts/check-citations.mjs`, pas d'un gros
volume de documentation ajouté depuis.

## Le ménage de code et sa resynchronisation documentaire

Le nettoyage (phase 3 de la restructuration) retire du code mort ; chaque
retrait a d'abord été prouvé mort par grep sur le dépôt entier, puis les
citations qui pointaient dessus ont été repositionnées.

- **CSS orphelin** : 284 lignes sur 959 (`client/src/index.css` ramené à 675
  lignes), sept plages — `.reveal` et ses keyframes et retards, `.parallax-*`,
  `.glass`, `.gradient-border`, `.magnetic`, `.animate-count-up`,
  `.animate-float-ambient`, `.animate-mesh`, `.page-transition-*`,
  `.ecg-sweep`. Sont gardés parce qu'ils ont des consommateurs : `.ecg-line`,
  `.spotlight`, `.tilt-frame`, `.shadow-*`.
- **TypeScript orphelin** : `client/src/hooks/useScrollReveal.ts` (4 hooks,
  zéro importateur ; l'équivalent vivant est `components/uptime/Reveal.tsx`),
  les répertoires vides `client/src/_core/` et `client/src/_core/hooks/`,
  `apiRequest` (alias de `request`, jamais importé), `encodeOAuthState` (l'`state`
  est fabriqué par la plateforme), `BadRequestError` / `UnauthorizedError` /
  `NotFoundError` (`ForbiddenError` est gardé : quatre `throw` dans
  `server/_core/sdk.ts`), `updateHeartbeatJob`, `deleteHeartbeatJob` et leur
  type, `shared/db/relations.ts` (stub de 27 octets, zéro importateur) et
  `server/_core/types/cookie.d.ts` — celui-ci retiré puis **prouvé** redondant :
  `cookie@1.0.2` livre ses propres types et `tsc --noEmit` passe sans le shim.
- **Dépendances** : douze paquets sans un seul import (`autoprefixer`,
  `postcss`, `tailwindcss-animate`, `@tailwindcss/typography`,
  `class-variance-authority`, sept `@radix-ui/*` hors `react-tooltip`),
  539 lignes de `pnpm-lock.yaml` en moins, réinstallés hors ligne. Quatre
  faux positifs sont conservés parce que le **serveur** les importe : `axios`
  (`server/_core/sdk.ts:8`), `superjson` (`server/_core/trpc.ts:3`),
  `@trpc/server` (`TRPCError` dans `heartbeat.ts:1` et `notification.ts:1`) et
  `next-themes` (`ui/sonner.tsx:1`, provider non monté).
- **Arborescence** : `server/routes/dashboard.ts` devient
  `server/dashboard/routes.ts`, seul écart à la convention
  `server/<module>/routes.ts` ; un seul site d'import
  (`server/_core/index.ts:13`) et cinq citations d'écrits repointés.
- **Numéros de ligne.** Le décalage d'une suppression pure se calcule à partir
  des hunks `git diff` (offset cumulé avant chaque ligne), pas d'une
  soustraction arbitraire : `index.css` décale de −32, −210, −218, −221, −238,
  −275 puis −284 selon la zone, `api.ts` de −8 au-delà de 183, `package.json`
  de −12 au-delà de 70. Les seize plages du tableau §6.4 de `client.md`, les
  trente et une lignes du tableau §2.3 et les citations `package.json:` de
  cinq fichiers ont été repondues puis revérifiées à la main sur le fichier
  cible (par exemple `api.publicStatus` `:290-294`, `validateCallbackPath`
  `:118-125`, `packageManager` `:66`).
- **Deux citations cassées trouvées par l'outil, et deux affirmations fausses
  trouvées en chemin.** `server/notifications/dispatcher.ts` était cité aux
  lignes 248–255 alors que le fichier en compte 244 — la fonction est en
  réalité aux lignes 236–243 ; `server/qa/digest.test.ts` était renvoyé à sa
  ligne 37 pour 36 lignes. Et le commentaire qui accompagnait cette dernière
  disait « limites digest », alors que ce fichier ne teste que
  `digestPeriodKey:38` : les fonctions de fenêtre et de plafond sont justement
  sans test. Le texte suit la mesure, pas l'ancienne étiquette.
- **Outil ajouté au dépôt** : `scripts/check-citations.mjs` (aucune
  dépendance, `node scripts/check-citations.mjs`). Il résout les chemins
  complets et les noms de fichier seuls, et contrôle que la cible existe et
  que la plage est dans les limites. Il ne juge pas le contenu d'une ligne,
  et signale sans compter les références à nom de fichier seul trop ambiguës
  pour être résolues (`routes.ts:161-168` : huit fichiers du même nom).
  Le compteur (dernier rendu : 2026-10-19) est la sortie de l'outil, pas un
  chiffre à ressaisir à la main : il bouge dès qu'une page gagne ou perd une
  référence, y compris ce ledger.
- **Portes après le ménage** : `tsc` sans erreur, `oxlint` 0 warning / 0 erreur
  sur 128 fichiers, 23 fichiers et 223 tests verts, `prettier --check` propre,
  `pnpm build` à 235.9 kb de bundle serveur. Le bundle production démarre et
  répond `200` sur `/`, `/dashboard`, `/status/demo-services`, `/support`,
  `/api/health`, `/api/plans` et `401` sur `/api/dashboard`, `/api/qa/overview`
  et `/api/notification-channels`, avec une passe d'ordonnanceur sans erreur.
- **Ce qui n'a volontairement pas été fait** : renommer `.auth-input` (27
  utilisations, bénéfice purement cosmétique et risque de casse silencieuse si
  un site est manqué — le nom prête à confusion, c'est écrit dans
  `client.md` §7.3 au lieu d'être corrigé dans le code) ; supprimer le patch
  wouter, `client/public/manus-routes.json`, `clearEvidence()` ou le bloc
  `.dark`, dont un lecteur hors `client/` n'a pas pu être écarté.

## Vérifications avant poussée

La phase « finalisation opérationnelle » ne peut pas prouver ce qui exige un
serveur MySQL ou un dépôt distant. Ce qui a pu être mesuré ici, le 2026-10-19 :

- **Chaîne de migrations à jour.** `npx drizzle-kit generate` répond « No
  schema changes, nothing to migrate » et ne crée aucun fichier : `git status`
  reste propre après la commande. Le schéma TypeScript et les huit snapshots de
  `shared/db/meta/_journal.json` sont alignés. Rejouer `0000` à `0007` sur une
  base vide n'est pas fait, et la raison est écrite dans
  `docs/05-exploitation/prise-en-main.md` §3.
- **Compatibilité des dépendances.** Les 41 entrées de `dependencies` et
  `devDependencies` (`package.json:21-65`, 24 + 17) sont toutes installées et
  satisfont leur plage déclarée, comparées paquet par paquet. Le workspace
  passe ensuite `CI=true pnpm install --frozen-lockfile --offline` sans un seul
  octet du réseau : le verrou produit par le retrait des douze paquets inertes
  est cohérent avec le manifeste.
- **Portes re-courues après le ménage** : les cinq portes sont vertes (voir
  plus haut « Le ménage de code et sa resynchronisation documentaire »), et le
  serveur de développement répond de nouveau `200` sur `/`, `/dashboard`,
  `/status/demo-services`, `/support`, `/api/health`, `/api/plans` et `401` sur
  `/api/dashboard`, `/api/qa/overview`.

Ce qui reste hors de portée d'ici : l'exécution de la CI (aucun remote), le
build de l'image Docker (Docker absent), les six captures d'exploitation (compte
du créateur), et la poussée elle-même, qui attend une URL de dépôt et un jeton.

## Ce que ces corrections ne prétendent pas

Aucune des mesures ci-dessus n'a été faite contre une base de production : la
base locale utilisée pour les vérifications est vide de moniteur et de page de
statut, et le dépôt ne contient ni service MySQL ni fichier compose. Les
affirmations sur les limites de débit, les enveloppes d'erreur et les transitions
d'état viennent donc de la lecture du code et des 223 tests, pas d'un trafic
observé. Les six captures d'écrans d'exploitation (`/dashboard`, `/monitors/:id`,
`/settings`, `/qa`, `/console`, `/login` en régime courant) restent à produire :
elles exigent le compte du créateur.
