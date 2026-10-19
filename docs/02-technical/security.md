# Sécurité technique

## Surface authentifiée

Un seul compte peut ouvrir une session : l'adresse comparée à
`UPTIMEPULSE_OWNER_EMAIL` (`server/auth/owner.ts`, par défaut celle du créateur).
`POST /api/auth/register` refuse toute autre adresse **avant** tout hachage de
mot de passe (`403 REGISTRATION_CLOSED`), et `requireUser` répond
`403 ACCESS_RESERVED` pour une session forgée avant le verrou ou une ligne
éditée à la main. Le refus de connexion reste un `401` indistinguable : la
réponse ne dit jamais si le compte existe.

## Rate limiting

Le compteur vit en mémoire par processus (`server/auth/rateLimit.ts`, map bornée
à 10 000 entrées) : il protège login, register et les opérations sensibles d'une
instance, et repart de zéro au redémarrage. Avant un déploiement multi-instance,
il devra être remplacé par un bucket partagé en base ou une capacité de
plateforme.

## SSRF des checks

`server/monitors/ssrf.ts` valide la syntaxe (http/https uniquement, ni
identifiants dans l'URL ni port explicite) et les plages IP réservées, y compris
Teredo, 6to4 et IPv4-mapped. La résolution est contrôlée deux fois : avant
l'émission (`resolveAndValidateTarget`, qui refuse si **une** adresse résolue est
bloquée) et à chaque connexion grâce à un `lookup` personnalisé, ce qui ferme la
fenêtre de DNS rebinding entre le contrôle et le socket. Les redirections sont
plafonnées à trois sauts, chacune revalidée.

## Secrets

- Les journaux sont des JSON structurés qui n'impriment ni cookie, ni token, ni
  `DATABASE_URL`, ni clé d'encryption, ni configuration Telegram.
- Le jeton de session est stocké haché en SHA-256 ; le mot de passe en bcrypt,
  coût 12 (`server/auth/password.ts`).
- `notification_channels.configurationEncrypted` est chiffrée en AES-256-GCM
  (enveloppe `v1.iv.tag.ciphertext`) et aucune route ne sélectionne cette
  colonne pour l'afficher.
- Point de vigilance résiduel : `notification_deliveries.lastError` (500
  caractères) reçoit `error.message` d'un `fetch` dont l'URL porte le botToken
  Telegram. `server/notifications/telegram.ts` ne réverbère que le statut HTTP et
  Node n'inclut pas l'URL dans le message d'erreur, donc rien ne fuit aujourd'hui
  -- mais toute évolution de ce chemin doit préserver cette propriété.

## Chaîne publique

Les surfaces sans session (`/api/public/status/:slug`, intake et suivi QA,
`/api/plans`) sont limitées par token bucket, validées par schéma Zod, et ne
sélectionnent que les colonnes destinées au public : la sérialisation d'un ticket
est écrite champ par champ (`server/qa/tickets.ts`) pour qu'ajouter une colonne
au schéma ne puisse pas la publier par accident.
