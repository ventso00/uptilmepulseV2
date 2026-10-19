# Déploiement

## État réel de la chaîne de déploiement

À lire avant tout le reste : deux affirmations optimistes de versions
antérieures de cette documentation y ont été corrigées, et la troisième est une
mesure ajoutée le 2026-10-19.

- **le bundle de production démarre sans les dépendances de développement, mais
  l'image Docker n'a jamais été construite**. Le blocage d'import qui tuait
  `dist/index.js` au premier listen est corrigé et reproduit ici même (« Blocage
  de démarrage : corrigé et mesuré » plus bas). Docker n'est pas installé sur la
  machine de développement : `docker build` et `docker run` n'ont été exécutés
  par personne. Ce qui est prouvé, c'est le bundle ; ce qui reste à prouver,
  c'est l'image.
- **les huit migrations passent sur une base vide, mais sur MariaDB**. Rejouées
  le 2026-10-19 sur un schéma jetable local, idempotentes au second passage, et
  le bundle de production démarré dessus (§« Base de données au premier
  déploiement »). Oracle MySQL 8 n'a jamais reçu ce SQL.
- **aucun pipeline n'a jamais été exécuté à distance**. Le dépôt n'a pas de
  remote et ne porte qu'une histoire locale (le compte courant se lit avec
  `git rev-list --count 979ed3a..HEAD`) ; le workflow CI décrit plus bas est
  écrit, pas éprouvé. L'étape `docker build` + `curl /api/health` n'a jamais
  été exécutée.

Le reste de la page documente ce qui est prêt, ce qui bloque, et comment combler
les deux.

## Prérequis

| Besoin  | Valeur                                                         | Source                                                                                                                                                                                          |
| ------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js | 22                                                             | `.github/workflows/ci.yml:27`, `Dockerfile:5,14,22` (`node:22-bookworm-slim`). Aucun champ `engines` dans `package.json` : la version n'est pas gardée par pnpm, c'est une convention de build. |
| pnpm    | 10.18.0                                                        | `packageManager` de `package.json`, verrouillé aussi dans le CI (`ci.yml:22-24`) et par `corepack prepare` à chaque étage de l'image.                                                           |
| Base    | MySQL ou MariaDB compatible, driver `mysql2`                   | `server/db.ts:24`, `drizzle.config.ts:10` (`dialect: "mysql"`).                                                                                                                                 |
| TLS     | Un reverse proxy HTTPS **obligatoire** pour l'authentification | voir « HTTPS » plus bas.                                                                                                                                                                        |

## De la source au bundle

`pnpm build` (`package.json:8`) enchaîne deux productions distinctes :

1. `vite build` écrit le client dans `dist/public`
   (`vite.config.ts:192-193` : `outDir` résolu en `dist/public`) ;
2. `esbuild server/_core/index.ts --platform=node --packages=external --bundle
--format=esm --outdir=dist` écrit `dist/index.js`.

`--packages=external` est le point à comprendre : esbuild inline le source du
projet — y compris `shared/` — mais laisse chaque import de paquet sous forme
d'`import` Node résolus à l'exécution. Le bundle porte donc la liste réelle des
dépendances de runtime, et cette liste se lit :

```bash
grep '^import .*from "[^./]' dist/index.js | sed -E 's/.*from "([^"]+)".*/\1/' | sort -u
```

Sur le dépôt actuel elle contient `express`, `@trpc/server`, `drizzle-orm`,
`mysql2`, `jose`, `bcryptjs`, `cookie`, `nanoid`, `superjson`, `zod`, `axios`,
`ipaddr.js` et les modules `node:*` — et plus rien de la famille Vite. `dotenv`
entre aussi en runtime, par un import d'effet (`server/_core/index.ts:1`) que ce
filtre ne montre pas. `import("vite")` n'apparaît qu'une fois, comme import
dynamique dans `setupVite` (`server/_core/vite.ts:10`), donc jamais exécuté en
production. Avant la correction, `vite`, `@vitejs/plugin-react` et
`@tailwindcss/vite` étaient remontés en imports statiques parce que `vite.ts`
importait `vite.config.ts` en dur ; `dist/index.js` est passé de 240,4 ko à
235,9 ko.

Un serveur lancé avec `NODE_ENV` différent de `development` sélectionne
`serveStatic(app)` (`server/_core/index.ts:74-77`), qui résout le dossier des
assets ainsi (`server/_core/static.ts:6-8`) :

