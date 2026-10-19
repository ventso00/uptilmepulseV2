# Variables d'environnement

Cette page est la référence pour **toutes** les variables que le code lit. Elle
détaille pour chacune : qui la consomme, ce qui se passe quand elle absente, et
le piège opérationnel associé.

Règle de lecture : jamais de valeur dans un document, dans un log ou dans une
capture. Un nom de variable, oui ; son contenu, non.

## Comment elles arrivent dans le processus

`server/_core/index.ts:1` charge `dotenv/config` avant toute autre importation,
donc un fichier `.env` présent dans le **répertoire de travail courant** est lu
au démarrage. `.env`, `.env.local` et les variantes par mode sont ignorés par git
(`.gitignore:11-15`) ; `.dockerignore` exclut `.env` et `.env.*` de l'image
(`.dockerignore:4-5`), ce qui fait que le conteneur ne peut recevoir sa
configuration que par l'orchestrateur.

Le modèle d'accès est homogène : la plupart des variables sont lues **au moment
de l'usage** et non au démarrage. Conséquence pratique : une variable manquante
ne fait pas échouer le boot, elle désactive ou fait échouer la fonctionnalité
concernée au premier appel. C'est volontaire pour les sphères optionnelles, et
c'est ce qui rend le diagnostic de `depannage.md` possible (absence de base de
données = moniteurs qui restent `UNKNOWN`, pas un plantage).

Le fichier `.env.example` (53 lignes) est le modèle à copier.

## Les quinze variables que le code lit

### Obligatoires pour un fonctionnement réel

| Variable                     | Lue par                                                            | Sans elle                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | `server/db.ts:22`, `server/_core/env.ts:10`, `drizzle.config.ts:3` | `getDb()` renvoie `null` indéfiniment : aucun monitor ne sort de `UNKNOWN`, la file de notifications ne peut pas être écrite, les passes qualité s'arrêtent en silence. Les commandes `drizzle-kit` lèvent `DATABASE_URL is required to run drizzle commands` (`drizzle.config.ts:5`). |
| `UPTIMEPULSE_ENCRYPTION_KEY` | `server/notifications/crypto.ts:14`                                | `getKey()` lève `Encryption key is not configured` dès qu'une chaîne est vide **ou plus courte de 16 caractères** (`server/notifications/crypto.ts:15-16`). La clé effective est le SHA-256 de cette chaîne : elle n'est jamais utilisée brute.                                        |

### Applicatives

| Variable                  | Lue par                                                                    | Comportement par défaut                                                                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                    | `server/_core/index.ts:83`                                                 | `3000`. Une valeur non numérique donne `NaN` puis lève `Invalid PORT` (`server/_core/index.ts:84-85`) ; l'écoute se fait sur `0.0.0.0` (`server/_core/index.ts:90`).                                                        |
| `NODE_ENV`                | `server/_core/index.ts:73`, `server/_core/vite.ts:52`, `vite.config.ts:81` | Toute valeur autre que `development` sélectionne `serveStatic` : le serveur sert `dist/public` au lieu de monter Vite. Ce n'est pas un booléen « production » — `production`, `staging` ou vide produisent la même branche. |
| `APP_BASE_URL`            | `server/qa/routes.ts:51`                                                   | Vide : l'origine est reconstruite depuis `x-forwarded-host` puis `host`, avec contrôle de forme `HOST_PATTERN` (`server/qa/routes.ts:43`) ; un hôte refusé donne une chaîne vide et le lien de suivi est simplement omis.   |
| `SCHEDULER_INTERNAL`      | `server/scheduler/loop.ts:20`                                              | Toute valeur autre que la chaîne exacte `0` laisse la boucle interne active (passe toutes les 30 s, première à 2 s). Écrire `false` ou `off` ne désactive donc **rien**.                                                    |
| `UPTIMEPULSE_OWNER_EMAIL` | `server/auth/owner.ts:16`                                                  | Retombée sur la constante `DEFAULT_OWNER_EMAIL` du fichier. La valeur est normalisée (`trim` + minuscules) exactement comme `emailSchema`, pour rester comparable aux adresses stockées.                                    |

### Platforme — sphère dormante

Ces variables appartiennent à l'exécution conteneurisée de la plateforme Webdev
(OAuth et cron de plateforme). Le produit fonctionne sans aucune d'elles : la
sphère
machine qu'elles alimentent n'est atteignable que par les callbacks
`/api/scheduled/*`, et la boucle interne fait le travail du cron. Elles sont
documentées ici parce que le code les lit, pas parce qu'il faut les renseigner.

