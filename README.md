# UptimePulse

Surveillance HTTP/HTTPS pour développeurs freelances, créateurs de SaaS, agences
web et propriétaires de boutiques en ligne. UptimePulse vérifie des URLs,
conserve l'historique, confirme les incidents après plusieurs échecs, alerte
via Telegram et expose un dashboard opérationnel.

## Fonctionnement

Un check planifié sélectionne les monitors dont `nextCheckAt` est échu, réserve
le monitor via une mise à jour conditionnelle (bail de 6 minutes) qui empêche
les checks concurrents, résout puis re-valide le DNS, exécute la requête HTTP,
puis écrit le ping log et la transition d'incident dans une seule transaction.
Le dashboard expose la même pipeline à la demande (« Vérifier maintenant »,
`POST /api/monitors/:id/check`) : le bail du monitor est avancé à maintenant, le
check part sur le même chemin atomique, et une barre d'uptime (30 derniers
checks par monitor) se met à jour automatiquement toutes les minutes.

Chaque check chronomètre les phases réseau du dernier hop (résolution DNS,
connexion TCP, handshake TLS, premier octet) et lit le certificat du pair sur
HTTPS : la page détail affiche une décomposition de latence, les p50/p95 et un
compte à rebours d'expiration du certificat TLS.

Un échec isolé ouvre un incident **suspect**, invisible pour l'utilisateur. Trois
échecs consécutifs le **confirment** et déclenchent une alerte. Deux succès
consécutifs le **résolvent** et déclenchent l'alerte de rétablissement. Cette
règle 3/2 élimine les faux positifs sans introduire de délai notable.

Un monitor peut en plus **vérifier son contenu** : le mot-clé attendu (ou interdit)
est cherché sur le corps décodé après un 2xx/3xx. Une absence sur une page tronquée
au cap des 256 Ko reste non concluante plutôt que de devenir un incident, et un
`Content-Type` binaire n'est pas inspecté. Deux classifications rendent l'échec
lisible : contenu attendu absent, contenu interdit présent.

Chaque tick du scheduler termine par une purge incrémentale de rétention
(`server/scheduler/retention.ts`) : sessions expirées, ping logs de plus de
90 jours et livrables de notification de plus de 90 jours, supprimés par
petits lots de 1 000 pour ne jamais bloquer un check. La base reste ainsi de
taille bornée à long terme.

Chaque utilisateur peut publier une **page de statut** (`/status/:slug`,
`GET /api/public/status/:slug`) : bannière d'état global, uptime 90 jours et
calendrier quotidien par service (agrégats SQL groupés par jour), incidents
confirmés, sans authentification. La route publique est limitée par IP et
cachée 30 secondes.

Le module **qualité et support** (`/qa`, `server/qa/`) automatise le travail
d'un analyste QA. Un visiteur signale un problème depuis n'importe quelle page —
le navigateur attache d'office la route, le viewport, la langue et les dix
dernières erreurs JavaScript et appels API en échec. Le dossier arrive dans la
file du compte concerné avec ses étapes de reproduction, son attendu vs réel et
un rapport interne en français, généré à la lecture. Sept invariants de
fonctionnement (base joignable, ordonnanceur vivant, premier résultat obtenu,
file de notification fluide, tentatives non épuisées, incident ouvert pour
chaque panne, purge à jour) sont rejoués toutes les 15 minutes et ouvrent un
ticket unique par anomalie persistante. Un
point quotidien structuré couvre le flux du jour, les relances en attente et les
prochaines actions. Chaque client reçoit un **lien de suivi confidentiel**
(`/support/:token`, lecture seule, sans compte) sur lequel seules les notes
marquées publiques apparaissent ; un ticket sans activité depuis 48 heures est
signalé comme suivi dû.

Le produit tourne pour **un seul opérateur** : l'authentification est verrouillée
sur l'adresse du créateur (`UPTIMEPULSE_OWNER_EMAIL`, avec l'adresse par défaut
dans `server/auth/owner.ts`), l'inscription refuse toute autre adresse, et
`requireUser` écarte tout autre compte. Les propriétaires de site surveillés n'ont
donc pas de compte : ils ouvrent des URL publiques. `/` présente le produit,
`/status/:slug` donne le verdict en une phrase, la liste des problèmes et
l'analyse mesurée, `/support/:token` suit leur signalement. Ces trois surfaces
rendent un thème **clair** que l'application dérive de la route, tandis que les
postes de pilotage (`/dashboard`, `/qa`, `/console`) restent sombres.
Voir [`docs/02-technical/access-model.md`](docs/02-technical/access-model.md).

Le modèle **freemium** est piloté par la base, pas par le code. La table `plans`
porte pour chaque palier son quota de monitors, son intervalle minimum, son timeout
maximum, son quota de canaux et l'accès ou non à la vérification de contenu ; le
prix affiché sur le landing vient de ces mêmes lignes. `/console` (compte
`role = 'admin'`) permet de créer, modifier et affecter ces paliers, avec la
répartition réelle des comptes et des monitors par plan. Un compte sans palier
retombe sur le free intégré : supprimer un palier ne verrouille personne.
Voir [`docs/02-technical/plans-and-billing.md`](docs/02-technical/plans-and-billing.md).

## Stack

- React 19 + Vite 7 + Tailwind 4
- Express 4 + TypeScript + Drizzle ORM
- MySQL 8 ( managé ou local )
- Vitest, oxlint, pnpm 10.18.0, GitHub Actions
- Heartbeat Webdev pour le callback périodique après publication

