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
| `decisions.md` ADR-004               | « les monitors dus par `next_check_at` »                                                                                            | `lte(monitors.nextCheckAt, …)` (`server/scheduler/tick.ts:51`)                                                              |

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
conditionnel qui sert de claim atomique (`server/checks/engine.ts:96-107`).
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
(`server/scheduler/tick.ts:91-92`), qui réserve une place sur une clé de jour UTC
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

## Une mesure qui n'est pas une correction documentaire

Rédiger `docs/03-infrastructure/deploiement.md` a produit autre chose qu'une
correction de texte : le bundle serveur `dist/index.js` importe statiquement
`vite`, `@vitejs/plugin-react` et `@tailwindcss/vite`
(`server/_core/index.ts:9` → `server/_core/vite.ts:6-7` →
`vite.config.ts:1-2`), alors que ces trois paquets sont en `devDependencies`
(`package.json:56,58,63,75`) et que le stage runtime de l'image installe avec
`--prod` (`Dockerfile:35`). Le conteneur ne peut donc pas démarrer. Reproduit en
renommant `node_modules/vite` puis en lançant `node dist/index.js` :
`ERR_MODULE_NOT_FOUND: Cannot find package 'vite'`. Le CI qui lance l'image et
sonde `/api/health` (`.github/workflows/ci.yml:39-53`) l'aurait refusé ; il n'a
jamais tourné. Ce n'est pas une affirmation documentaire fausse mais un défaut de
code, et il est traité en Phase 4, pas ici.

## Ce que ces corrections ne prétendent pas

Aucune des mesures ci-dessus n'a été faite contre une base de production : la
base locale utilisée pour les vérifications est vide, et le dépôt ne contient ni
service MySQL ni fichier compose. Les affirmations sur les limites de débit, les
enveloppes d'erreur et les transitions d'état viennent donc de la lecture du
code et des 219 tests, pas d'un trafic observé. Les six captures d'écrans
d'exploitation (`/dashboard`, `/monitors/:id`, `/settings`, `/qa`, `/console`,
`/login` en régime courant) restent à produire : elles exigent le compte du
créateur.