| Variable                 | Lue par                                      | Consommateur réel                                                                                                                                                                                                                                        |
| ------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MANUS_PROJECT_ID`       | `server/_core/env.ts:4` (`ENV.appId`)        | Contrôle `appId` des JWT machine (`server/scheduler/heartbeatAuth.ts:12,20`) et identifiant client OAuth (`server/_core/sdk.ts:55,179,223`).                                                                                                             |
| `MANUS_JWT_SECRET`       | `server/_core/env.ts:7` (`ENV.cookieSecret`) | Clé HS256 de vérification des JWT machine (`server/scheduler/heartbeatAuth.ts:16`) ; le chemin OAuth lève `MANUS_JWT_SECRET is unavailable` (`server/_core/sdk.ts:163`).                                                                                 |
| `MANUS_API_URL`          | `server/_core/env.ts:22` (`ENV.forgeApiUrl`) | Base du registre de heartbeat (`server/_core/heartbeat.ts:46,58`) et du service de notification propriétaire (`server/_core/notification.ts:69,83`). Son absence fait retourner `ensureHeartbeatJob()` dès la ligne 7 de `server/scheduler/register.ts`. |
| `MANUS_API_KEY`          | `server/_core/env.ts:25` (`ENV.forgeApiKey`) | Bearer des mêmes appels (`server/_core/heartbeat.ts:71`, `server/_core/notification.ts:90`) ; deuxième condition d'auto-inhibition de l'enregistrement (`server/scheduler/register.ts:7`).                                                               |
| `MANUS_OAUTH_API_URL`    | `server/_core/env.ts:13`                     | Base du serveur OAuth ; non renseignée, `server/_core/sdk.ts:41` avertit et l'initialisation OAuth ne peut pas aboutir.                                                                                                                                  |
| `MANUS_API_BROWSER_KEY`  | `server/_core/publicConfig.ts:7`             | Exposée au navigateur par `GET /api/platform/config.js`. C'est la seule des six à être **destinée au client** : `publicConfig.ts:1-9` ne sérialise que ces quatre champs, jamais `process.env`.                                                          |
| `MANUS_OAUTH_PORTAL_URL` | `server/_core/publicConfig.ts:6`             | Idem : valeur publique d'entrée du portail OAuth.                                                                                                                                                                                                        |

Total : les deux variables lues seulement par `publicConfig.ts` s'ajoutent aux
cinq lues par `ENV`, ce qui donne bien quinze noms distincts dans tout le dépôt.

### Héritée

| Variable        | Lue par                  | Effet                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OWNER_OPEN_ID` | `server/_core/env.ts:17` | Uniquement un raccourci d'amorçage de rôle : `server/db.ts:82-84` attribue `role = "admin"` à l'utilisateur dont l'`openId` correspond, quand aucune role explicite n'est fournie. C'est une commodité conservée de l'époque plateforme ; l'accès propriétaire réel se décide par l'e-mail (`server/auth/owner.ts:19`), pas par cette variable. Vide par défaut, donc sans effet. |

## Rotation et conséquences

- **`UPTIMEPULSE_ENCRYPTION_KEY`** : changer la valeur rend indéchiffrables
  toutes les enveloppes `v1.<iv>.<tag>.<chiffré>` déjà stockées dans
  `notificationChannels.configurationEncrypted`. Il n'existe pas de procédure de
  re-chiffrement : la seule voie propre est de supprimer puis recréer chaque
  canal. C'est la raison pour laquelle `.env.example` marque cette variable comme
  rotation interdite.
- **`DATABASE_URL`** : passer d'une hôte à un autre ne demande rien de plus, mais
  une base dont les `TIMESTAMP` ont été écrits en heure locale doit être convertie
  en UTC une fois, sinon la comparaison `nextCheckAt <= now()` ne sélectionne plus
  rien. Le pool épingle `timezone: "Z"` et `SET time_zone = '+00:00'` sur chaque
  connexion (`server/db.ts:27-36`) ; cela protège les écritures futures, pas les
  données déjà décalées.
- **`APP_BASE_URL`** : à renseigner dès que l'application tourne derrière un
  proxy. Laisser l'origine se déduire de l'en-tête `Host` est corrigé par le
  contrôle de forme, mais un hôte forgé reste possible s'il a une apparence
  valide ; le lien de suivi QA et les modèles de réponse client héritent alors de
  cette origine.
- **`UPTIMEPULSE_OWNER_EMAIL`** : la changer déplace la porte d'inscription. Un
  compte déjà créé avec l'ancienne adresse n'est plus reconnu comme propriétaire
  par `isOwnerEmail` (`server/auth/owner.ts:19-21`) ; il reste en base et se
  connecte, mais perd les parcours réservés.

## Ce que le projet ne lit pas

Aucune autre variable d'environnement n'est consommée par le code applicatif. En
particulier, il n'y a pas de variable pour : le nombre maximal de moniteurs
(choix durci dans les paliers de la table `plans`), la fenêtre de rétention, la
taille de batch du scheduler (`BATCH_SIZE` dans `server/scheduler/tick.ts`), la
concurrence des checks, ni le seuil de l'analyse de latence
(`LATENCY_SAMPLE_CAP_PER_MONITOR` dans `server/statuspages/analysis.ts`). Ces
valeurs se modifient dans le source et sont documentées ailleurs dans ce dépôt.

Un détail à connaître en relisant le code : le getter `ENV.isProduction`
(`server/_core/env.ts:19-21`) n'a **aucun consommateur** dans `client/`, `server/`
ou `shared/`. Le mode est décidé en lisant `process.env.NODE_ENV` directement aux
trois endroits cités plus haut. Ce getter est donc une porte ouverte, pas un
interrupteur : ne pas compter sur lui pour activer un comportement.

## Contrôler une valeur sans l'exposer

Pour vérifier qu'une variable est bien présente sans imprimer son contenu :

```bash
node -e "require('dotenv').config(); console.log(Object.entries(process.env).filter(([k])=>/^(DATABASE_URL|UPTIMEPULSE|MANUS_|APP_BASE_URL|OWNER_OPEN_ID|PORT|NODE_ENV|SCHEDULER_INTERNAL)$/.test(k)).map(([k,v])=>[k, v ? 'présente ('+v.length+' chars)' : 'absente']))"
```

Le script ne renvoie que des longueurs. La même discipline vaut pour les logs :
les événements structurés du serveur ne portent que des identifiants et des
durées, jamais un jeton ni un mot de passe
(`docs/03-infrastructure/observabilite.md`).
