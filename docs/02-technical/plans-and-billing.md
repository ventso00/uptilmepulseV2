# Plans, quotas et console créateur

Le produit distingue deux choses que le starter confondait : **la borne technique du pipeline** (ce que le moteur de check sait mesurer sans mentir) et **la borne commerciale** (ce qu'un compte a le droit d'acheter). La première est codée, la seconde vit en base et s'édite depuis `/console`.

## Ce qui est codé, ce qui est en base

`intervalSecondsSchema` garde un plancher global de **300 secondes**, et `planUpsertSchema.minIntervalSeconds` est borné `.min(300).max(86_400)`. Un plan ne peut donc jamais promettre un intervalle plus court que ce que le schéma accepte.

Ce plancher n'est pas un caprice commercial : l'échantillon des percentiles du centre d'analyse (voir `status-page-analysis.md`) est dimensionné à partir de 300 s. Un plan à 60 s ferait exploser silencieusement le plafond de 4 320 lignes par moniteur (`LATENCY_SAMPLE_CAP_PER_MONITOR`, `server/statuspages/analysis.ts:36-39`). Les plans ne peuvent que **remonter** le minimum.

Les colonnes éditables (`shared/db/schema.ts`, table `plans`) — les neuf premières forment le plan effectif, les deux dernières ne sortent que pour la console :

| colonne              | sens                                                 | bornes zod                |
| -------------------- | ---------------------------------------------------- | ------------------------- |
| `slug`               | identifiant stable, unique                           | `^[a-z][a-z0-9_-]{1,39}$` |
| `name`               | libellé affiché                                      | 1–60                      |
| `maxMonitors`        | quota de monitors                                    | 1–10 000                  |
| `minIntervalSeconds` | intervalle le plus court autorisé                    | 300–86 400                |
| `maxTimeoutMs`       | timeout le plus long autorisé                        | 1 000–30 000              |
| `maxChannels`        | quota de canaux Telegram                             | 1–50                      |
| `allowKeyword`       | feature « vérification de contenu »                  | booléen                   |
| `priceCents`         | prix affiché, en centimes                            | 0–1 000 000               |
| `trialDays`          | durée d'essai accordée à l'affectation               | 0–365                     |
| `isPublic`           | visible sur la bande tarifs du landing               | booléen                   |
| `sortOrder`          | ordre de saisie, non utilisé pour l'affichage public | 0–100                     |

Le seed de la migration `0007` : `free` (3 monitors, 1 canal, sans mot-clé, 0 €), `pro` (25 monitors, 3 canaux, mot-clé, 9,00 €, essai 14 j), `business` (100 monitors, 8 canaux, mot-clé, 29,00 €, essai 14 j).

## Résolution du plan effectif

`resolvePlan(userId)` (`server/plans/service.ts`) renvoie un `EffectivePlan` : les neuf valeurs ci-dessus, sans `id` ni `isPublic`. Règles :

- `users.planId` nul → le plan interne `BUILT_IN_FREE`, même si aucune ligne `free` n'existe en base.
- Le fallback est cherché par slug `free`. Si un administrateur supprime cette ligne, les comptes qui y étaient rattachés retombent sur le palier intégré plutôt que d'être bloqués.
- Une affectation dont la ligne a disparu est **réancrée** : `users.planId` est remis à `null` et le compte reçoit le palier intégré. C'est le seul cas où une lecture écrit en base, et il est testé (`server/plans/service.test.ts`).

`planId IS NULL` et slug `free` désignent donc le même palier ; l'API overview replie les comptes non affectés dans la ligne `free` plutôt que de les faire disparaître du comptage.

## Application des limites

Toutes les refus passent par trois erreurs et un seul répondeur, `server/plans/respond.ts`, afin que monitors et notifications répondent avec le même vocabulaire :

| erreur                    | HTTP | code                  | sens                                              |
| ------------------------- | ---- | --------------------- | ------------------------------------------------- |
| `QuotaExceededError`      | 409  | `QUOTA_EXCEEDED`      | quota atteint (moniteurs, canaux)                 |
| `PlanLimitError`          | 400  | `VALIDATION_ERROR`    | valeur hors borne du plan (intervalle, timeout)   |
| `FeatureUnavailableError` | 403  | `FEATURE_UNAVAILABLE` | feature absente du plan (vérification de contenu) |

