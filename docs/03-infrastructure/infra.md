# Infrastructure, CI/CD et observabilité

## Runtime

Le projet utilise le conteneur Webdev fourni, `PORT`, `0.0.0.0` et `/api/health`. Le frontend est servi par le serveur Express en production. Les API et callbacks vont au serveur ; les assets fingerprintés peuvent utiliser un cache immutable ; les réponses authentifiées utilisent `private, no-store`.

## Heartbeat

Le job `uptimepulse-checks` est configuré en UTC à la minute vers `POST /api/scheduled/checks`. Le handler valide le JWT de Heartbeat, contrôle `appId` et l’identité `cron_`, traite au maximum 50 monitors dus et répond en 2xx uniquement lorsque le tick est accepté. Les transitions d’incident sont transactionnelles ; les retries ne doivent pas créer de duplicate incident ou notification.

## Scheduler interne

Le déclencheur externe n’est qu’une source de ticks : absent en développement local et perdu en cas de incident plateforme, il laisserait tous les monitors à `UNKNOWN`. `server/scheduler/loop.ts` exécute donc la même passe toutes les 30 secondes (première passe 2 secondes après le démarrage), et chaque check est revendiqué atomiquement de toute façon : les ticks concurrents d’un heartbeat ou d’une autre instance ne doublent pas le travail. Désactiver la boucle avec `SCHEDULER_INTERNAL=0` si le déploiement se normalise sur un cron externe.

Les passes qualité (`server/qa/selfTest.ts`, `server/qa/digest.ts`) sont montées sur ce même tick, après la purge de rétention. Elles revendiquent une période UTC dans `qa_runs` : un appel tous les 30 secondes ne coûte qu’un rejet de clé dupliquée et ne produit jamais deux points du même jour.

## CI

Chaque PR exécute `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`, un audit de dépendances, la construction de l’image Docker, un smoke test sur `GET /api/health` et un scan de secrets. Les runs sont annulés automatiquement sur le même ref et `GITHUB_TOKEN` est borné à `contents: read`.

## Fuseau horaire

Le pool MySQL est épinglé à UTC dans `server/db.ts` (`timezone: "Z"` et `SET time_zone = '+00:00'` sur chaque connexion). Sans cela, `NOW()` et les colonnes `TIMESTAMP` suivent le fuseau de l’hôte alors que Node écrit des `Date` en UTC ; sur un hôte non UTC, la comparaison `nextCheckAt <= now()` cesse de correspondre et le scheduler ne sélectionne plus aucun monitor. Une base existante stockée en heure locale demande une conversion unique en UTC.

## Développement local

La procédure complète, les variables requises et la façon de déclencher le pipeline de checks sans le runtime Webdev sont documentées dans [`local-dev.md`](local-dev.md).

## Observabilité

Les logs structurés utilisent les événements `monitor_check`, `incident_confirmed`, `incident_resolved`, `notification_delivery`, `scheduler_tick`, `retention_sweep_error`, `qa_self_test`, `qa_self_test_ticket_error`, `qa_self_test_error`, `qa_daily_digest`, `qa_daily_digest_error`, `admin_plan_created`, `admin_plan_updated` et `admin_plan_assigned` avec durée, statut et identifiants non sensibles. Les événements d’administration ne portent que l’identifiant de l’acteur et celui de la cible : jamais l’e-mail affecté, ni le contenu d’un palier. Les deux passes qualité ne propagent jamais leur exception : un auto-test cassé doit rester visible dans les logs sans interrompre les checks. `GET /api/health` ne divulgue ni DSN ni état interne détaillé. Les réponses API authentifiées sont `private, no-store`; les assets fingerprintés peuvent être cachés longuement par la publication.
