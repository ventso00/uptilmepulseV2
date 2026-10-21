# Modèle d'accès et régimes de lecture

UptimePulse est un produit **à opérateur unique**. Cette page est la source de
vérité sur qui peut faire quoi : elle explique le verrou d'authentification,
les surfaces publiques, et le choix d'un régime visuel unique.

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
- `requireUser` (`server/_core/http.ts:62-78`) vérifie l'email de la session
  résolue : un token de session valide mais d'un autre compte répond
  `403 ACCESS_RESERVED` (`server/_core/http.ts:73-76`). Le verrou est serveur —
  masquer des liens côté client n'aurait été qu'une esthétique.
- `POST /api/auth/login` renvoie un `401` indistinguable d'un mauvais mot de
  passe : la route ne révèle pas si une adresse existe ou si elle est
  réservée.

Conséquence pratique : un compte créé avant ce verrou (les adresses de
démonstration utilisées pendant le développement, `demo@uptimepulse.dev` et
`demo@uptimepulse.local`) ne peut plus ouvrir de session, même avec le bon mot
de passe. Le dépôt ne livre **aucun seed** de ce genre de ligne — la base d'une
installation neuve ne contient que les trois paliers de `plans` — donc ces
comptes n'existent que là où ils ont réellement été créés à la main. Les
suppressions de comptes restent un geste d'administrateur dans la base, pas une
fonction produit.

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

## Un seul régime visuel, et pourquoi

Le client rend **en clair** sur l'intégralité des routes, vitrine, analyse
publique et console opérateur alike. `client/src/App.tsx:19-28` le dit dans son
commentaire et le pose dans le code : un unique
`<ThemeProvider defaultTheme="light">` enveloppe le `<Switch>`, et rien ne
dérive le thème du chemin.

Le régime sombre a existé (ADR-017, aujourd'hui **reversé**) : il séparait les
lectures clientes des écrans de pilotage. Il a été supprimé parce que deux
régimes imposaient à chaque composant monté des deux côtés une double
vérification de contraste, et que l'opérateur comme la cliente partagent
finalement les mêmes surfaces. Le mécanisme reste en place mais dormant :

- `client/src/index.css` conserve un bloc `.dark` complet (`:141-194`) sous les
  mêmes noms de jetons que `:root`.
- `client/src/contexts/ThemeContext.tsx` accepte encore `forcedTheme` (`:22`,
  `:39`), `switchable` (`:32-36`, `:49-51`, `:54-58`) et expose `useTheme()`
  (`:69-75`) : **aucun appelant** ne passe ces props et `useTheme()` n'est
  jamais appelé par l'application.
- Conséquence à connaître avant de réactiver le sombre :
  `client/src/components/ui/sonner.tsx:1,5` branche le `Toaster` sur le
  `useTheme()` de **next-themes**, alors que le provider monté est le
  `ThemeContext` local — les toasts resteraient sur la valeur par défaut même
  après un changement de régime.

Le mécanisme des jetons, lui, est inchangé et documenté ci-dessous.

## Jetons et règle d'écriture

Le mécanisme tient dans `client/src/index.css` : `:root` porte les jetons
clairs et `@theme inline` publie ces jetons comme véritables utilitaires Tailwind
(`bg-page`, `bg-surface`, `bg-surface-2`, `text-ink`, `text-ink-soft`,
`text-ink-muted`, `border-line`, `bg-brand`, `bg-brand-strong`,
`text-state-up|down|warn`, …).

**Règle d'écriture.** Un composant ne doit pas s'ancrer sur une couleur
littérale (`text-slate-300`, `bg-[#0e192c]`, `border-white/10`) quand un jeton
existe : la valeur sémantique est ce qui permet de faire bouger tout le produit
en un endroit. Les contrastes mesurés (WCAG 2.1 AA, 4.5:1 pour le texte de
corps) sont la porte de sortie : `--ink-muted` a par exemple été assombri de
`#7a7873` à `#6b6a66` parce qu'il tombait à 4.23:1 sur `--surface`.
