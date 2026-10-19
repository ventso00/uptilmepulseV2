# Security Policy

## Principes

UptimePulse traite des URLs et des secrets de notification. Toute donnée appartient à un utilisateur identifié et les routes privées appliquent systématiquement l’ownership. Les erreurs exposées au client restent génériques ; les logs structurés excluent mots de passe, cookies, tokens, DSN et configurations Telegram.

Chaque route est enregistrée via `asyncHandler` et aboutit au gestionnaire d’erreur terminal de `server/_core/http.ts`. Sans cela, Express 4 laisse une promesse rejetée pendre la requête jusqu’au timeout du proxy au lieu de produire une réponse : toute exception de base de données doit remonter par ce chemin, jamais par un `catch` silencieux. Les détails du pilote ne sont jamais renvoyés au client.

## SSRF

Les cibles acceptées sont HTTP/HTTPS uniquement. Les noms et adresses localhost, loopback, réseaux privés/réservés, link-local, metadata cloud, ULA IPv6, IPv4 mappé, plages de tunneling IPv6 (6to4 `2002::/16`, Teredo `2001::/32`) et autres plages documentées dans le cahier sont bloqués. Les redirects sont manuels et chaque destination est revalidée. Un timeout, une taille maximale de réponse et une limite de redirects sont obligatoires.

## Authentification

Les mots de passe utilisent bcrypt. Les sessions sont opaques, expirables, révocables et stockées sous forme hashée. Le cookie applicatif n’utilise jamais `app_session_id`, réservé à la plateforme. Les endpoints register/login et les tests de canal sont limités en débit.

## Secrets

La clé serveur `UPTIMEPULSE_ENCRYPTION_KEY` se fournit par variable
d'environnement : un `.env` local hors dépôt en développement, un secret de
l'orchestrateur en déploiement (`.dockerignore:4-5` exclut `.env` et `.env.*` de
l'image, donc le conteneur ne peut la recevoir que par `--env-file` ou
équivalent). Les tokens et chat IDs sont chiffrés avant persistance et ne sortent
jamais dans l'UI, les réponses d'API, les captures ou le dépôt. `.env*` reste
ignoré par Git ; les exemples ne documentent que des placeholders.

**Rotation.** Cette clé dérive la clé AES-256-GCM par SHA-256. La changer rend chaque token Telegram stocké définitivement indéchiffrable, sans mécanisme de récupération : il faut alors supprimer et recréer les canaux. La conserver dans un gestionnaire de secrets, jamais dans un fichier du dépôt.

## Cookies et transport

Le cookie de session applicatif est `httpOnly`, `secure` et `sameSite: "none"`.
Cette combinaison **exige HTTPS** : en HTTP simple le navigateur rejette le
cookie et la connexion devient impossible. Le déploiement doit donc être servi
en TLS dès le premier jour, et le proxy doit exposer `X-Forwarded-Proto` pour que
l’application interprète correctement la requête.

Le limiteur de débit est en mémoire et propre à chaque instance : un
déploiement horizontal donne à chaque réplique son propre budget. Passer à un
stockage partagé avant de mettre en service plusieurs instances.

## Point de vigilance

Le endpoint du scheduler (`POST /api/scheduled/checks`) est protégé par un **JWT
porteur** signé en HS256 avec `MANUS_JWT_SECRET`, contrôlé sur `appId` et sur une
identité préfixée `cron_` (`server/scheduler/heartbeatAuth.ts:12-21`). Quiconque
détient ce secret peut mint un jeton et déclencher des lots de checks ; le jeton
lui-même se présente en en-tête `Authorization`, jamais en cookie.

Ce que la rotation de `MANUS_JWT_SECRET` atteint, et ce qu'elle n'atteint pas :

- elle révoque les jetons machine déjà émis, et coupe la sphère OAuth de la
  plateforme (`server/_core/sdk.ts:162-163` lit la même valeur) ;
- elle **ne touche pas aux sessions applicatives** : le cookie
  `uptimepulse_session` porte un jeton opaque `randomBytes(32)`, stocké sous
  forme de son SHA-256 et validé en base (`server/auth/session.ts:8-22`), sans
  signature. Faire tourner `MANUS_JWT_SECRET` ne déconnecte donc personne.

Traiter la valeur comme une donnée de production : elle n'a rien à faire dans un
fichier du dépôt, et son absence désactive simplement la sphère plateforme sans
casser le produit.

## Signalement

Pour signaler une vulnérabilité, ouvrir un rapport privé au mainteneur du dépôt avec une description reproductible, l’impact observé et une proposition de mitigation. Ne publiez pas de secret ou de preuve contenant des données réelles.