- en `development` : `<racine>/dist/public` ;
- sinon : `dossier-du-bundle/public`, soit `/app/dist/public` dans l'image.

Les deux chemins désignent le même arbre produit par `vite build`, ce qui fait
que `node dist/index.js` fonctionne depuis la racine du dépôt sans rien copier.

## Image Docker

Trois étages (`Dockerfile`), tous sur `node:22-bookworm-slim` :

**deps** (`:3-11`) — active Corepack, copie les quatre fichiers de manif
(`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `shared/package.json`)
plus `patches/`, puis `CI=1 pnpm install --frozen-lockfile`. Le patch
`wouter@3.7.1` déclaré dans `pnpm-workspace.yaml` est la raison pour laquelle
`patches/` doit être copié avant l'install : sans lui, l'install à lockfile
verrouillé échoue.

**build** (`:13-19`) — `COPY --from=deps` des `node_modules`, `COPY . .` du
source, `pnpm build`.

**runtime** (`:21-48`) — `NODE_ENV=production` et `PORT=3000` (`:24-25`),
création d'un groupe et d'un utilisateur système `uptimepulse` gid/uid 1001
(`:28-29`), install **`--prod`** des dépendances puis purge du store pnpm
(`:34-37`), copie de `dist` depuis l'étage build avec le bon propriétaire
(`:39`), `USER uptimepulse` (`:41`), `EXPOSE 3000` (`:42`), `HEALTHCHECK` toutes
les 30 s sur `/api/health` avec 20 s de grâce et 3 retries (`:44-46`), et
`CMD ["node", "dist/index.js"]` (`:48`).

`.dockerignore` (`:1-8`) exclut `node_modules`, `dist`, `.git`, `.env`, `.env.*`
et `.manus-logs` : l'étage build re-télécharge donc les dépendances au lieu
d'embarquer celles de la machine, et aucun secret local ne peut fuiter dans une
couche.

### Ce que l'image runtime ne contient PAS

Conséquence directe des `COPY` des lignes 31-39, à intégrer dans la procédure
d'exploitation plutôt que de le découvrir en production :

- `shared/db/*.sql` et `shared/db/meta/` — les migrations ne sont pas dans
  l'image ;
- `drizzle-kit` et `drizzle.config.ts` — `pnpm db:migrate` ne peut pas se
  lancer depuis le conteneur, et `--prod` de la ligne 35 n'installerait de toute
  façon pas l'outil ;
- le source complet (`server/`, `client/`, `shared/`) — seul le bundle `dist`
  arrive.

**Les migrations se lancent donc depuis l'extérieur** du conteneur, avec un
Node 22 + pnpm et une installation complète. Rien dans le dépôt ne documente ce
choix — il découle des `COPY` et de l'`--prod`, et il faut l'intégrer à la
procédure plutôt que le découvrir en production.

### Blocage de démarrage : mesuré, puis corrigé

Le défaut était réel et reproduit, pas inféré :

```bash
mv node_modules/vite node_modules/vite.hidden
node dist/index.js
# node:internal/modules/package_json_reader:331
# Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from
#   <racine>/dist/index.js
```

C'est exactement l'état des `node_modules` du stage runtime, qui installe avec
`--prod` (`Dockerfile:35`) : `vite` est déclaré en `devDependencies`
(`package.json:47,63`), donc absent. Le bundle, lui, l'importait au niveau
supérieur, et Node évalue tous les `import` statiques avant la première ligne
exécutée — peu importe que la branche `serveStatic` soit celle qui tourne. Les
trois paquets venaient de `vite.config.ts`, importé en dur par
`server/_core/vite.ts`, que esbuild inline dans le bundle avec ses propres
imports de paquets.

**Le correctif retenu (le n° 1 sur trois) est appliqué** :

1. retenu — `setupVite` charge Vite par `await import("vite")`
   (`server/_core/vite.ts:10`) et passe le chemin de la config à Vite lui-même
   (`:13`, `configFile:`) au lieu de la spreader avec `configFile: false` ;
   `serveStatic` a quitté ce module pour `server/_core/static.ts`. Résultat
   mesuré : plus aucun paquet de la famille Vite dans les imports statiques de
   `dist/index.js`, `import("vite")` unique et jamais exécuté en production ;
2. refusé — installer sans `--prod` dans le stage runtime : outil de build dans
   le runtime, image plus lourde, surface d'attaque plus large ;
3. refusé — promouvoir `vite`, `@vitejs/plugin-react` et `@tailwindcss/vite` en
   `dependencies` : ces paquets ne servent qu'au dev.

Vérification faite sur ce poste, à deux reprises : `node_modules/vite`,
`node_modules/@tailwindcss/vite` et `node_modules/@vitejs/plugin-react` renommés,
`NODE_ENV=production node dist/index.js` démarre (`Server listening on port
3112`) et répond `200` sur `/`, `/status/demo-services`, un suivi `/support/…`,
`/api/health`, `/api/plans`, `/dashboard` et `/qa` ; puis les trois paquets sont
rendus et le mode développement revérifié (`NODE_ENV=development PORT=3113 npx
tsx server/_core/index.ts` : HTML transformé avec le préambule react-refresh,
`/src/main.tsx` 200, `/src/index.css` 200, `/api/platform/config.js` 200).

Ce que cette vérification **ne prouve pas** : Docker n'est pas installé sur ce
poste, donc `docker build` et `docker run` n'ont jamais été exécutés sur cette
image. Le bundle démarre sans dépendances de développement ; l'image héritait du
même défaut et n'a pas encore été reconstruite après le correctif.

Pourquoi le CI ne l'a jamais attrapé : le workflow construit l'image, la lance et
sonde `/api/health` (`ci.yml:39-53`), ce qui aurait dû échouer — mais ce job
n'a jamais tourné, faute de remote et de commit publié. Première piste à tirer
après la publication : laisser ce job prouver l'image.

## Base de données au premier déploiement

1. Créer la base et un utilisateur applicatif. Rien dans le dépôt ne crée la
   base elle-même ; `DATABASE_URL` suppose qu'elle existe.
2. Épingler la session en UTC du côté serveur si l'hôte MySQL tourne en heure
   locale. Le pool lève déjà `SET time_zone = '+00:00'` sur chaque connexion
   (`server/db.ts:34-36`) et lit les `Date` en UTC (`timezone: "Z"`,
   `server/db.ts:28`), mais une base dont les `TIMESTAMP` **existants** ont été
   écrits en heure locale doit être convertie une fois. Sans cela,
   `nextCheckAt <= now()` ne sélectionne plus aucun moniteur et tout reste
   `UNKNOWN`.
3. Appliquer les migrations. `pnpm db:push` = `drizzle-kit generate &&
drizzle-kit migrate`, `pnpm db:migrate` = `drizzle-kit migrate` seulement
   (`package.json:16-17`). Sur une base neuve, les huit fichiers `0000`→`0007` de
   `shared/db/` suffisent ; `drizzle.config.ts:9` déclare `out: "./shared/db"`,
   donc **pas de dossier `drizzle/`** à chercher.
4. Seule la table `plans` reçoit des données au migration (`INSERT IGNORE` des
   paliers dans `shared/db/0007_clever_kulan_gath.sql`). Aucun compte, aucun
   moniteur, aucune page de statut n'est semé. Un déploiement démarre sur une
   base vide, et l'inscription est verrouillée sur l'e-mail propriétaire : voir
   `docs/05-exploitation/prise-en-main.md`.

**La chaîne est maintenant exécutée sur base vierge** (mesure du 2026-10-19).
Un schéma jetable est créé sur le serveur du poste (`CREATE DATABASE
up_fresh_verify`), puis `npx drizzle-kit migrate` est lancé avec un
`DATABASE_URL` pointant dessus. Les huit fichiers passent : `__drizzle_migrations`
compte huit lignes, la base a quatorze tables, soit treize tables applicatives
plus le journal, et `plans` contient exactement les trois paliers attendus
(free 3 moniteurs, pro 25, business 100, tous les trois à `minIntervalSeconds`
300). Un second `drizzle-kit migrate` sur la même base ne lève aucune erreur et
ne bouge ni le journal (huit lignes) ni `plans` (trois lignes) : la commande est
idempotente, ce que le critère 2 de la §13 du cahier des charges revendiquait
sans l'avoir jamais mesuré. La contrainte `UNIQUE (kind, periodKey)` de
`qa_runs` est présente sous le nom `qa_runs_kind_period_unique`, lue dans
`information_schema.STATISTICS` — c'est le verrou du digest quotidien, et son
existence n'était jusqu'ici affirmée que par un commentaire de test.

Le bundle de production, démarré sur cette base avec `PORT=3001`, a répondu
`200` sur `/`, `/dashboard`, `/status/demo-services`, `/support` et
`/api/plans`, `401` sur `/api/monitors` et `/api/qa/overview`, et son journal
porte `qa_self_test`, `qa_daily_digest` puis `scheduler_tick` sans aucune ligne
d'erreur. Le schéma jetable a été supprimé après mesure, la base de travail n'a
pas été touchée.

Réserve à ne pas perdre : la cible était **MariaDB 11.4.5**, pas Oracle MySQL.
Le dialecte déclaré est `mysql` (`drizzle.config.ts:11`) et le pilote est
`mysql2`, donc le SQL produit est commun aux deux, mais un MySQL 8 hébergé
garde ses comportements propres (charset et `sql_mode` par défaut, `TIMESTAMP`
en fuseau serveur). La même chaîne reste à rejouer une fois sur l'hôte réel,
et c'est ce que réclame la checklist ci-dessous.

Vérification : `GET /api/health` ne teste **pas** la base
(`server/_core/index.ts:41-44`) — un `ok` là-bas ne prouve que le bind TCP. Le
témoin de santé réel est la ligne `scheduler_tick` dans les logs
(`server/scheduler/tick.ts:104`), et son absence avec `DATABASE_URL` renseigné
veut dire que `getDb()` a échoué (`server/db.ts:22`).

## HTTPS

Le cookie de session applicatif est posé avec `secure: true` et
`sameSite: "none"` (`server/auth/session.ts:15-23`, nom
`uptimepulse_session` en `:8`, durée 30 jours en `:9`). Les navigateurs
refusent un cookie `Secure` sur une origine non sûre : **exposer l'application
en HTTP simple rend la connexion fonctionnelle côté serveur et inutilisable
côté navigateur**. `localhost` reste une origine de confiance, ce qui masque ce
besoin en développement ; une adresse IP de LAN en HTTP, elle, casse
silencieusement la session.

Le serveur suppose déjà un proxy en amont : `app.set("trust proxy", 1)`
(`server/_core/index.ts:27`) — donc `req.ip`, `x-forwarded-host` et
`x-forwarded-proto` sont lus comme fiables. Sans proxy, ce réglage est inoffensif ;
**avec** un proxy qui ne fixe pas ces en-têtes, l'origine reconstruite pour les
liens de suivi QA retombe sur `host`, et la protection de forme
(`server/qa/routes.ts:43`) devient le seul garde-fou. Renseigner `APP_BASE_URL`
supprime l'ambiguïté (`docs/03-infrastructure/environnement.md`).

En-têtes fixes posés par l'application, quel que soit le proxy
(`server/_core/index.ts:28-35`) : `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`, et
`x-powered-by` désactivé (`:26`). À compléter côté proxy par `Strict-Transport-Security`
— le code applicatif n'en pose pas.

Le corps de requête est plafonné à 64 ko (`server/_core/index.ts:39-40`) : une
proxy qui autorise 1 Mo côté TLS ne change rien, l'application répondra `413`.

## Proxy inverse : ce que l'application attend

- Écoute sur `0.0.0.0` et `PORT` (`server/_core/index.ts:84,91`) — pas de socket
  Unix, pas de bind restreint à localhost.
- `GET /api/health` doit rester joignable pour le `HEALTHCHECK` interne et pour
  la sonde externe ; il répond `no-store`.
- Les chemins sans extension renvoient le shell SPA
  (`server/_core/static.ts:26-30`) à l'exception de `/api/*`, ce qui permet les
  liens profonds comme `/monitors/12` sans règle de réécriture côté proxy. Un
  asset manquant retourne bien un `404` (commentaire `server/_core/static.ts:18-25`),
  donc le proxy ne doit pas réécrire les erreurs de statiques en `200`.
- Cache : les assets fingerprintés de `dist/public` supportent un `immutable`
  long ; les réponses authentifiées sont en `private, no-store`
  (`docs/02-technical/api.md`).

## Intégration continue

`.github/workflows/ci.yml`, déclenché sur `pull_request` et sur `push` vers
`main` (`:3-6`), avec annulation des runs obsolètes sur la même ref (`:10-12`)
et `permissions: contents: read` (`:14-15`). Une seule job `quality`
(`ubuntu-latest`) :

| Étape                            | Ligne    | Effet                                                                                      |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | `:29`    | verrou respecté, patch `wouter` appliqué                                                   |
| `pnpm format:check`              | `:30`    | prettier en `--check`, y compris le format des docs                                        |
| `pnpm lint`                      | `:31`    | `oxlint --deny-warnings .` — analyseur statique, aucun fichier de config                   |
| `pnpm check`                     | `:32`    | `tsc --noEmit`                                                                             |
| `pnpm test`                      | `:33`    | `vitest run`, sans service MySQL : la base n'est pas touchée par les tests                 |
| `pnpm build`                     | `:34`    | les deux bundles                                                                           |
| Audit                            | `:35-36` | `pnpm audit --audit-level high`                                                            |
| Image                            | `:37-38` | `docker build` — jamais poussé                                                             |
| Smoke                            | `:39-53` | `docker run` + `curl` répété 30 fois, logs dumpés en cas d'échec, `exit 1` au bout de 60 s |
| Secrets                          | `:54-57` | `gitleaks/gitleaks-action@v2`                                                              |

Trois manques à connaître avant de présenter le CI comme une porte de qualité :
pas de service MySQL (donc rien ne valide les migrations ni le SQL généré),
l'image est construit et fumée mais jamais publiée ni signée, et aucun hook de
pré-commit ne reproduit ces contrôles localement. La mesure détaillée de la
couverture est dans `docs/06-verification/tests-et-couverture.md`.

**Il n'existe aucun workflow de déploiement.** Pas de release, pas de push
d'image, pas d'environnement GitHub. La mise en ligne est pour l'instant
manuelle : construire l'image, la transporter, la lancer, brancher la base.

## Publication du dépôt

### Ce que l'histoire locale permet

Mesuré le 2026-10-19 : `main` est à `df4db5c` et compte cinq commits, la
branche de travail `refactor/restructure-architecture` en ajoute huit
(`git rev-list --count main..HEAD`), et `git merge-base main HEAD` rend
`df4db5c`. Autrement dit `git rev-list --count HEAD..main` rend `0` : `main`
n'a rien que la branche ignore. La réconciliation est un fast-forward pur —
pas de conflit possible, pas de commit de merge à justifier.

Les huit commits se répartissent, à cette mesure, en deux correctifs serveur
(`83ca3a8` rendre le bundle de production bootable sans les dépendances de
développement, `3728469` déballer les erreurs pilote que Drizzle masquait), un
ménage de code (`9800309` supprimer le code mort, aligner l'arborescence,
resserrer les dépendances), et cinq passes de documentation. La liste se relit
avec `git log --oneline main..HEAD`.

### Ordre recommandé

Pousser la branche et ouvrir la demande de fusion, parce que c'est le seul
moyen de faire tourner la CI — elle n'a jamais été déclenchée :

```sh
git push -u origin refactor/restructure-architecture
gh pr create --base main --head refactor/restructure-architecture
# une fois la CI verte :
git checkout main && git merge --ff-only refactor/restructure-architecture && git push
```

L'alternative est l'histoire linéaire sans demande de fusion : `git checkout
main`, `git merge --ff-only refactor/restructure-architecture`, `git push -u
origin main`. Elle publie immédiatement, au prix de laisser la CI sans aucun
historique.

Trois échecs sont plausibles au premier run et ne remettent pas en cause le
code : `pnpm install --frozen-lockfile` doit re-télécharger le verrou depuis
le réseau alors qu'ici il sort du magasin local (`node_modules` déjà garni),
`pnpm audit --audit-level high` (`:35-36`) interroge l'avis de sécurité de npm
en temps réel, et `gitleaks/gitleaks-action@v2` (`:54-57`) demande une
licence GitHub Advanced Security sur un dépôt privé.

### Identité des commits

Les huit commits de la branche portent `Ventso <narindraranjal4hy@gmail.com>`,
lu dans `git config user.name` et `user.email` sur ce poste. L'adresse du
compte propriétaire inscrite dans le code et dans la documentation est
`rajaomanjatoventso@gmail.com` (`server/auth/owner.ts`). GitHub rattache un
commit au compte qui a vérifié l'adresse de l'auteur : sans ajout de
`narindraranjal4hy@gmail.com` au compte, les commits arriveront sans lien avec
le profil. À trancher avant la première poussée, soit en déclarant l'adresse
sur le compte, soit en changeant `git config user.email` pour la suite —
l'histoire déjà écrite ne se réécrit pas ici.

### Ce que la poussée n'emportera pas

`.env` est ignoré (`.gitignore:11`) et n'a jamais été suivi : `git ls-files
.env` ne renvoie rien, et `git log --all -- .env` ne trouve aucun commit. Les
deux seules variables du fichier (`DATABASE_URL`,
`UPTIMEPULSE_ENCRYPTION_KEY`) ne sont lues que depuis l'environnement, et
aucun log produit pendant ce travail (`*.log`, ignoré par `.gitignore:35`) ne
contient leur nom ni un prélèvement de douze caractères de leur valeur —
vérifié dans `dev-local.log` et `dev-server.log`, qui sont les deux seuls
fichiers `.log` du poste. Le dépôt reste sans remote : la poussée attend une
URL de dépôt et un jeton.

## Exploitation courante

- **Démarrer / stopper** : `docker run -d --name uptimepulse -p 3000:3000
--env-file .env uptimepulse:tag`. L'`--env-file` est le seul moyen d'injecter
  la configuration, `.env` étant exclu de l'image.
- **Sauvegarde** : il n'y a pas de script de backup dans le dépôt. Un
  `mysqldump --single-transaction` suffit, puisque tout l'état est relationnel
  et que la rétention borne le volume. Sauvegarder aussi
  `UPTIMEPULSE_ENCRYPTION_KEY` ailleurs que la base : sans la clé, les canaux
  Telegram stockés sont irrécupérables (`server/notifications/crypto.ts:13-18`).
- **Restauration** : vider la base, rejouer les migrations, puis réinsérer le
  dump ; ou restaurer directement le dump sur une base vierge du même schéma.
- **Rollback d'image** : conserver l'ancien tag. La contrainte est la base, pas
  l'image — une migration ajoutée n'est pas réversible automatiquement, aucun
  fichier `down` n'existant dans `shared/db/`.
- **Rotation** : ne jamais faire tourner `UPTIMEPULSE_ENCRYPTION_KEY` sans
  recréer les canaux. `APP_BASE_URL` et `UPTIMEPULSE_OWNER_EMAIL` sont en
  revanche sans effet sur les données au changement.
- **Observabilité** : stdout uniquement, en lignes JSON ; la liste des
  événements et les commandes de tri sont dans
  [`observabilite.md`](observabilite.md).
- **Rétention** : gérée par la passe de purge du tick
  (`docs/03-infrastructure/checks.md`), pas par un cron externe.

## Checklist avant mise en ligne

1. `pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm
check && pnpm test && pnpm build` — les six contrôles verts sur la machine
   qui pousse.
2. La base cible existe, son fuseau est UTC, et les huit migrations y ont été
   appliquées depuis un environnement complet (pas depuis le conteneur). La
   chaîne est prouvée sur base vierge locale (§« Base de données au premier
   déploiement »), mais sur MariaDB : le même jeu reste à rejouer sur le MySQL
   de production.
3. `DATABASE_URL` et `UPTIMEPULSE_ENCRYPTION_KEY` (≥ 16 caractères) sont
   injectés ; `APP_BASE_URL` pointe sur l'origine publique exacte.
4. Le conteneur démarre. `docker build` puis `docker run` n'ont **jamais été
   exécutés** sur ce poste (Docker absent) : cette étape reste à valider après
   publication. Ce qui est prouvé, c'est que `node dist/index.js` démarre avec
   les seules dépendances de production. `docker logs` doit montrer
   `Server listening on port 3000`, sinon le process meurt avant.
5. `curl https://domaine/api/health` répond `{ "status": "ok" }`.
6. Une ligne `scheduler_tick` apparaît dans les logs dans la minute suivant le
   boot (`server/scheduler/loop.ts:41` : première passe à 2 s après l'écoute).
7. Un compte propriétaire peut s'inscrire, créer un moniteur, et le moniteur
   quitte `UNKNOWN` — sans cela, le fuseau horaire de la base est le premier
   suspect.
8. Le canal de test envoie bien un message Telegram, et `lastError` reste `null`
   dans `notification_deliveries`.
9. La page publique s'affiche derrière le proxy avec un lien profond direct
   (`/status/<slug>` rechargé à froid).
10. Un backup restauré dans une base de test redonne le même état.
