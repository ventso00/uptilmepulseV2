# Visibilité : ce que le dépôt publie pour un moteur de recherche

UptimePulse est une SPA servie par un CDN : le HTML que Google et les robots de
prévisualisation reçoivent est identique pour toutes les URL. Toute la
visibilité du produit se joue donc sur trois objets — le `<head>` figé au build,
les deux fichiers servis à la racine (`robots.txt`, `sitemap.xml`), et ce que le
client réécrit après hydratation. Cette page décrit les trois, avec leurs
limites assumées.

## 1. Le `<head>` partagé : résolu au build, jamais à la main

`frontend/index.html` ne contient **aucun domaine**. Les URL absolues
(`canonical`, `og:url`, `og:image`, les identifiants JSON-LD) y sont écrites
`%SITE_URL%/…` et résolues par le plugin `uptimepulse-seo-tags`
(`vite.config.ts:185`), qui applique `applySeoTags()`
(`frontend/src/lib/seoTags.ts:54`).

L'origine vient, dans cet ordre :

1. `SITE_URL` — déploiement hors plateforme, Docker ou inverse privé ;
2. `VERCEL_PROJECT_PRODUCTION_URL` — fourni par Vercel au build, donc resistant
   à un renommage de domaine ;
3. rien.

Le troisième cas est le plus important : sans origine connue, **la balise est
retirée du fichier livré**, `robots` passe à `noindex,nofollow`, et le build
émet un avertissement. Un domaine codé en dur finit toujours par pointer sur une
adresse qui n'existe plus — le dépôt a publié `uptilmepulsev2.vercel.app` dans
`og:url`, dans `Sitemap:` et dans six `<loc>` pendant que le domaine réel était
`uptimepulse-liard.vercel.app`. Une balise absente est neutre ; une balise fausse
est un signal actif.

Une preview (`VERCEL_ENV=preview`) est `noindex` par construction : elle
reproduirait mot pour mot le contenu de production sous une autre URL.

## 2. `robots.txt` et `sitemap.xml` sont des routes, pas des fichiers

`registerSeoRoutes()` (`backend/seo/routes.ts:25`) répond sur `/robots.txt` et
`/sitemap.xml` avant le repli SPA de `serveStatic` (`backend/_core/index.ts:102`).
Les builders purs sont dans `backend/seo/sitemap.ts` (`:12`, `:37`, `:80`).

Conséquences mesurées, vérifiées sur une instance production locale
(`NODE_ENV=production node dist/index.js`) :

- l'origine est reconstruite depuis la requête, donc le plan du site reste juste
  quel que soit le domaine ;
- `Host` est validé par `HOST_PATTERN` (`backend/seo/routes.ts:14`) : sans
  `/`, `?`, `#` ni `@`, un en-tête façonné ne peut pas glisser un chemin dans un
  `<loc>` ;
- la liste indexable est `PUBLIC_PATHS` (`backend/seo/sitemap.ts:12`) : `/`,
  `/login`, `/register`, plus **les pages de statut réellement en base**
  (`status_pages.slug`, avec `lastmod`). Sans `DATABASE_URL`, le fichier reste
  valide et ne liste que les trois routes fixes — un `sitemap.xml` en 503 est une
  erreur de crawl pour Google ;
- `robots.txt` interdit `/api/`, `/dashboard`, `/settings`, `/monitors/`, `/qa`,
  `/console` et `/support/`. Cette dernière ligne n'est pas cosmétique : l'URL
  porte un jeton d'accès.

Les deux fichiers statiques qui contenaient la version précédente ont été
supprimés ; `vercel.json` réécrit les deux chemins vers la fonction **avant** le
repli `/(?!api/) → /index.html`, sinon le CDN servirait le fichier et non la
route.

## 3. Le par-route, côté client

`useRouteSeo()` (`frontend/src/lib/seo.ts:73`) pose `document.title`,
`description`, `canonical` et `robots` à chaque route ; `resolveRouteSeo()`
(`:33`) est la partie pure, testée sans DOM. Les onze pages l'appellent, avec
`noindex` sur les six surfaces privées et sur un ticket de support.

Ce canal a une limite franche : **Google exécute JavaScript, les robots de
prévisualisation non.** Telegram, Slack, LinkedIn et X lisent le `<head>` du
point 1 et rien d'autre. Un lien partagé vers `/status/ma-page` affiche donc le
titre générique d'UptimePulse, pas le nom de la page. Le corriger demanderait de
servir le HTML des pages de statut depuis la fonction (réécriture ciblée +
injection de balises), ce qui sort du CDN le document le plus partagé — à décider
quand des pages de statut publiques existeront vraiment, pas avant.

