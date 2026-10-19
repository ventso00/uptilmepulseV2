# UptimePulse

Moniteur de disponibilité auto-hébergé pour un **opérateur unique** : une seule
personne configure le produit, et les propriétaires des sites surveillés lisent
des pages publiques sans jamais avoir de compte.

UptimePulse vérifie des URLs HTTP/HTTPS à intervalle régulier, conserve
l'historique des sondes, confirme un incident après plusieurs échecs consécutifs
avant d'alerter, envoie la notification sur Telegram, et publie une page de
statut analysée (uptime, latence par phase, certificat TLS, incidents) à une
slug près. Il embarque aussi une file qualité complète : signalements entrants
depuis les pages publiques, auto-tests d'invariants, point quotidien, suivi
client par lien confidentiel.

Aucune métrique de ce README n'est marketing : les chiffres cités viennent du
dépôt, et la section [Limites connues](#limites-connues) dit ce qui ne marche
pas encore.

## Ce que le produit fait

| Domaine                 | Comportement                                                                                                                                                                                                                       | Source                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Check planifié          | Sélection des moniteurs échus, claim atomique avec bail de 6 minutes, résolution puis re-validation DNS, requête HTTP bornée, ping log et transition d'incident dans la même transaction.                                          | `server/checks/engine.ts:96-107`                                    |
| Cadence                 | Intervalles de 300 s à 86 400 s par moniteur, minimum porté par le palier. Boucle interne : passe toutes les 30 s, première 2 s après le boot.                                                                                     | `shared/contracts.ts:12,30`, `server/scheduler/loop.ts:17-20,38-41` |
| Anti faux positifs      | Un échec isolé ouvre un incident suspect, invisible ; trois échecs consécutifs le confirment et alertent ; deux succès le résolvent et alertent.                                                                                   | `docs/02-technical/qa-support.md`, `server/incidents/`              |
| Assertion de contenu    | Mot-clé attendu ou interdit cherché sur le corps décodé après un 2xx/3xx. Corps plafonné à 256 Ko, redirections à 3. Une absence sur page tronquée reste non concluante (`unknown`), jamais `DOWN`.                                | `docs/03-infrastructure/checks.md`                                  |
| Analyse technique       | Chronométrage des phases réseau du dernier hop (DNS, TCP, TLS, premier octet) et lecture du certificat du pair en HTTPS.                                                                                                           | `server/checks/client.ts`                                           |
| Notifications           | Telegram aujourd'hui, secrets chiffrés en AES-256-GCM, idempotence par index unique, file de reprise (20 livraisons par passe, ≥ 60 s entre tentatives, 3 tentatives dans une passe avec compteur cumulatif).                      | `docs/03-infrastructure/notifications.md`                           |
| Page de statut publique | `/status/:slug` : verdict, uptime, calendriers, latence p50/p90/p95, incidents confirmés, SSL — sans authentification, limitée par IP, `Cache-Control: public, max-age=30`.                                                        | `server/statuspages/routes.ts:161-195`                              |
| Rétention               | Purge incrémentale à chaque tick : sessions expirées, ping logs et livrables au-delà de 90 jours, par lots de 1 000.                                                                                                               | `server/scheduler/retention.ts`                                     |
| File qualité            | Intake anonyme avec preuves navigateur (route, viewport, langue, dix dernières erreurs JS et appels API en échec), jeton rapporteur 32 hex dans le chemin, sept invariants rejoués par tranche UTC de 15 minutes, point quotidien. | `server/qa/selfTest.ts:31,385-388`                                  |
| Paliers                 | Modèle freemium piloté par la table `plans`, jamais par le code : quota de moniteurs, intervalle minimum, timeout maximum, nombre de canaux, accès à l'assertion de contenu.                                                       | `server/plans/service.ts`                                           |

## Prérequis

- **Node.js 22** — version imposée par `.github/workflows/ci.yml:27` et par les
  trois étages de `Dockerfile:5,14,22`. Le dépôt ne déclare pas de champ
  `engines`, donc rien ne vous empêchera d'essayer une autre version ; rien ne
  vous garantira non plus que ça marche.
- **pnpm 10.18.0** — verrouillé par `packageManager` dans `package.json`.
  L'installation passe par Corepack ; un `npm install` cassera le patch
  `wouter@3.7.1` déclaré dans `pnpm-workspace.yaml`.
- **MySQL 8 ou MariaDB**, avec un utilisateur applicatif et une base **déjà
  créée**. Le projet ne crée pas la base, seulement son schéma.
- **HTTPS** pour exposer l'application : le cookie de session est posé avec
  `secure: true` et `sameSite: "none"` (`server/auth/session.ts:15-23`), donc
  un navigateur refuse la session sur une origine non sûre. `localhost` reste
  une origine de confiance, ce qui masque l'exigence en développement.

## Configuration

Copier le modèle puis renseigner au minimum les deux variables obligatoires :

```bash
cp .env.example .env
```

| Variable                     | Obligation                     | Rôle                                                                                                                                                            |
| ---------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | **requise**                    | DSN MySQL. Absente, `getDb()` renvoie `null` et les moniteurs restent `UNKNOWN` sans exception.                                                                 |
| `UPTIMEPULSE_ENCRYPTION_KEY` | **requise pour les canaux**    | Clé maîtresse du chiffrement AES-256-GCM. Vide ou courte de moins de 16 caractères, toute écriture ou lecture de canal lève `Encryption key is not configured`. |
| `PORT`                       | optionnel                      | Écoute, `3000` par défaut, sur `0.0.0.0`.                                                                                                                       |
| `NODE_ENV`                   | optionnel                      | `development` monte Vite ; toute autre valeur sert `dist/public`.                                                                                               |
| `APP_BASE_URL`               | à renseigner derrière un proxy | Origine absolue des liens de suivi. À défaut, elle est déduite des en-têtes, avec contrôle de forme.                                                            |
| `UPTIMEPULSE_OWNER_EMAIL`    | optionnel                      | Déplace la porte d'inscription, sinon la constante de `server/auth/owner.ts:9` s'applique.                                                                      |
| `SCHEDULER_INTERNAL`         | optionnel                      | La chaîne exacte `0` désactive la boucle interne. `false` ou `off` ne désactive rien.                                                                           |
| `MANUS_*`, `OWNER_OPEN_ID`   | dormants                       | Sphère plateforme (OAuth, cron de plateforme, notification propriétaire). Le produit tourne sans elles.                                                         |

Les **quinze** variables lues par le code, leur site de lecture et les
conséquences de rotation sont détaillées dans
[`docs/03-infrastructure/environnement.md`](docs/03-infrastructure/environnement.md).
Deux règles permanentes : les valeurs ne vont ni dans un commit, ni dans un log,
ni dans une capture ; et **changer `UPTIMEPULSE_ENCRYPTION_KEY` rend
définitivement illisibles tous les tokens Telegram déjà stockés**, sans procédure
de re-chiffrement.

## Installation et exécution

### Développement

```bash
pnpm install --frozen-lockfile
pnpm db:push          # generate + migrate : crée les 13 tables
pnpm dev              # tsx watch, Vite côté client
```

`pnpm db:push` et `pnpm db:migrate` exigent `DATABASE_URL` :
`drizzle.config.ts:5` lève explicitement sinon. Sous **Windows**, le script
`dev` (`package.json:7`) commence par une affectation inline à la POSIX
(`NODE_ENV=development tsx watch …`) que cmd.exe ne comprend pas ; soit passer
par Git Bash, soit lancer directement :

```bash
NODE_ENV=development node_modules/.bin/tsx watch server/_core/index.ts
```

Le serveur écoute sur `http://localhost:3000`, la santé se vérifie par
`GET /api/health` (réponse `{ "status": "ok" }`, `Cache-Control: no-store`).
Attention : cet endpoint ne teste **ni la base, ni DNS, ni Telegram** — un `ok`
ne prouve que le bind TCP. Le témoin de fonctionnement réel est la ligne JSON
`scheduler_tick` dans la sortie standard.

### Premier compte

Le dépôt ne sème **aucun** compte, moniteur ni page de statut : seule la table
`plans` reçoit ses paliers dans `shared/db/0007_clever_kulan_gath.sql`.
L'inscription `/register` est verrouillée sur l'adresse du créateur, refusée
avant tout calcul bcrypt (`server/auth/routes.ts:89-95`, `403
REGISTRATION_CLOSED`). Le chemin complet — inscription, premier moniteur, canal
Telegram, page de statut, premier résultat — est dans
[`docs/05-exploitation/prise-en-main.md`](docs/05-exploitation/prise-en-main.md).

### Production

```bash
pnpm install --frozen-lockfile
pnpm build                    # vite build -> dist/public, esbuild -> dist/index.js
NODE_ENV=production node dist/index.js
```

`pnpm build` (`package.json:8`) produit deux artefacts : le client dans
`dist/public` et le bundle serveur ESM `dist/index.js`. En l'absence de
`NODE_ENV=development`, le serveur sert les assets, avec repli du shell SPA
pour les chemins sans extension (`server/_core/vite.ts:71-76`), ce qui rend les
liens profonds comme `/status/ma-slug` accessibles à froid.

Une image Docker est fournie (`Dockerfile`, trois étages, utilisateur non root
uid 1001, `HEALTHCHECK` sur `/api/health`), **mais elle ne démarre pas en
l'état** : le bundle importe trois paquets de `devDependencies` que le stage
runtime n'installe pas (`ERR_MODULE_NOT_FOUND: Cannot find package 'vite'`). Le
diagnostic complet, les contournements et le correctif planifié sont dans
[`docs/03-infrastructure/deploiement.md`](docs/03-infrastructure/deploiement.md).
La voie `node dist/index.js` ci-dessus, elle, fonctionne.

## Commandes

```bash
pnpm dev              # serveur + client en watch
pnpm build            # assets client + bundle serveur
pnpm start            # NODE_ENV=production node dist/index.js
pnpm check            # tsc --noEmit
pnpm lint             # oxlint --deny-warnings (aucun fichier de config)
pnpm test             # vitest run : 22 fichiers, 219 tests
pnpm test:watch
pnpm format           # prettier --write
pnpm format:check     # prettier --check, exigé par le CI
pnpm db:push          # drizzle-kit generate && migrate
pnpm db:migrate       # migrate seulement
```

Les cinq contrôles (`format:check`, `lint`, `check`, `test`, `build`) sont ce que
le CI exécute, et ils passent sur l'arborescence telle que livrée. Les tests ne
se connectent **jamais** à une base : le CI dit donc quelque chose sur le code,
rien sur les migrations. Détail mesuré dans
[`docs/06-verification/tests-et-couverture.md`](docs/06-verification/tests-et-couverture.md).

## Architecture

Monorepo pnpm dont les deux membres sont la racine et `shared` : `client/` et
`server/` ne sont **pas** des paquets, toutes leurs dépendances vivent dans le
manifeste racine (`pnpm-workspace.yaml`).

| Chemin                         | Rôle                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/pages`             | Écrans : landing `/`, dashboard `/dashboard`, détail moniteur, paramètres, file qualité `/qa`, suivi client `/support/:token`, console `/console`, authentification |
| `client/src/components/uptime` | Composants métier : shell, dialogue, menu de ligne, badge d'état                                                                                                    |
| `client/src/lib/api.ts`        | Client REST typé, chaque réponse validée contre `shared/contracts.ts`                                                                                               |
| `client/src/lib/qaContext.ts`  | Capture navigateur des preuves (erreurs JS, appels API en échec), tampons circulaires                                                                               |
| `server/auth`                  | Sessions opaques (jeton 32 octets, SHA-256 au repos, 30 jours), mots de passe bcrypt coût 12, limiteur à fenêtre fixe                                               |
| `server/monitors`              | CRUD, validation de cible, agrégats d'uptime                                                                                                                        |
| `server/checks`                | Client HTTP protégé SSRF, assertion de contenu, moteur de check                                                                                                     |
| `server/incidents`             | Machine à états pure des transitions                                                                                                                                |
| `server/plans`                 | Plan effectif lu en base, quotas, réponses d'erreur normalisées                                                                                                     |
| `server/admin`                 | API du créateur : overview, paliers, affectations                                                                                                                   |
| `server/notifications`         | Chiffrement AES-256-GCM, dispatcher Telegram, reprise                                                                                                               |
| `server/statuspages`           | Pages publiques et leur module d'analyse                                                                                                                            |
| `server/qa`                    | Tickets, auto-tests, point quotidien, rapports et réponses clients                                                                                                  |
| `server/scheduler`             | Tick, pool borné, endpoint cron, enregistrement plateforme, purge de rétention                                                                                      |
| `server/routes`                | Agrégat transverse du dashboard                                                                                                                                     |
| `server/_core`                 | Entrée Express, enveloppe d'erreur, contexte tRPC, sphère plateforme                                                                                                |
| `shared/db`                    | **Schéma Drizzle et les huit migrations `0000`→`0007`** — pas de dossier `drizzle/`                                                                                 |
| `shared/contracts.ts`          | Schémas zod partagés client/serveur                                                                                                                                 |
| `scripts/make-cron-token.mjs`  | Utilitaire local : mint un JWT `cron_` pour piloter le pipeline sans la plateforme                                                                                  |

Quatre sphères d'authentification coexistent : session applicative (cookie),
rapporteur QA (jeton dans le chemin), machine/cron (JWT HS256, `openId` préfixé
`cron_`), anonyme public. `docs/02-technical/access-model.md` explique pourquoi
le produit n'affiche qu'un seul régime visuel, clair, partout.

## Documentation

L'index complet, avec les ordres de lecture par profil et la note d'import
Notion : [`docs/00-sommaire.md`](docs/00-sommaire.md).

- **Produit** — `docs/01-product/vision.md`, `docs/01-product/cahier-des-charges.md`
- **Technique** — `modele-donnees.md` (13 tables, colonnes, index, enums),
  `api-http.md` (47 points HTTP, 2 procédures tRPC, audit du débit),
  `client.md`, `access-model.md`, `security.md`, `status-page-analysis.md`,
  `qa-support.md`, `plans-and-billing.md`, `api.md`
- **Infrastructure** — `checks.md`, `notifications.md`, `environnement.md`,
  `observabilite.md` (23 événements), `deploiement.md`, `infra.md`,
  `local-dev.md`
- **Exploitation** — `prise-en-main.md`, `page-statut-lecteur.md`,
  `file-qualite.md`, `console-plans.md`, `depannage.md`
- **Décisions** — `docs/04-project/decisions.md` (ADR 001→018) et
  `docs/04-project/documentation-ledger.md` (registre des corrections, avec la
  mesure qui a invalidé chaque affirmation fausse)
- **Vérification** — `docs/06-verification/tests-et-couverture.md`

Toute affirmation technique de ces pages est ancrée par `chemin:ligne` ; la
cohérence de l'ensemble est recomptée à chaque passe.

## Sécurité

Lire [`SECURITY.md`](SECURITY.md) avant toute extension. Les points qui
comptent :

- les cibles de check passent par une validation SSRF complète : syntaxe,
  résolution DNS, re-validation à chaque redirection, 22 plages privées ou
  réservées bloquées dont les pièges IPv6, corps plafonné à 256 Ko, 3 redirections
  maximum (`server/monitors/ssrf.ts`) ;
- mots de passe hachés (bcrypt coût 12), sessions opaques révocables, jeton stocké
  sous forme de SHA-256 ;
- chaque route privée vérifie la propriété de la ressource, pas seulement
  l'identité ;
- les secrets de canaux sont chiffrés avant stockage, et les logs ne portent que
  des identifiants techniques — les événements d'administration ne mentionnent
  jamais l'e-mail affecté ;
- le corps de requête est plafonné à 64 ko (`server/_core/index.ts:38`), les
  surfaces publiques sont limitées par IP.

## Périmètre

Inclus : authentification réservée au créateur, CRUD de moniteurs, checks
HTTP/HTTPS avec assertion de contenu, analyse technique (phases réseau,
certificat TLS, percentiles), historique, incidents 3/2, notifications Telegram,
pages de statut publiques, file qualité et suivi client, paliers freemium
éditables, dashboard, protection SSRF, rétention bornée, logs structurés, CI.

Non inclus, assumé : Discord et tout autre canal que Telegram, e-mail sortant,
paiement en ligne, équipes et rôles multiples, monitoring multi-région, sonde
TCP/pong ICMP, SLA contractualisé.

## Limites connues

Liste volontairement dérangeante, parce qu'un README qui n'énumère que des forces
ne sert pas à celui qui déploie.

1. **L'image Docker ne démarre pas** — défaut reproductible, contournement et
   correctif dans `docs/03-infrastructure/deploiement.md`.
2. **Aucun pipeline n'a jamais tourné à distance** — le dépôt n'a pas de remote
   et porte une histoire à quatre commits ; le CI est écrit, pas éprouvé, et son
   étape `docker run` échouerait sur le point 1.
3. **Les tests ne touchent jamais la base** — 45 handlers HTTP ne sont exercés
   par aucun test ; la couverture réelle est mesurée dans
   `docs/06-verification/tests-et-couverture.md`.
4. **Un seul canal de notification** — Telegram, avec un enum prévu pour
   l'extension mais une seule branche implémentée.
5. **Le monorepo n'a pas de MySQL de développement** — pas de
   `docker-compose`, la base se provisionne à la main.
6. **Aucun lien d'évitement clavier** (`skip link`) dans l'application, bien que
   le focus visible et les contrastes AA soient en place.
7. **Pas de pages légales** — `/privacy` et `/terms` n'existent pas ; une
   publication externe les demande.
8. **Le digest quotidien est produit, jamais transporté** — il se lit sur `/qa`,
   aucun SMTP, aucune poussée Telegram, aucun cron externe ne l'envoie.
9. **L'identité git de l'auteur est celle de la machine qui a écrit le baseline** —
   elle est dans les commits, et la changer après publication impose une
   réécriture d'historique.

## Auteur

**ventso00** — [`github.com/ventso00`](https://github.com/ventso00),
[portfolio](https://ventso.netlify.app/),
[rajaomanjatoventso@gmail.com](mailto:rajaomanjatoventso@gmail.com). Les mêmes
coordonnées figurent au pied de la page publique
(`client/src/components/uptime/SiteFooter.tsx:19-24`).

## Licence

MIT — voir [`LICENSE`](LICENSE).