## Démarrage

```bash
pnpm install
cp .env.example .env    # renseigner DATABASE_URL et UPTIMEPULSE_ENCRYPTION_KEY
pnpm db:migrate
pnpm dev
```

La procédure détaillée, les variables requises et la façon de déclencher les
checks sans le runtime Webdev sont dans
[`docs/03-infrastructure/local-dev.md`](docs/03-infrastructure/local-dev.md).

## Qualité

```bash
pnpm check         # tsc --noEmit
pnpm lint          # oxlint, warnings refusés
pnpm test          # vitest
pnpm build         # bundle vite + serveur esbuild
pnpm format:check  # prettier sur tout le dépôt
```

## Architecture

| Dossier                        | Rôle                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client/src/pages`             | Écrans : landing publique `/`, dashboard `/dashboard`, détail monitor, paramètres, file qualité `/qa`, suivi client `/support/:token`, console créateur `/console`, authentification |
| `client/src/components/uptime` | Composants métier : shell, dialogue, menu de ligne, badge d'état                                                                                                                     |
| `client/src/lib/api.ts`        | Client REST typé, valide chaque réponse contre `shared/contracts.ts`                                                                                                                 |
| `client/src/lib/qaContext.ts`  | Capture navigateur des preuves (erreurs JavaScript, appels API en échec)                                                                                                             |
| `server/auth`                  | Sessions opaques, mots de passe, rate limiting                                                                                                                                       |
| `server/checks`                | Client HTTP protégé SSRF, assertion de contenu et moteur de check                                                                                                                    |
| `server/plans`                 | Plan effectif lu en base, quotas, limites et features, réponses d'erreur normalisées                                                                                                 |
| `server/admin`                 | API du créateur : overview, édition des paliers, affectation des comptes                                                                                                             |
| `server/monitors`              | CRUD, validation de cible, agrégats d'uptime                                                                                                                                         |
| `server/incidents`             | Machine à états pure des transitions d'incident                                                                                                                                      |
| `server/notifications`         | Chiffrement, dispatcher, Telegram, retries                                                                                                                                           |
| `server/scheduler`             | Pool borné, endpoint heartbeat, enregistrement du cron, purge de rétention                                                                                                           |
| `server/qa`                    | File de signalements, auto-tests d'invariants, point quotidien, rapports et réponses clients                                                                                         |
| `server/statuspages`           | Pages de statut publiques et leur module d'analyse                                                                                                                                   |
| `server/routes`                | Route transverse : agrégat du dashboard                                                                                                                                              |
| `shared/contracts.ts`          | Schémas zod partagés par le client et le serveur                                                                                                                                     |
| `drizzle`                      | Schéma et migrations versionnées                                                                                                                                                     |

## Documentation

- [`docs/01-product/vision.md`](docs/01-product/vision.md) — vision, personas, critères MVP
- [`docs/02-technical/api.md`](docs/02-technical/api.md) — architecture, données, contrat API
- [`docs/02-technical/access-model.md`](docs/02-technical/access-model.md) — opérateur unique, surfaces publiques clientes, deux régimes de thème dérivés de la route
- [`docs/02-technical/status-page-analysis.md`](docs/02-technical/status-page-analysis.md) — métriques du statut public : fenêtres, formules, coût SQL, règles d'honnêteté
- [`docs/02-technical/qa-support.md`](docs/02-technical/qa-support.md) — module qualité : invariants d'auto-test, tickets et preuves, rapports et réponses clients, point quotidien, suivi à 48 h
- [`docs/02-technical/plans-and-billing.md`](docs/02-technical/plans-and-billing.md) — modèle freemium : paliers en base, application des quotas, assertion de contenu, console créateur
- [`docs/02-technical/security.md`](docs/02-technical/security.md) — modèle de menace et contrôles
- [`docs/03-infrastructure/infra.md`](docs/03-infrastructure/infra.md) — déploiement, CI/CD, scheduler, observabilité
- [`docs/03-infrastructure/local-dev.md`](docs/03-infrastructure/local-dev.md) — développement local
- [`docs/04-project/decisions.md`](docs/04-project/decisions.md) — ADR et changelog

## Sécurité

Les secrets ne sont jamais committés. Les mots de passe sont hashés (bcrypt,
coût 12), les sessions sont opaques et révocables, chaque route privée vérifie
la propriété de la ressource, et les cibles de check passent par une validation
SSRF complète — résolution DNS revalidée à chaque redirection, plages privées et
loopback bloquées, corps de réponse plafonné à 256 Ko, redirections limitées à 3.

`UPTIMEPULSE_ENCRYPTION_KEY` chiffre les tokens de notification en AES-256-GCM.
**La perdre rend tous les tokens Telegram définitivement illisibles.** Lire
[`SECURITY.md`](SECURITY.md) avant toute extension.

## Périmètre

Le MVP inclut authentification email/mot de passe réservée au créateur, CRUD de monitors, checks
HTTP/HTTPS avec assertion de contenu, analyse technique (phases réseau, certificat TLS, p50/p95),
historique, incidents 3/2, Telegram, pages de statut publiques
(`/status/:slug`), file qualité et support client (`/qa`, suivi `/support/:token`),
paliers freemium éditables en base (`/console`), dashboard, protection SSRF,
tests, logs structurés et CI. Discord, email, paiement en ligne,
équipes et multi-région restent postérieurs au MVP.

## Licence

MIT — voir [`LICENSE`](LICENSE).
