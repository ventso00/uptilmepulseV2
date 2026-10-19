# Contribuer à UptimePulse

## Workflow

Créer une branche `feature/*`, `fix/*`, `docs/*` ou `infra/*`. Une tâche doit rester focalisée et ne pas modifier les mêmes fichiers qu’une autre tâche parallèle.

## Qualité

Avant une PR, toute la chaîne doit être verte — la CI échoue sinon :

```bash
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
```

## Conventions

Les commits suivent les préfixes conventionnels `feat:`, `fix:`, `test:`,
`docs:`, `ci:` et `infra:`. Une PR décrit le comportement utilisateur, les
risques sécurité, les migrations et les variables d’environnement nécessaires.

Le formatage est géré par Prettier, l’analyse statique par oxlint. Ne pas
contourner une règle sans justification écrite dans la PR.

## Contrats d’API

Toute réponse d’API est décrite par un schéma zod dans `shared/contracts.ts` et
parsée par le client. Modifier une forme de réponse implique de mettre à jour le
schéma dans le même commit : c’est ce qui empêche une dérive serveur de
devenir un `undefined` silencieux dans l’interface.

Les constantes qui engagent les deux plans (bornes des champs, limites de
schémas, formes de payload) vivent dans `shared/contracts.ts` afin que
l’interface ne puisse pas diverger du serveur. Elles ne couvrent pas tout, et le
savoir évite de chercher un symbole au mauvais endroit : `BATCH_SIZE` et la
concurrence des checks sont dans `server/scheduler/tick.ts`, le bail de claim
est un littéral en ligne dans `server/checks/engine.ts:96`, le plafond
d’échantillonnage de latence est `LATENCY_SAMPLE_CAP_PER_MONITOR` dans
`server/statuspages/analysis.ts:36-39`, et la fenêtre du digest
(`WINDOW_HOURS`) dans `server/qa/digest.ts:29`. Une constante purement serveur
n’a rien à faire dans le contrat partagé.

## Migrations

Le schéma est la source de vérité. Générer la migration avec
`pnpm exec drizzle-kit generate --name <nom>` plutôt que d’écrire le SQL à la
main, puis l’appliquer avec `pnpm db:migrate`. Une migration doit être additive
et réversible autant que possible.

`drizzle.config.ts:9` publie les SQL dans **`shared/db/`** — il n’existe pas de
dossier `drizzle/`, et un outil tiers qui en suppose un ne générera rien
d’applicable ici. Les colonnes sont nommées en `camelCase` sans conversion
`snake_case`, et entourées d’accents graves dans le SQL produit : une requête
console doit écrire `` `checkedAt` ``.

## Tests

Les tests unitaires ciblent la logique pure : machine à états d’incident,
validation SSRF, calculs d’uptime, pool de concurrence, rate limiting, contrats
partagés. Ajouter un test pour toute nouvelle règle de décision, et vérifier
ce qui est observable plutôt que l’implémentation.

État mesuré : **22 fichiers, 219 tests** (`pnpm test`, durée ~3,4 s). Aucun
fichier ne se connecte à la base — le CI n’a pas de service MySQL, donc rien de
ce vert ne valide les migrations ni le SQL généré. La limite est détaillée dans
`docs/06-verification/tests-et-couverture.md`.

## Données et secrets

Ne jamais committer un token Telegram, une session, une DSN ou une valeur issue
de `.env`. Les noms de variables s’écrivent, leurs valeurs non.

Un test a besoin d’une cible HTTP : la convention est une adresse sous
`127.0.0.1`, un domaine réservé (`example.com`, `.invalid`), ou un serveur HTTP
levé par le test lui-même. Ne pas tester contre Google, GitHub ni aucun service
tiers dont le contenu change sans prévenir.

Une exception existe aujourd’hui et reste à supprimer :
`server/checks/client.test.ts` charge `https://open.spotify.com/` pour obtenir
un corps réellement supérieur au plafond de 256 Ko. Le remplacement propre est
un serveur local dans le test ; en attendant, ce fichier est le seul à sortir
sur le réseau, et c’est le seul dont la couverture dépend d’un hôte externe.

## Environnement local

Sous Windows, `pnpm dev` échoue parce que le script commence par une
affectation d’environnement inline à la POSIX (`package.json:7`) ; passer par
Git Bash ou lancer directement
`NODE_ENV=development node_modules/.bin/tsx watch server/_core/index.ts`.

Les fins de ligne sont épinglées en LF par `.gitattributes`, parce qu’un checkout
en `core.autocrlf=true` fait échouer `pnpm format:check` sur des fichiers que
personne n’a modifiés. Si `format:check` refuse des fichiers que vous n’avez pas
touchés, vérifier d’abord `git config core.autocrlf` avant de reformater.