Le `noindex` client n'est pas un doublon de `robots.txt` : le `<head>` partagé
déclare `index,follow` pour **toutes** les routes, y compris `/dashboard`. Sans
réécriture côté client, une route privée resterait indexable malgré le robots.txt
(les deux mécanismes se recouvrent, ils ne se remplacent pas).

## 4. Image de partage

`frontend/public/og-cover.png` : 2400 × 1260 (ratio 1,905, rendu à ×2 pour les
écrans denses), 143 459 octets, dimensions déclarées dans
`frontend/index.html:41`. Elle est composée avec les jetons du thème clair
(`--page-bg`, `--ink`, `--brand-glow`, `frontend/src/index.css:76`) et porte la
mention « Aperçu du produit : aucune mesure réelle » — la frise de barres est
décorative, comme sur le landing. Une prévisualisation SVG ne s'affiche nulle
part : c'est ce que publiait `og:image` avant ce correctif.

## 5. Poids de la page d'entrée

Les routes autre que le landing sont en `import()` dynamique
(`frontend/src/App.tsx:14-23`) et le `manualChunks` « charts » a été retiré
(`vite.config.ts:237`) : nommer recharts dans un chunk partagé le ramenait dans
les imports **statiques** du point d'entrée, donc en `modulepreload` sur la page
d'accueil.

Mesuré au build (`pnpm build`, 23 octobre 2026) :

| Morceau               | Brut      | Gzip      | Chargé sur le landing |
| --------------------- | --------- | --------- | --------------------- |
| `index-*.js` (entrée) | 354,12 kB | 108,94 kB | oui                   |
| `forms-*.js` (zod)    | 51,58 kB  | 13,77 kB  | oui                   |
| `react-*.js`          | 16,89 kB  | 6,51 kB   | oui                   |
| `LineChart-*.js`      | 387,27 kB | 106,82 kB | non                   |
| `PublicStatus-*.js`   | 44,01 kB  | 12,61 kB  | non                   |

Avant : 517,41 kB dans l'entrée et trois `modulepreload` dont 397,53 kB de
graphiques sur une page qui n'en affiche aucun. Le point d'entrée a perdu
163 kB, la page d'accueil 400 kB de téléchargement différé.

Le repli de `Suspense` (`frontend/src/App.tsx:29`) occupe tout l'écran pour ne
pas créer de décalage de mise en page quand le module arrive — un `CLS` mesuré
est un critère de classement.

## 6. Données structurées

Le bloc `application/ld+json` de `frontend/index.html` publie un `@graph` de
trois entités : `Organization`, `WebSite`, `SoftwareApplication`. Sa
`featureList` et son `offers` (Free, 0 EUR) décrivent les constantes que le
serveur applique réellement — `FREE_PLAN` et `INCIDENT_RULES`
(`shared/contracts.ts:63`) : 3 moniteurs, intervalle minimal 300 s, incident
après 3 échecs, rétabli après 2 succès. Aucun chiffre d'audience, aucun avis,
aucun note : ce dépôt ne mesure pas ces deux derniers et ne peut pas les
déclarer.

## 7. Ce qui reste dehors, et pourquoi

- **Vérification Search Console** : le dépôt n'a pas de propriété déclarée ; une
  fois le domaine fixé, il faudra la balise ou l'enregistrement DNS fourni par
  Google. Le `<head>` est prêt à la recevoir.
- **HTML par route côté serveur** : voir point 3.
- **Auto-hébergement** : sans `SITE_URL`, un déploiement Docker produit un HTML
  sans `canonical` ni image de partage, et `noindex`. C'est le comportement
  voulu ; le rendre indexable est une ligne de configuration, pas un patch.
- **`sitemap.xml` multimédia ou hreflang** : un seul idioma, aucun média à
  déclarer.

## Sources

- `frontend/index.html:23`, `:41` — canonical et dimensions d'image
- `frontend/src/lib/seoTags.ts:23`, `:54` — résolution et nettoyage du gabarit
- `frontend/src/lib/seo.ts:33`, `:73` — par-route client
- `backend/seo/sitemap.ts:12`, `:37`, `:80` — builders purs
- `backend/seo/routes.ts:14`, `:25` — routes et garde de `Host`
- `backend/_core/index.ts:102` — ordre d'enregistrement avant le repli SPA
- `vite.config.ts:185`, `:237` — plugin et découpage des morceaux
- `frontend/src/App.tsx:14-29` — routes dynamiques et repli
- `shared/contracts.ts:63` — limites réelles du plan gratuit
- Tests : `frontend/src/lib/seoTags.test.ts` (10), `frontend/src/lib/seo.test.ts`
  (5), `backend/seo/sitemap.test.ts` (6), `backend/seo/routes.test.ts` (4)