Créer un moniteur ou un canal compte puis insère **dans la même transaction** : deux requêtes parallèles ne peuvent pas décrocher le même dernier slot libre. Baisser un quota ne supprime aucun moniteur existant — le surnombre devient visible dans `/console`, il n'est pas nettoyé de façon punitive.

## Le moteur de check côté contenu

Une assertion de contenu ne remplace pas le code HTTP : elle s'ajoute après un 2xx/3xx. `evaluateContent` (`server/checks/client.ts`) est délibérément prudent :

- insensible à la casse, sur le corps décodé brut ;
- corps **tronqué** à 256 Ko + `must_contain` absent → verdict `unknown`, jamais `DOWN`. Le texte peut être au-delà du cap de lecture ; en faire un incident, ce serait le faux-positif que ce module refuse déjà pour les pages volumineuses. `must_not_contain` n'a pas besoin de cette indulgence : trouver la chaîne est une preuve ;
- `Content-Type` non textuel (ni `text`, ni `json`, `xml`, `html`, `javascript`) → `unknown` avec le type en clair, sans chercher.

Deux classifications sont nées pour ça : `DOWN_KEYWORD_MISSING` (« Contenu attendu absent ») et `DOWN_KEYWORD_PRESENT` (« Contenu interdit présent »).

## Console créateur

Accès : colonne existante `users.role` (`"user"` / `"admin"`). Aucune migration d'accès n'a été nécessaire ; `requireAdmin` (`server/_core/http.ts:85-96`) lit la session et répond `403 FORBIDDEN`, et il est testé (`server/_core/http.test.ts:84-107`). Les écritures de la console détectent le slug déjà pris par une relecture explicite (`server/admin/routes.ts:319-330`), pas par un code d'erreur du pilote : elles échappent au déballage de l'enveloppe Drizzle que nécessite le `409 SLUG_TAKEN` des pages de statut (`server/statuspages/routes.ts:126`, `server/_core/db-error.ts:26-41`).

| route                                               | usage                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/admin/overview`                           | KPI (comptes, admins, monitors, incidents ouverts, monitors à mot-clé), répartition par plan, 200 premiers comptes |
| `GET /api/admin/plans`                              | plans complets, `isPublic` et `sortOrder` compris                                                                  |
| `POST /api/admin/plans`, `PUT /api/admin/plans/:id` | édition des paliers                                                                                                |
| `PUT /api/admin/users/:id/plan`                     | affectation d'un palier et de sa date d'essai                                                                      |

Écrites limitées à 60 requêtes/min par IP (`admin-write:<ip>`). Les logs structurés (`admin_plan_created`, `admin_plan_updated`, `admin_plan_assigned`) ne portent que des identifiants d'acteur et de cible.

Deux garde-fous contre la dérive auto-infligée :

- **`slug` est immuable** pour un palier existant. Renommer `free` est refusé (le fallback n'existerait plus), et renommer un autre palier **en** `free` est refusé (deux lignes se prétendraient le palier intégré).
- **L'ordre affiché sur le landing ne vient pas de `sortOrder`** : `/api/plans` trie par prix croissant avec `free` épinglé en premier. Un champ que l'éditeur laisse en l'état ne peut donc pas désordonner la vitrine commerciale.

Le client (`client/src/pages/AdminConsole.tsx`) édite des brouillons locaux (`Record<number, Draft>`), n'active l'enregistrement que si le brouillon diffère de la ligne, et affiche la répartition des comptes avant toute affectation.

## Ce qui reste hors scope

Aucun paiement en ligne : `priceCents` est un affichage, l'affectation d'un palier payant reste un geste d'administrateur. Pas de facturation, pas de webhook de paiement, pas d'auto-débit à la fin de l'essai — `trialEndsAt` n'est qu'une date affichée au compte et à la console.
