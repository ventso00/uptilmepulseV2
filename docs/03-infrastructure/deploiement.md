# Déploiement

## État réel de la chaîne de déploiement

À lire avant tout le reste, parce que deux affirmations optimistes de versions
antérieures de cette documentation ont été corrigées ici :

- **l'image Docker ne démarre pas en l'état**. Le bundle serveur importent
  statiquement trois paquets de `devDependencies`. Reproduit, pas déduit :
  voir « Blocage de démarrage vérifié » plus bas. Un conteneur construit depuis
  le `Dockerfile` tel quel meurt avant son premier listen.
- **aucun pipeline n'a jamais été exécuté à distance**. Le dépôt n'a pas de
  remote et porte un unique commit de baseline ; le workflow CI décrit plus bas
  est écrit, pas éprouvé. Son étape `docker run` + `curl /api/health` échouerait
  telle quelle, et c'est précisément ce qui reste à valider en Phase 4.

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
grep -o 'from "[^"]*"' dist/index.js | sort -u
```

Sur le dépôt actuel elle contient `express`, `@trpc/server`, `drizzle-orm`,
`mysql2`, `jose`, `bcryptjs`, `cookie`, `nanoid`, `superjson`, `zod`, `axios`,
`dotenv`, les modules `node:*` — **et** `vite`, `@vitejs/plugin-react`,
`@tailwindcss/vite`. Les trois derniers viennent de
`server/_core/index.ts:9` (`import { serveStatic, setupVite } from "./vite"`)
qui tire `server/_core/vite.ts:6-7` puis `vite.config.ts:1-2`. Ils sont en
`devDependencies`. C'est le blocage documenté plus bas.

Le serveur démarrera avec `NODE_ENV` différent de `development` sélectionne
`serveStatic(app)` (`server/_core/index.ts:73-77`), qui résout le dossier des
assets ainsi (`server/_core/vite.ts:51-54`) :

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

### Blocage de démarrage vérifié

Fait : le conteneur runtime ne peut pas démarrer.

Preuve reproduite sur ce poste (et non inférée) :

```bash
mv node_modules/vite node_modules/vite.hidden
node dist/index.js
# node:internal/modules/package_json_reader:331
# Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from
#   <racine>/dist/index.js
```

C'est exactement l'état des `node_modules` du stage runtime, qui installe avec
`--prod` (`Dockerfile:35`) : `vite` est déclaré en `devDependencies`
(`package.json:56,75`), donc absent. Le bundle, lui, l'importe au niveau supérieur
(`dist/index.js:1079` : `import { createServer as createViteServer } from "vite"`),
et Node évalue tous les `import` statiques avant la première ligne exécutée —
peu importe que la branche `serveStatic` soit celle qui tourne.

Pourquoi le CI ne l'a pas attrapé : le workflow construit l'image, la lance et
sonde `/api/health` (`ci.yml:39-53`), ce qui aurait dû échouer — mais ce job
n'a jamais tourné, faute de remote et de commit publié.

Correctifs possibles, par ordre de propreté :

1. rendre l'import de `./vite` dynamique dans la seule branche qui en a besoin
   (`server/_core/index.ts:73-77`), et scinder `serveStatic` dans un module qui
   n'importe ni Vite ni la config ;
2. à défaut, installer sans `--prod` dans le stage runtime — image plus lourde,
   outil de build dans le runtime ;
3. ou promouvoir `vite`, `@vitejs/plugin-react` et `@tailwindcss/vite` en
   `dependencies` — le plus laid, car ces paquets ne servent qu'au dev.

La correction 1 est celle retenue, planifiée en Phase 4 (tâche dédiée). En
attendant, un déploiement Docker exige l'un des contournements 2 ou 3.

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

Vérification : `GET /api/health` ne teste **pas** la base
(`server/_core/index.ts:40-43`) — un `ok` là-bas ne prouve que le bind TCP. Le
témoin de santé réel est la ligne `scheduler_tick` dans les logs
(`server/scheduler/tick.ts:103`), et son absence avec `DATABASE_URL` renseigné
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
(`server/_core/index.ts:26`) — donc `req.ip`, `x-forwarded-host` et
`x-forwarded-proto` sont lus comme fiables. Sans proxy, cet réglage est inoffensif ;
**avec** un proxy qui ne fixe pas ces en-têtes, l'origine reconstruite pour les
liens de suivi QA retombe sur `host`, et la protection de forme
(`server/qa/routes.ts:43`) devient le seul garde-fou. Renseigner `APP_BASE_URL`
supprime l'ambiguïté (`docs/03-infrastructure/environnement.md`).

En-têtes fixes posés par l'application, quel que soit le proxy
(`server/_core/index.ts:27-34`) : `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`, et
`x-powered-by` désactivé (`:25`). À compléter côté proxy par `Strict-Transport-Security`
— le code applicatif n'en pose pas.

Le corps de requête est plafonné à 64 ko (`server/_core/index.ts:38-39`) : une
proxy qui autorise 1 Mo côté TLS ne change rien, l'application répondra `413`.

## Proxy inverse : ce que l'application attend

- Écoute sur `0.0.0.0` et `PORT` (`server/_core/index.ts:83,90`) — pas de socket
  Unix, pas de bind restreint à localhost.
- `GET /api/health` doit rester joignable pour le `HEALTHCHECK` interne et pour
  la sonde externe ; il répond `no-store`.
- Les chemins sans extension renvoient le shell SPA
  (`server/_core/vite.ts:71-76`) à l'exception de `/api/*`, ce qui permet les
  liens profonds comme `/monitors/12` sans règle de réécriture côté proxy. Un
  asset manquant retourne bien un `404` (commentaire `server/_core/vite.ts:63-66`),
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
   appliquées depuis un environnement complet (pas depuis le conteneur).
3. `DATABASE_URL` et `UPTIMEPULSE_ENCRYPTION_KEY` (≥ 16 caractères) sont
   injectés ; `APP_BASE_URL` pointe sur l'origine publique exacte.
4. Le conteneur démarre. **Tant que le blocage de `vite` n'est pas corrigé,
   vérifier explicitement cette étape** : `docker logs` doit montrer
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
