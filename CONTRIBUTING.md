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

Toute constante métier (limites du plan, seuils d’incident, périodes
d’analyse) vit dans `shared/contracts.ts` afin que l’interface ne puisse pas
diverger de l’application côté serveur.

## Migrations

Le schéma est la source de vérité. Générer la migration avec
`pnpm exec drizzle-kit generate --name <nom>` plutôt que d’écrire le SQL à la
main, puis l’appliquer avec `pnpm db:migrate`. Une migration doit être additive
et réversible autant que possible.

## Tests

Les tests unitaires ciblent la logique pure : machine à états d’incident,
validation SSRF, calculs d’uptime, pool de concurrence, rate limiting, contrats
partagés. Ajouter un test pour toute nouvelle règle de décision, et vérifier
ce qui est observable plutôt que l’implémentation.

## Données et secrets

Utiliser uniquement des cibles HTTP de test contrôlées par le projet. Ne jamais tester avec des services tiers comme Google ou GitHub, ne jamais committer un token Telegram, une session, une DSN ou une valeur issue de `.env`.
