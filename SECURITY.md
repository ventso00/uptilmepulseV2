# Security Policy

## Principes

UptimePulse traite des URLs et des secrets de notification. Toute donnée appartient à un utilisateur identifié et les routes privées appliquent systématiquement l’ownership. Les erreurs exposées au client restent génériques ; les logs structurés excluent mots de passe, cookies, tokens, DSN et configurations Telegram.

Chaque route est enregistrée via `asyncHandler` et aboutit au gestionnaire d’erreur terminal de `server/_core/http.ts`. Sans cela, Express 4 laisse une promesse rejetée pendre la requête jusqu’au timeout du proxy au lieu de produire une réponse : toute exception de base de données doit remonter par ce chemin, jamais par un `catch` silencieux. Les détails du pilote ne sont jamais renvoyés au client.

## SSRF

Les cibles acceptées sont HTTP/HTTPS uniquement. Les noms et adresses localhost, loopback, réseaux privés/réservés, link-local, metadata cloud, ULA IPv6, IPv4 mappé, plages de tunneling IPv6 (6to4 `2002::/16`, Teredo `2001::/32`) et autres plages documentées dans le cahier sont bloqués. Les redirects sont manuels et chaque destination est revalidée. Un timeout, une taille maximale de réponse et une limite de redirects sont obligatoires.

## Authentification

Les mots de passe utilisent bcrypt. Les sessions sont opaques, expirables, révocables et stockées sous forme hashée. Le cookie applicatif n’utilise jamais `app_session_id`, réservé à la plateforme. Les endpoints register/login et les tests de canal sont limités en débit.

## Secrets

La clé serveur `UPTIMEPULSE_ENCRYPTION_KEY` sera fournie via les secrets protégés Webdev avant l’activation de Telegram. Les tokens et chat IDs sont chiffrés avant persistance et ne sortent jamais dans l’UI, les réponses d’API, les captures ou le dépôt. `.env*` reste ignoré par Git ; les exemples documentent uniquement des placeholders.

**Rotation.** Cette clé dérive la clé AES-256-GCM par SHA-256. La changer rend chaque token Telegram stocké définitivement indéchiffrable, sans mécanisme de récupération : il faut alors supprimer et recréer les canaux. La conserver dans un gestionnaire de secrets, jamais dans un fichier du dépôt.

## Cookies et transport

Le cookie de session applicatif est `httpOnly`, `secure` et `sameSite: "none"`.
Cette combinaison **exige HTTPS** : en HTTP simple le navigateur rejette le
cookie et la connexion devient impossible. Le déploiement doit donc être servi
en TLS dès le premier jour, et le proxy doit exposer `X-Forwarded-Proto` pour que
l’application interprète correctement la requête.

Le limiter de débit est en mémoire et propre à chaque instance : une
déploiement horizontal donne à chaque réplique son propre budget. Passer à un
stockage partagé avant de mettre en service plusieurs instances.

## Point de vigilance

Le scheduler est protégé par un JWT signé (`MANUS_JWT_SECRET`) portant un `appId`
et une identité `cron_`. Toute personne détenant ce cookie peut déclencher un
lot de checks. Ce secret est aussi utilisé pour signer les sessions applicatives
— le compromettre expose donc les deux surfaces. Le faire tourner périodiquement
et le traiter comme une donnée de production.

## Signalement

Pour signaler une vulnérabilité, ouvrir un rapport privé au mainteneur du dépôt avec une description reproductible, l’impact observé et une proposition de mitigation. Ne publiez pas de secret ou de preuve contenant des données réelles.
