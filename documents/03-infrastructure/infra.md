# Infrastructure, CI/CD et observabilité

## Runtime

Le projet utilise le conteneur Webdev fourni, `PORT`, `0.0.0.0` et `/api/health`. Le frontend est servi par le serveur Express en production. Les API et callbacks vont au serveur ; les assets fingerprintés peuvent utiliser un cache immutable ; les réponses authentifiées utilisent `private, no-store`.

## Heartbeat

Le job `uptimepulse-checks` est configuré en UTC à la minute vers `POST /api/scheduled/checks`. Le handler valide le JWT de Heartbeat, contrôle `appId` et l’identité `cron_`, traite au maximum 50 monitors dus et répond en 2xx uniquement lorsque le tick est accepté. Les transitions d’incident sont transactionnelles ; les retries ne doivent pas créer de duplicate incident ou notification.

Ce chemin est **conditionnel** : `ensureHeartbeatJob()` s’auto-inhibe sans
`MANUS_API_URL` et `MANUS_API_KEY` (`server/scheduler/register.ts:7`), donc en
local et en auto-hébergement le cron plateforme n’existe pas et seule la boucle
interne ci-dessous travaille. Le déclencheur lui-même est décrit dans
[`checks.md`](checks.md) §1.

## Scheduler interne

Le déclencheur externe n’est qu’une source de ticks : absent en développement local et perdu en cas de incident plateforme, il laisserait tous les monitors à `UNKNOWN`. `server/scheduler/loop.ts` exécute donc la même passe toutes les 30 secondes (première passe 2 secondes après le démarrage), et chaque check est revendiqué atomiquement de toute façon : les ticks concurrents d’un heartbeat ou d’une autre instance ne doublent pas le travail. Désactiver la boucle avec `SCHEDULER_INTERNAL=0` si le déploiement se normalise sur un cron externe.

Les passes qualité (`server/qa/selfTest.ts`, `server/qa/digest.ts`) sont montées sur ce même tick, après la purge de rétention. Elles revendiquent une période UTC dans `qa_runs` : un appel tous les 30 secondes ne coûte qu’un rejet de clé dupliquée et ne produit jamais deux points du même jour.

## CI

Chaque PR exécute `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`, un audit de dépendances, la construction de l’image Docker, un smoke test sur `GET /api/health` et un scan de secrets. Les runs sont annulés automatiquement sur le même ref et `GITHUB_TOKEN` est borné à `contents: read`.

## Fuseau horaire

Le pool MySQL est épinglé à UTC dans `server/db.ts` (`timezone: "Z"` et `SET time_zone = '+00:00'` sur chaque connexion). Sans cela, `NOW()` et les colonnes `TIMESTAMP` suivent le fuseau de l’hôte alors que Node écrit des `Date` en UTC ; sur un hôte non UTC, la comparaison `nextCheckAt <= now()` cesse de correspondre et le scheduler ne sélectionne plus aucun monitor. Une base existante stockée en heure locale demande une conversion unique en UTC.

## Développement local

La procédure complète, les variables requises et la façon de déclencher le
pipeline de checks sans le runtime Webdev sont documentées dans
[`local-dev.md`](local-dev.md). Les dix-huit variables que le code lit, avec leur
régime obligatoire ou optionnel, tiennent dans [`environnement.md`](environnement.md) ;
la mise en production réelle — image Docker, serving Express, migrations sur base
neuve, sauvegarde — dans [`deploiement.md`](deploiement.md).

## Observabilité

Le produit journalise en JSON structuré sur stdout. **Vingt-trois noms
d'événements** sont réellement émis par le code de production — la version
précédente de cette page en listait quatorze et en ignorait neuf
(`monitor_check_failed`, `notification_dispatch_failed`,
`notification_delivery_insert_failed`, `notification_retry_error`,
`scheduler_loop_error`, `heartbeat_registered`, `heartbeat_registration_failed`,
`database_error`, `unhandled_request_error`). Les neuf manquants sont justement
ceux qui signalent une panne : les énumérer est le coeur du sujet. Le tableau
complet — événement, fichier, champs portés, et ce que chacun implique — est
dans [`observabilite.md`](observabilite.md).

Règles constantes : aucun événement ne porte de cookie, de jeton, de
`DATABASE_URL`, de clé d'encryption ni de configuration Telegram ; les événements
d'administration ne portent que l'identifiant de l'acteur et celui de la cible,
jamais l'e-mail affecté ni le contenu d'un palier ; les deux passes qualité
n'interrompent jamais les checks, leur échec reste visible en log.
`GET /api/health` ne divulgue ni DSN ni état interne détaillé. Les réponses API
authentifiées sont `private, no-store` ; les assets fingerprintés peuvent être
cachés longuement par la publication.
