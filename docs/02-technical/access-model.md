# Modèle d'accès et régimes de lecture

UptimePulse est un produit **à opérateur unique**. Cette page est la source de
vérité sur qui peut faire quoi : elle explique le verrou d'authentification,
les surfaces publiques, et pourquoi deux régimes visuels coexistent dans le
même client.

## Qui authentifie

Une seule adresse peut obtenir une session : celui du créateur.

- `server/auth/owner.ts` expose `OWNER_EMAIL` et `isOwnerEmail()`. La valeur
  par défaut est `rajaomanjatoventso@gmail.com` ; `UPTIMEPULSE_OWNER_EMAIL` la
  remplace pour un déploiement. La comparaison passe par la même
  normalisation (`trim` + `toLowerCase`) que `emailSchema`, sinon un simple
  espace ou une majuscule contournerait le garde.
- `POST /api/auth/register` refuse toute autre adresse **avant** de calculer
  le hash : `403 REGISTRATION_CLOSED`. L'endpoint n'existe que pour que le
  créateur réclame son compte et choisisse son mot de passe ; il ne peut donc
  pas servir à frapper le CPU en bcrypt coût 12 ni à créer un second compte.
  Le compte créé porte `role = 'admin'`, ce qui rend l'administrateur
  structurellement unique.
- `requireUser` (`server/_core/http.ts`) vérifie l'email de la session
  résolue : un token de session valide mais d'un autre compte répond
  `403 ACCESS_RESERVED`. Le verrou est serveur — masquer des liens côté client
  n'aurait été qu'une esthétique.
- `POST /api/auth/login` renvoie un `401` indistinguable d'un mauvais mot de
  passe : la route ne révèle pas si une adresse existe ou si elle est
  réservée.

Conséquence pratique : les comptes de démonstration créés avant ce verrou
(`demo@uptimepulse.dev`, `demo@uptimepulse.local`) sont toujours en base mais
ne peuvent plus ouvrir de session. Les suppressions de comptes restent un
geste d'administrateur dans la base, pas une fonction produit.

## Ce que le client regarde sans compte

Le propriétaire d'un site surveillé n'a pas de login, et n'en demande pas. Il
reçoit des URL :

| Surface              | Route             | Ce qu'il y lit                                                                                                                              |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Vitrine              | `/`               | le produit, les paliers lus dans `plans`, l'entrée du formulaire de signalement                                                             |
| Analyse publique     | `/status/:slug`   | verdict en une phrase, liste de problèmes triés, uptime 90 jours, calendrier, latence et percentiles, chronologie d'incidents, méthodologie |
| Suivi de signalement | `/support/:token` | son propre énoncé, l'avancement par étapes, la chronologie publique, et l'ajout d'un complément                                             |

Ces trois surfaces sont les seules routes sans session. `GET
/api/public/status/:slug` ne renvoie jamais `401` (`Cache-Control: public,
max-age=30`, rate-limit par IP) ; `POST /api/public/qa/tickets` est plafonné à
10 créations par IP et 15 minutes avec un champ honeypot `website` ; le suivi
n'expose que les événements `public`, le jeton de 16 octets aléatoires faisant
office de secret.

## Deux régimes visuels, un seul mécanisme

`client/src/App.tsx` dérive le thème de la route — pas d'un réglage
utilisateur :

```ts
const isClientRoute = (path: string) =>
  path === "/" || /^\/(status|support)\//.test(path);
```

Les routes clientes rendent en **clair** (`/`, `/status/:slug`,
`/support/:token`) : leur lecteur vérifie « mon site tourne-t-il », il n'est
pas devant un poste de pilotage. `/dashboard`, `/monitors/:id`, `/settings`,
`/qa`, `/console`, `/login` et `/register` rendent en **sombre**, parce que
l'opérateur y passe des heures sur des densités de données.

Le mécanisme tient dans `client/src/index.css` : `:root` porte les jetons
clairs, `.dark` les mêmes noms en valeurs sombres, et `@theme inline` publie
ces jetons comme véritables utilitaires Tailwind (`bg-page`, `bg-surface`,
`bg-surface-2`, `text-ink`, `text-ink-soft`, `text-ink-muted`, `border-line`,
`bg-brand`, `bg-brand-strong`, `text-state-up|down|warn`, …).

**Règle d'écriture.** Un composant monté sur les deux régimes (`Modal`,
`StatusBadge`, `ReportIssueDialog`, les chips de `QaChips`, `Skeleton`,
`ErrorBoundary`) n'a pas le droit d'utiliser une couleur littérale
(`text-slate-300`, `bg-[#0e192c]`, `border-white/10`) : il utilise les
jetons, et le contraste se règle tout seul. Un composant réservé à la console
peut garder ses classes sombres. Les classes `auth-input` restent
spécifiques aux écrans d'authentification sombres ; `.field-input` est la
version jetonnée pour les formulaires clientes.
