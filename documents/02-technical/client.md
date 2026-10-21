# Le client (navigateur)

Page de référence sur `client/` : montage, routage, contrat d'API,
pages, composants, preuves QA, design system, rendu visuel, accessibilité
et build. Sources d'exclusive vérité : le code sous `client/`,
`vite.config.ts` et `patches/wouter@3.7.1.patch`. Chaque affirmation
porte une citation `chemin:fichier:ligne`. Ce qui n'est pas lisible
dans le code est marqué « non vérifié ».

Stack : React 19 + Vite 7 + TypeScript, SPA purement client (aucun
SSR), routage wouter 3 (patché), styles Tailwind CSS v4 en mode
CSS-first, dataviz recharts, notifications sonner, icônes lucide-react,
contrats zod partagés via `@shared/contracts`.

---

## 1. Monture

### 1.1 `client/src/main.tsx` (19 lignes)

- Ligne 1–4 : importe `createRoot`, `App`, `installEvidenceCapture`
  et `./index.css`.
- Ligne 6–11 : commentaire d'histoire — l'ancien point d'entrée
  montait un client tRPC, un React Query et un transformer superjson
  « que aucune page routée n'appelait jamais », expédiant ce payload
  à chaque visiteur pour rien. Ils ont été supprimés ; l'accès aux
  données passe uniquement par `@/lib/api` (REST typé, §2).
- Ligne 12–13 : dure garde — l'absence de `#root` lève une exception.
- Ligne 15–16 : `installEvidenceCapture()` est appelé AVANT le premier
  render, « so a crash during mounting is still captured » (ligne 15).
- Ligne 18 : `createRoot(container).render(<App />)`.

### 1.2 `client/src/App.tsx` (51 lignes)

Arbre monté (ligne 25–48) :

| Niveau | Élément                              | Ligne | Rôle                                 |
| ------ | ------------------------------------ | ----- | ------------------------------------ |
| 1      | `ErrorBoundary`                      | 27    | repli français en cas de crash React |
| 2      | `ThemeProvider defaultTheme="light"` | 28    | régime unique (§7)                   |
| 3      | `TooltipProvider`                    | 29    | primitives tooltip (Radix)           |
| 4      | `Toaster`                            | 30    | notifications sonner (§7, piège 1)   |
| 5      | `Switch`                             | 31–44 | première route correspondante gagne  |

Le commentaire ligne 18–24 pose la règle du produit : un seul régime
visuel ; le bloc `.dark` reste dans la feuille de style et
ThemeProvider le supporte encore, « the route no longer flips it
behind the user's back ».

### 1.3 Les douze routes (`App.tsx:32–43`)

| Ligne | Chemin            | Page            | Notes                                                      |
| ----- | ----------------- | --------------- | ---------------------------------------------------------- |
| 32    | `/`               | `Landing`       | vitrine publique                                           |
| 33    | `/status/:slug`   | `PublicStatus`  | page publique, sans compte                                 |
| 34    | `/support/:token` | `SupportTicket` | ticket client via jeton                                    |
| 35    | `/qa`             | `QaQueue`       | console QA                                                 |
| 36    | `/console`        | `AdminConsole`  | garde de rôle côté client (`AdminConsole.tsx:100–103`)     |
| 37    | `/dashboard`      | `Dashboard`     | 401 → `/login` (`Dashboard.tsx:71–74`)                     |
| 38    | `/login`          | `Login`         |                                                            |
| 39    | `/register`       | `Register`      |                                                            |
| 40    | `/monitors/:id`   | `MonitorDetail` |                                                            |
| 41    | `/settings`       | `Settings`      |                                                            |
| 42    | `/404`            | `NotFound`      | atteignable en navigation directe                          |
| 43    | (sans `path`)     | `NotFound`      | règle de repli : tout chemin non capté par 32–42 tombe ici |

wouter est patché : `Switch` enregistre chaque `path` de `<Route>`
dans `window.__WOUTER_ROUTES__` (dédupliqué) quand `window` existe
(`patches/wouter@3.7.1.patch:9–24`). Aucun lecteur de ce global dans
le dépôt — voir §10.2.

---

## 2. Le contrat de typage bout-en-bout (`client/src/lib/api.ts`)

### 2.1 Mécanique (431 lignes)

- Tous les schémas zod viennent de `@shared/contracts`, importés
  ligne 3–49. Rien n'est redéclaré localement : le client et le
  serveur partagent les mêmes définitions de réponse.
- `request<T>()` : `fetch` avec `credentials: "include"`
  (ligne 122–126) — la session vit dans un cookie httpOnly posé par
  le serveur ; le client ne manipule aucun token.
- Échec réseau → `ApiError` avec code `NETWORK` (ligne 127–135).
- `204` → `schema.parse({})` (ligne 137) : les routes sans corps
  ont quand même un contrat (`{}` typé).
- Réponse non-OK → `recordFailedRequest` (preuve QA) puis
  `UnauthorizedError` si 401, `ApiError` sinon (ligne 143–155).
- Réponse OK mais corps non conforme → `safeParse` échoue :
  `console.error` + `recordFailedRequest(path, status,
"CONTRACT_MISMATCH", durationMs)` + `ApiError` avec
  `contractMismatch: true` (ligne 157–172). Un drift serveur est
  donc BRUYANT et tracé, jamais silencieusement avalé.
- Pourquoi : commentaire ligne 109–113 — avant, un cast `as T` non
  vérifié transformait toute divergence serveur en `undefined`
  silencieux dans l'UI. Le schéma zod est le portique.
- Erreurs : `ApiError` (status, code, contractMismatch) ligne 74–90 ;
  `UnauthorizedError` (401, « Session expirée ») ligne 92–98 ;
  `firstIssue()` fabrique le message « Réponse serveur invalide
  (path) » à partir de la première erreur zod, ligne 100–107.
- Lecture typée : `request<T>()` lui-même (ligne 114–174), appelé
  directement par chaque méthode de l'objet `api`. L'alias exporté
  `apiRequest` qui le doublait n'avait aucun importateur ; il a été
  supprimé. Écritures sans corps de réponse : `apiRequestUntyped` →
  `requestNoContent` (ligne 176–220) — utilisé par pause/resume du
  monitor (`Dashboard.tsx:458–473, 572–579`).
- Helpers présentation : `errorMessage` (ligne 404–408),
  `formatRelativeDate` en français (ligne 410–422),
  `formatDuration` (ligne 424–430).

### 2.2 tRPC : absent, vérifié

Vérifié par grep sur tout `client/src` : `@trpc`, `superjson` et
`QueryClient` n'apparaissent nulle part sauf dans le commentaire
historique `main.tsx:6–11`. Le client n'appelle PAS tRPC : tout passe
par le REST typé de `api.ts`. Les packages `@trpc/server`
(`package.json:23`) et `superjson` (`package.json:42`) restent déclarés
sans consommateur côté client — mais le serveur, lui, les importe :
ce sont des dépendances de service, pas des orphelins à supprimer
(§10.1).

### 2.3 L'objet `api` (ligne 222–402)

| Domaine                  | Méthodes (ligne)                                                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compte                   | `me` 223 ; `login` 224–228 ; `register` 229–233 ; `logout` 234                                                                                                                                                                                     |
| Monitors                 | `dashboard` 235 ; `monitor` 236–237 ; `history` 238–245 (pagination par curseur) ; `incidents` 246–247 ; `runCheck` 248–251                                                                                                                        |
| Alertes & page de statut | `channels` 252 ; `createChannel` 253–261 ; `deleteChannel` 262–265 ; `testChannel` 266–273 ; `statusPage` 274 ; `saveStatusPage` 275–283 ; `deleteStatusPage` 284–287 ; `publicStatus` 290–294 (endpoint non authentifié, commentaire 288–289)     |
| Signalement & support    | `reportIssue` 299–316 (champ piège-mouches `website`) ; `publicTicket` 317–321 ; `publicTicketMessage` 322–327                                                                                                                                     |
| QA                       | `qaOverview` 328 ; `qaTickets` 329–338 (filtres statut/sévérité/retard) ; `qaTicket` 339–340 ; `updateQaTicket` 341–353 ; `addQaTicketEvent` 354–361 ; `qaTicketReply` 362–369 ; `runQaSelfTests` 370–373 ; `runQaDigest` 374–377 ; `qaDigest` 378 |
| Plans & admin            | `plans` 382 ; `myPlan` 383 ; `adminOverview` 384–385 ; `adminPlans` 386 ; `createPlan` 387–391 ; `updatePlan` 392–396 ; `assignUserPlan` 397–401                                                                                                   |

---

## 3. Pages (`client/src/pages/`)

| Page (lignes)             | Route             | Ce qu'elle fait                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Appels API (`fichier:ligne`)                                                                                                                                   |
| ------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Landing.tsx` (675)       | `/`               | Vitrine FR. Lit les VRAIES offres : `api.plans()`, commentaire « cannot advertise a tier the server refuses » ; si l'appel échoue la grille est masquée (91–93). Règles d'incident partagées `INCIDENT_RULES` (28, 213–215) ; métriques 3/2/5 min/90 j dérivées de ces règles (66–71). Monte HeroDeck 273, ProductPreview 279, ClientReadsShowcase 377, HeroCircuit 462, section tarifs 468–588, SiteFooter 672                                                                                        | `api.plans()` 85–93                                                                                                                                            |
| `PublicStatus.tsx` (870)  | `/status/:slug`   | Page publique temps réel. `verdictOf()` ne fait que relire les agrégats du payload, n'affirme jamais une cause (138–177) ; `problemsOf()` traduit les anomalies en langage clair (188–288). Calendrier 90 j `buildCalendar` 58–84 ; StatusMatrix 475–586 ; honnêteté « uptime depuis le… » quand la fenêtre est partielle (588–604) ; incident timeline 834 ; méthodologie 837 ; CTA « Signaler un problème » 750–759 branché sur le dialog avec `statusSlug` 770–775 ; pied de page rétention 848–867 | `api.publicStatus(slug)` 710 ; 404 → état notFound 715 ; rechargement auto 723                                                                                 |
| `SupportTicket.tsx` (401) | `/support/:token` | Suivi public d'un ticket. Rail en 4 paliers STEPS, chacun mappé sur deux statuts réels (33–43, ProgressRail 63) ; message du client affiché verbatim (262–264) ; n'expose que les événements publics (286–329) ; wording d'état fermé (331–336) ; réponse bornée à 4000 caractères (360)                                                                                                                                                                                                               | `api.publicTicket` 130 ; jeton invalide → invalidLink 134–136 ; `api.publicTicketMessage` 154 ; rechargement auto 147                                          |
| `QaQueue.tsx` (515)       | `/qa`             | File d'attente QA. Cartes de totaux (238–272) ; le rechargement auto se met en pause pendant qu'un ticket est ouvert (commentaire 158–160) ; panneau auto-tests (278–364) et digest markdown en `<pre>` (366–411, 406–408) ; liste avec alerte `isOverdue` (468–507) ; détail monté en panneau (230–235)                                                                                                                                                                                               | `api.me` + `api.qaOverview` + `api.qaTickets` (avec filtres) 128–136 ; `api.runQaSelfTests` 287 ; `api.runQaDigest` 371                                        |
| `Dashboard.tsx` (901)     | `/dashboard`      | Console opérateur. Badge de quota issu du plan (219–223) ; rechargement auto 60 s en pause si un modal est ouvert (88) ; strip d'uptime rendu par `.uptime-bar` (610–638) ; menu de ligne (546) ; modal création/édition POST/PUT `/api/monitors` (716–720), champs mots-clés gating par plan (710–714, commentaire 706–708)                                                                                                                                                                           | `api.me` 66 ; `api.dashboard` 68 ; 401 → `/login` 71–74 ; `api.runCheck` 438 ; pause/reprise `apiRequestUntyped` 458–473, 572–579 ; suppression 596–603        |
| `MonitorDetail.tsx` (707) | `/monitors/:id`   | Analyse d'un monitor. `useRoute` 49 ; garde d'id non numérique avec commentaire anti-boucle-404 (64–66) ; pagination par curseur `loadMore` (111–127) ; le graphe exclut les temps `null` — commentaire 163–177 ; LineChart recharts 302–341 ; TLS 656–703 ; incidents 350–393 ; journal des checks 395–473 ; analyse technique (phases + p50/p95) 499–570                                                                                                                                             | `Promise.all` me/monitor/history/incidents 78–83 ; `api.history` (plus) 116 ; rechargement auto 109                                                            |
| `Settings.tsx` (541)      | `/settings`       | Canaux de notification + page de statut. Test de canal anti-double-clic (commentaire 98) ; le toast de sauvegarde ouvre `/status/slug` en action (129–146) ; encart règles d'incident partagé `INCIDENT_RULES` (507–524)                                                                                                                                                                                                                                                                               | me/canaux/statusPage en `Promise.all` 52–56 ; `createChannel` 84 ; `testChannel` 101 ; `deleteChannel` 113 ; `saveStatusPage` 129–146 ; `deleteStatusPage` 158 |
| `AdminConsole.tsx` (653)  | `/console`        | Administration. Garde de rôle côté client, « réservée aux administrateurs » (100–103) ; KPI 168–179 ; distribution des plans 182–204 ; éditeur de plans — slug immuable (commentaire 28–30) ; note « baisser une limite ne supprime rien » (470–473) ; rapport interne en `<pre>`                                                                                                                                                                                                                      | `adminOverview`+`adminPlans` 104–107 ; `updatePlan` 290 ; `createPlan` 303 ; `assignUserPlan` 591                                                              |
| `Login.tsx` (254)         | `/login`          | Connexion. `AuthLayout` exporté (146) est le châssis partagé avec l'inscription                                                                                                                                                                                                                                                                                                                                                                                                                        | `api.login` 27 ; message `UnauthorizedError` 30–31                                                                                                             |
| `Register.tsx` (155)      | `/register`       | Inscription. Copie honnête : un seul compte créateur, plus d'inscriptions après réclamation (35–36) ; réutilise `AuthLayout` (import 5, usage 33)                                                                                                                                                                                                                                                                                                                                                      | `api.register` 23                                                                                                                                              |
| `NotFound.tsx` (36)       | `/404` + repli    | Écran 404. Le bouton dit « Retour au dashboard » mais navigue vers `/` (22–28) — libellé trompeur, aucun appel API                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                              |

---

## 4. Composants (`client/src/components/`)

### 4.1 `components/uptime/` (socle opérateur)

| Composant (lignes)              | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Consummé par (import)                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `AppShell.tsx` (253)            | Cadre des pages opérateur : nav (24–35), entrée admin seulement si le serveur confirme le rôle (30–35, 56), logout `api.logout()` puis navigation dure vers `/login` (58–70), carte de plan via `useMyPlan` — « le compteur ne peut pas dériver » (49–50), jauge `role="progressbar"` (136–153), sidebar hors écran `aria-hidden` + `inert` (52–53, 75–80), `aria-current` (110–111), bouton « Signaler un problème » → ReportIssueDialog (237–250)                                                                                                                                                                                                        | Dashboard 31, MonitorDetail 26, Settings 25, QaQueue 32, AdminConsole 13                            |
| `ReportIssueDialog.tsx` (321)   | Formulaire de signalement. `captureEvidence()` au rendu (40, import 4) ; `api.reportIssue` avec honeypot `website` (49–63, champ caché 264–275) ; succès : référence + lien `/support/${reporterToken}` + copier (64–113) ; texte de divulgation des preuves « Aucune donnée de votre compte n'est envoyée » (277–289)                                                                                                                                                                                                                                                                                                                                     | AppShell 20, PublicStatus 16 (monté 771)                                                            |
| `Modal.tsx` (112)               | Dialog à trap de focus : role, Escape, restauration du focus, `overflow` du body (28–65), `aria-labelledby/describedby` (74–81). Commentaire 7–11 : un simple div monté précédemment « manquait role/trap/Escape/restore »                                                                                                                                                                                                                                                                                                                                                                                                                                 | ConfirmDialog 2, Dashboard 37 (usage 732), ReportIssueDialog 5                                      |
| `ConfirmDialog.tsx` (51)        | Remplace `window.confirm` (commentaire 4–8) ; auto-focus sur le bouton de confirmation (25–27)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Dashboard 39, Settings 27                                                                           |
| `RowMenu.tsx` (120)             | Menu contextuel accessible : `aria-haspopup/expanded`, Escape avec retour de focus, roving ArrowUp/Down (12–16, 39–60, 76–86)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Dashboard 38 (usage 546)                                                                            |
| `PageState.tsx` (62)            | `FullLoader` + `ErrorState` avec bouton réessayer — commentaire 18–22 : corrige le bug du spinner infini                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Dashboard 33, Settings 26, AdminConsole 14, QaQueue 33, MonitorDetail 33                            |
| `StatusBadge.tsx` (60)          | Libellés de statut par token (UP/DOWN/PAUSED/UNKNOWN) + `StatusDot` ; une seule échelle de couleur pour tout le produit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Dashboard 32, PublicStatus 17, MonitorDetail 32                                                     |
| `PeriodSelector.tsx` (42)       | Sélecteur de fenêtre ; expose `periodOptions`. Commentaire 5–9 : 24 h/7 j étaient une capacité morte côté UI qui codait 30 jours en dur                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | MonitorDetail 36–38 (usage 218)                                                                     |
| `Logo.tsx` (46)                 | Wordmark SVG inline, couleurs par tokens ; commentaire 1–10 : l'ancien WebP distant avait un `alt=""` mensonger ; `role="img" aria-label="UptimePulse"` (16–17)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Landing 20, PublicStatus 15, SupportTicket 18, NotFound 3, SiteFooter 11, Login 12 (`LogoWordmark`) |
| `CountUp.tsx` (39)              | Compteur animé ; en `prefers-reduced-motion` la valeur finale s'affiche directement (20–23)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Landing 21                                                                                          |
| `Reveal.tsx` (71)               | Wrapper scroll-reveal : `IntersectionObserver` seuil 0,15 (14–25), visible instantané en reduced-motion — « ne laisse jamais le contenu caché » (10–13, commentaire 41–44)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Landing 25, Dashboard 34, MonitorDetail 31, PublicStatus 18, ClientReadsShowcase 9                  |
| `SiteFooter.tsx` (287)          | Plaque de clôture. `EntryProbe` : `fetch("/api/health")` avec AbortController (59–76) et mention explicite « Sonde /api/health de ce service — pas l'état des sites surveillés par ses clients » (116–119) ; colonnes de liens — commentaire 13–18 : « rien ici ne pointe vers une page qui n'existe pas » (26–55) ; wordmark géant `.hollow-ink` décoratif `aria-hidden` (151–163) ; « Aucun traceur ni cookie de mesure d'audience » (253) ; bouton « Haut de page » qui respecte reduced-motion (255–273) ; promesse finale : « Chaque chiffre affiché… vient d'un check enregistré ou d'une règle du contrat ; aucune preuve n'est simulée » (275–282) | Landing 26                                                                                          |
| `HeroDeck.tsx` (286)            | Éventail 3D de 4 cartes (`deck-*`, 244–261). CHIFFRES DE DÉMONSTRATION (18–24 ; commentaire 12–17 : « les numéros sont des échantillons et la carte le dit ») ; règles d'incident RÉELLES via `INCIDENT_RULES` (165–167) ; puce visible « valeurs de démonstration » (238–240) ; lift au hover/focus/tap utilisable au clavier (210–214, 247–258)                                                                                                                                                                                                                                                                                                          | Landing 24                                                                                          |
| `ProductPreview.tsx` (356)      | Aperçu interactif. Checks de DÉMONSTRATION (9–14 ; commentaire 5–8) ; `verdict()` reproduit exactement la logique serveur `decideIncidentTransition` (31–34) ; `role="group" aria-label="Aperçu interactif du produit, valeurs de démonstration"` (147) + libellé visible (154) ; tilt désactivé en reduced-motion (125)                                                                                                                                                                                                                                                                                                                                   | Landing 22                                                                                          |
| `ClientReadsShowcase.tsx` (485) | Démonstration « ce que lit un client ». Lectures DÉMO (18–89 ; commentaire 13–17 : le verdict est écrit « dans la forme exacte que verdictOf() produit ») ; défilement auto DWELL 7000 ms, pause au hover/focus ; puce « valeurs de démonstration » (463–465) + légende « Les chiffres ci-dessus sont des valeurs de démonstration » (475–479) ; listener reduced-motion y compris changement à chaud (311–337) ; barre de progression `rail-progress` (432–435) ; la sévérité passe par pastille+teinte, pas par du petit texte coloré (39–42)                                                                                                            | Landing 27                                                                                          |
| `HeroCircuit.tsx` (205)         | Schéma SVG « sondes → hub → alerte » ; `role="img"` + aria-label décrivant la chaîne de mesure (124–127) ; tracé animé sauté en reduced-motion (95) ; fils en classes `circuit-line wire` (158) ; commentaire géométrie non-scaling-stroke (3–15, 99–116)                                                                                                                                                                                                                                                                                                                                                                                                  | Landing 23                                                                                          |

Règle projet appliquée : rien de faux ne doit passer pour une mesure
réelle. Les trois composants vitrines à valeurs de démonstration
(HeroDeck, ProductPreview, ClientReadsShowcase) portent chacun une
étiquette visible « valeurs de démonstration » (citées ci-dessus) ;
tout le reste des chiffres affichés vient de l'API (`Landing.tsx:85–93`
pour les plans, `SiteFooter.tsx:275–282` pour la promesse).

### 4.2 `components/uptime/qa/` et `components/uptime/status/`

| Composant (lignes)                 | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Consummé par                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `qa/QaTicketDetail.tsx` (608)      | Panneau de gestion d'un ticket. Chaque mutation recharge le détail — commentaire de classe 105–109 : statut 394, sévérité 420, nature 445, réponse rédacteur (brouillon) 498, événement publié au client 523, note interne 583 ; bandeau `isOverdue` (213–222) ; section preuves : route, viewport, locale, UA, erreurs JS, requêtes échouées (273–340) ; lien de suivi client (465–482) ; mention « Le produit n'envoie pas d'e-mails » (540–543) ; rapport interne en `<pre>` (599–603) | QaQueue 36 (monté 230–235) ; imports QaChips 37 |
| `qa/QaChips.tsx` (97)              | Vocabulaire couleur partagé file/detail/page du déclarant (commentaire 10–20) ; tables styles sévérité/statut 21–37 ; bordure pointillée pour `waiting_client` — justifiée 32–34 ; `idleLabel` 73–79 ; `isOverdue` calculé sur `QA_OPEN_STATUSES` + `QA_OVERDUE_AFTER_MINUTES` (81–87) ; dates en `fr-FR` (89–97)                                                                                                                                                                         | QaQueue 43, QaTicketDetail 37, SupportTicket 31 |
| `status/StatusAnalytics.tsx` (855) | Bibliothèque d'analyse de la page publique, montée uniquement par `PublicStatus` (import 21–39). Formatters `fr-FR` Intl (24–34, 54–79) ; formatage durée sans unité à traduire (commentaire 62) ; `CHART` : couleurs SVG en dur, commentaire 40–44 — recharts peint des attributs SVG et ne lit pas les utilitaires Tailwind (palette BLEUE résiduelle, §7.3). Voir §4.2.1                                                                                                               | PublicStatus 21–39                              |

#### 4.2.1 Exports de `StatusAnalytics.tsx`

| Export                | Lignes  | Ce qu'il garantit                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AvailabilityWindows` | 145–203 | barres 24h/7j/30j/90j sur échelle 0–100 avec repère d'objectif (commentaire 140–144) ; `role="img"` + aria-label par barre (176–177) ; « aucun check » affiché tel quel (168–170)                                                                                                                                                    |
| `LatencyChart`        | 206–296 | < 2 heures de données → texte explicite, pas de courbe inventée (216–230) ; SVG `aria-hidden` (238) + valeurs en `sr-only` (286–293) ; les heures sans check gardent le vrai trou (commentaire 205)                                                                                                                                  |
| `LatencyDistribution` | 302–349 | percentiles exacts sur l'échantillon ; sous 10 checks la carte le DIT au lieu de cacher (commentaire 300–301, note 323–325) ; tendance ±2 % = « stable » (305–318)                                                                                                                                                                   |
| `PhaseBreakdown`      | 362–425 | DNS/TCP/TLS/Serveur (351–356) — les quatre phases mesurées composent le TTFB (commentaire 358–361) ; « pas encore de phases mesurées » assumé (370–383)                                                                                                                                                                              |
| `FailureCauses`       | 434–478 | labels repris de `checkClassificationLabels` (`@shared/contracts`, 431–432) — « une nouvelle classification ne peut pas manquer ici et exister là » (commentaire 427–430) ; rappelle la règle des 3 échecs consécutifs (443)                                                                                                         |
| `IncidentStats`       | 480–510 | MTTR/downtime/plus long, 0 incident = texte vert (492)                                                                                                                                                                                                                                                                               |
| `CertificateCard`     | 512–566 | absence de certificat expliquée, pas masquée (515–527) ; seuils 14/30 jours (528–530)                                                                                                                                                                                                                                                |
| `CoverageCard`        | 568–626 | cadence + timeout + « prochain check » ou « suspendu » (603–609) ; budget d'erreur calculé sur les checks réels (612–623) ; commentaire titre « pas une promesse marketing » (574)                                                                                                                                                   |
| `HourlyStrip`         | 629–660 | 24 cellules horaires, `role="img"` + aria-label (632–635) ; heure sans données ≠ heure verte (639–645)                                                                                                                                                                                                                               |
| `SummaryStrip`        | 662–717 | agrégats du payload, pause et incidents en cours explicités (664–698)                                                                                                                                                                                                                                                                |
| `IncidentTimeline`    | 723–800 | incidents ouverts triés en premier — « les seules lignes qui demandent encore un opérateur » (commentaire 719–722, 724–729) ; durées réelles + dates de confirmation/rétablissement (777–787)                                                                                                                                        |
| `MethodologyPanel`    | 806–854 | « une page publique est une affirmation, donc elle publie sa méthode » (commentaire 802–805) : seuils de confirmation (814–820), SSRF-refusés et mesure par phases (821–827), fenêtres et bornes d'échantillon (828–834), rétention + « gris ≠ panne » (835–840), 99,9 % « repère, pas contrat » (841–845), fraîcheur 30 s (846–850) |

### 4.3 `components/ui/` (3 fichiers seulement)

| Fichier               | Rôle                                                                                                                                                           | Consommateur                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `ui/sonner.tsx` (23)  | `<Toaster />` sonner stylé avec les tokens `--popover` (11–17). ATTENTION : ligne 1, `useTheme` importé de `next-themes` et non du provider monté (piège §7.3) | App.tsx 1 (monté 30)                                                          |
| `ui/tooltip.tsx` (59) | Primitives Radix Tooltip (`@radix-ui/react-tooltip`, ligne 2) + `cn`                                                                                           | App.tsx 2 (monté 29)                                                          |
| `ui/skeleton.tsx` (8) | `animate-pulse` + `motion-reduce:animate-none`, `aria-hidden`                                                                                                  | Dashboard 35, MonitorDetail 34, PublicStatus 19, QaQueue 34, SupportTicket 19 |

`components/ErrorBoundary.tsx` (84) est à la racine : `componentDidCatch`
enregistre `recordJavaScriptError("name: message", "ErrorBoundary")`
(27–30) et journalise un JSON console (31–37) ; le fallback français
offre recharger/home sans empiler la stack brute du serveur à
l'utilisateur (commentaire 13–19). Monté par `App.tsx:27`.

---

## 5. Preuves et contexte QA côté client (`client/src/lib/qaContext.ts`)

Fonctionnement de ces 121 lignes :

- Principe (commentaire 3–13) : tout est en mémoire, RIEN n'est
  persisté ; le buffer est un contexte d'exécution, pas un journal.
- Deux tampons circulaires bornés à 10 entrées (15–16, 26–29),
  texte écrêté à 300 caractères (21–23), code d'erreur à 60
  (43–57). Borné = pas de fuite mémoire sur une session longue.
- Producteurs : `recordJavaScriptError` (31–41) appelé par
  ErrorBoundary (`ErrorBoundary.tsx:27–30`) et par le listener
  `window "error"` (104–109, avec `filename:lineno`) ;
  `recordFailedRequest` (43–57) appelé par `api.ts` sur chaque
  réponse échouée (143–155) et sur `CONTRACT_MISMATCH` (157–172) ;
  listener `unhandledrejection` (111–120).
- `installEvidenceCapture()` (100) est idempotent (garde `installed`,
  ~98–102) ; appelé avant le premier render (`main.tsx:15–16`).
- `captureEvidence()` (68) : la route stockée est
  `location.pathname` SEULEMENT — commentaire 65–66 : la query
  string est retirée « because session or invite tokens can live
  there ». Un jeton d'invitation `/support/:token?...` ou une query
  de session ne partira donc jamais dans une preuve. Contexte : UA,
  locale, viewport avec replis si l'un manque (77–88) ; copies
  défensives des tableaux (89–90) pour que le buffer continue de
  tourner après la capture.
- Sensible : commentaire 12 — rien de sensible n'est stocké,
  « no token, no password, no response body ».
- Consommateurs : `ReportIssueDialog.tsx:40` (capture au rendu,
  envoyée via `api.reportIssue`, `api.ts:299–316`) ; affichage à
  l'équipe dans `QaTicketDetail.tsx:273–340`. Le dialogue explique
  au déclarant ce qui est attaché (277–289).
- `clearEvidence()` (59) : uniquement appelé par les tests
  (`qaContext.test.ts:24` et suivants) — voir §10.2.

---

## 6. Système de design

### 6.1 Tailwind v4, CSS-first

- `@import "tailwindcss"` et `@import "tw-animate-css"`
  (`index.css:1–2`) : pas de `tailwindcss-animate`, le plugin
  d'animations v3 est remplacé par la feuille `tw-animate-css`
  (§10.1).
- `@theme inline` (4–63) déclare directement dans le CSS les tokens
  devenus utilitaires : polices (5–9), rayons (10–13), couleurs
  sémantiques `--color-page…--color-state-warn` (33–56), ombres
  (57–62), et les aliases shadcn (14–32).
- Vérifié par listing du dépôt : AUCUN `tailwindcss.config.*` ni
  `postcss.config.*` à la racine — Tailwind v4 lit le CSS, la
  configuration JS est morte. Le plugin Vite est branché dans
  `vite.config.ts` (liste `plugins`, 174–179).

### 6.2 Polices (chargées depuis Google Fonts)

| Token CSS        | Famille                       | Poids demandés | Citation                             |
| ---------------- | ----------------------------- | -------------- | ------------------------------------ |
| `--font-sans`    | DM Sans                       | 400/500/700    | `index.css:5–6` ; `index.html:13–18` |
| `--font-display` | Space Grotesk (repli DM Sans) | 500/600/700    | `index.css:7–8` ; `index.html:13–18` |
| `--font-mono`    | JetBrains Mono                | 400/500/600    | `index.css:9` ; `index.html:13–18`   |

Préconnexion + feuille Google Fonts (`index.html:13–18`) : les
polices sont distantes, pas auto-hébergées — c'est le seul réseau
au premier rendu hors API.

### 6.3 Tokens de la lumière (bloc `:root`, `index.css:69–139`)

| Token                                          | Valeur actuelle                   | Ligne   | Note                                                                                                                                 |
| ---------------------------------------------- | --------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--page-bg`                                    | `#f4f3ee`                         | 76      | crème, base de tous les contrastes mesurés                                                                                           |
| `--surface`                                    | `#fbfaf7`                         | 77      | cartes                                                                                                                               |
| `--surface-2`                                  | `#edece5`                         | 78      | creux, fonds de barres                                                                                                               |
| `--surface-3`                                  | `#e4e2d9`                         | 79      |                                                                                                                                      |
| `--ink`                                        | `#141414`                         | 81      | encre ; ~16:1 sur crème (commentaire 71–75)                                                                                          |
| `--ink-soft`                                   | `#4b4b4b`                         | 82      |                                                                                                                                      |
| `--ink-muted`                                  | `#6b6a66`                         | 86      | valeur MESURÉE — commentaire 83–85 : `#7a7873` tombait à 3.97:1 ; `#6b6a66` tient 4.87:1 sur `--page-bg` et 4.58:1 sur `--surface-2` |
| `--line` / `--line-strong`                     | `#e3e1d8` / `#cfccc1`             | 88–89   |                                                                                                                                      |
| `--brand` / `--brand-strong`                   | `#141414` / `#000000`             | 91–92   | actions primaires = noir, pas de couleur                                                                                             |
| `--brand-glow`                                 | `#e8503a`                         | 93      | le seul accent, vermillon                                                                                                            |
| `--brand-subtle`                               | `#e8503a1a`                       | 94      | vermillon à 10 %                                                                                                                     |
| `--brand-muted`                                | `#f6ebe7`                         | 95      |                                                                                                                                      |
| `--accent-blue` / `--accent-violet`            | `#e8503a` / `#e8503a`             | 97–98   | noms hérités, valeurs RE-CALÉES sur le vermillon (monnaie unique)                                                                    |
| `--accent-emerald`                             | `#10b981`                         | 99      |                                                                                                                                      |
| `--state-up` / `--state-down` / `--state-warn` | `#047857` / `#e8503a` / `#b45309` | 101–103 | verts/rouges assombris pour l'AA                                                                                                     |
| `--logo-tile` / `--logo-mark`                  | `#141414` / `#e8503a`             | 105–106 |                                                                                                                                      |
| `--shadow-*`                                   | 6 ombres superposées              | 107–119 | mappées en utilitaires (57–62)                                                                                                       |
| `--radius`                                     | `0.75rem`                         | 121     |                                                                                                                                      |
| bloc shadcn (`--background`…`--ring`)          | valeurs lumière équivalentes      | 122–138 | consommé par sonner/tooltip (`ui/sonner.tsx:11–17`)                                                                                  |

Dette visible : `--muted-foreground` (131) vaut encore `#7a7873`,
exactement la valeur que le commentaire de `--ink-muted` (83–85)
rejette pour cause de 3.97:1. Le token shadcn n'a pas suivi la
refonte du token sémantique.

### 6.4 Utilitaires maison (`index.css`)

| Classe                                            | Effet                                                                                            | Lignes                               | Consommateurs TSX                                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.field-input`                                    | style des champs (fond surface, focus ring)                                                      | 253–277                              | SupportTicket 360 ; ReportIssueDialog (10 champs)                                                                                                                                                                          |
| `.auth-input`                                     | input sombre-sur-craie des consoles (voir §7.3)                                                  | 280–308 (+ variante `.dark` 311–330) | Login 52, 64 ; Register 50, 67, 101 ; ET bien au-delà : Dashboard 755, 780, 814, 837, 851 ; Settings 309, 332, 448, 468, 481 ; QaQueue 429, 448 ; AdminConsole 513, 543, 623, 639 ; QaTicketDetail 427, 452, 477, 515, 554 |
| `.shadow-soft/medium/strong/glow…`                | ombres utilitaires                                                                               | 335–352                              | large                                                                                                                                                                                                                      |
| `.dotmatrix`                                      | texture pointillée + repli `@supports`                                                           | 359–376                              | Landing 299                                                                                                                                                                                                                |
| `.hollow-ink`                                     | texte vide au contour (wordmarks)                                                                | 380–389                              | Landing 198 ; SiteFooter 156 ; ClientReadsShowcase 366                                                                                                                                                                     |
| `.deck-scene/.deck-card/.deck-float/.shadow-deck` | éventail 3D en variables CSS ; éventails en media query 48rem (commentaire « fan-in-CSS-props ») | 398–444                              | HeroDeck 244, 258, 261                                                                                                                                                                                                     |
| `.grid-paper`                                     | fond quadrillé                                                                                   | 447–470                              | Landing 157, 637 ; Login 176, 189                                                                                                                                                                                          |
| `.halftone`                                       | trame                                                                                            | 473–482                              | Landing 386 ; ClientReadsShowcase 348 ; Login 193                                                                                                                                                                          |
| `.circuit-line` + `.wire`                         | fils du hero ; animation `wire-draw` pilotée en JS avec repli reduced-motion                     | 485–501                              | HeroCircuit 95–116, 158                                                                                                                                                                                                    |
| `.live-ping`                                      | halo pulsé « en direct »                                                                         | 506–519                              | HeroCircuit 179 ; SiteFooter 105 ; PublicStatus 346, 744 ; ProductPreview 196 ; ClientReadsShowcase 122 ; SupportTicket 179 ; Login 224                                                                                    |
| `.animate-rise`                                   | entrée « au-dessus du fold », délai inline                                                       | 525–537                              | Landing 183, 205, 223, 233, 255 ; ProductPreview 187 ; PublicStatus 448 ; SupportTicket 220, 252, 287, 332, 339 ; ClientReadsShowcase 119, 162, 173, 206                                                                   |
| `.dash-flow`                                      | connecteur pointillé animé des 3 étapes                                                          | 540–548                              | Landing 347                                                                                                                                                                                                                |
| `.rail-progress`                                  | barre de temps de défilement (durée mise en inline par la JS)                                    | 552–563                              | ClientReadsShowcase 432                                                                                                                                                                                                    |
| `.animate-sheen`                                  | balayage de brillance                                                                            | 565–576                              | PublicStatus 337 ; SupportTicket 225 ; ClientReadsShowcase 470                                                                                                                                                             |
| `.ecg-line`                                       | tracé cœur-de-mémoire dessiné                                                                    | 581–590                              | ClientReadsShowcase 149                                                                                                                                                                                                    |
| `.uptime-bar`                                     | croissance verticale des barres d'uptime                                                         | 595–608                              | Dashboard 629 ; ClientReadsShowcase 218                                                                                                                                                                                    |
| `.analysis-segment`                               | segments extensibles horizontaux                                                                 | 610–624                              | HeroDeck 114 ; ProductPreview 245 ; ClientReadsShowcase 258 ; MonitorDetail 624                                                                                                                                            |
| `.spotlight`                                      | halo radial suivant le pointeur (`color-mix in oklab`)                                           | 629–647                              | ProductPreview 148 ; ClientReadsShowcase 452                                                                                                                                                                               |
| `.tilt-frame`                                     | inclinaison perspective pilotée par `--tilt-x/y`                                                 | 649–654                              | ProductPreview 148 ; ClientReadsShowcase 452                                                                                                                                                                               |

Une deuxième famille de classes — `.reveal`, `.parallax-*`, `.glass`,
`.gradient-border`, `.magnetic`, `.animate-count-up`,
`.animate-float-ambient`, `.animate-mesh`, `.page-transition-*`,
`.ecg-sweep` — n'avait AUCUN consommateur dans le TSX : elle a été
supprimée (284 lignes, §10.2). Le tableau ci-dessus est l'inventaire
restant, re-mesuré ligne à ligne dans le `index.css` de 675 lignes.

---

## 7. Rendu visuel : un seul régime

### 7.1 L'état des choses

Le produit entier s'affiche en lumière chaude. Décision documentée
dans le code : commentaire `App.tsx:18–24` (« One visual regime for
the whole product… the route no longer flips it behind the user's
back ») et montage `ThemeProvider defaultTheme="light"` seul
(`App.tsx:28`). ADR-018 « régime unique » consigné dans
`docs/04-project/decisions.md:125`.

### 7.2 La plomberie sombre est DORMANTE

Dans `contexts/ThemeContext.tsx` (75 lignes) :

| Élément                                        | Ligne  | Pourquoi inerte                                                                                              |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| prop `forcedTheme` (régime dérivé de la route) | 22, 39 | App ne la passe pas (`App.tsx:28`)                                                                           |
| prop `switchable`                              | 16, 28 | défaut `false`, jamais activé                                                                                |
| lecture localStorage                           | 31–37  | seulement `if (switchable)`                                                                                  |
| ajout/retrait de `.dark` sur `documentElement` | 41–52  | `activeTheme` ne vaut jamais `"dark"`                                                                        |
| `toggleTheme`                                  | 54–58  | `undefined` sans `switchable`                                                                                |
| hook `useTheme`                                | 69–75  | zéro appelant dans `client/src` (grep ; l'import de `ui/sonner.tsx:1` vient d'un AUTRE module, voir piège 1) |

Le bloc `.dark { … }` (`index.css:141–195`, palette bleu-nuit :
`--page-bg: #0b1220`, `--brand: #60a5fa`…) est donc du CSS mort tant
que personne ne réarme le provider. Les commentaires d'introduction
`index.css:33–36` et `65–68` (« Dark mode becomes a conscious opt-in
via .dark on the operator routes (dashboard, console, settings, QA) »)
sont OBSOLÈTES : aucun code n'ajoute jamais la classe `.dark`.

### 7.3 Pièges de réactivation (vérifiés)

1. **Toasts** : `ui/sonner.tsx:1` importe `useTheme` de
   `next-themes` — un provider JAMAIS monté par `App.tsx` — et non
   celui de `contexts/ThemeContext`. `theme` reste `undefined` et
   retombe sur `"system"` (`ui/sonner.tsx:5`). Si un régime sombre
   revenait via le provider local, les toasts suivraient le thème du
   SYSTÈME, pas l'app.
2. **`.auth-input` est un mensonge de nommage** : le style est utilisé
   bien au-delà des écrans d'auth — Dashboard 755/780/814/837/851,
   Settings 309/332/448/468/481, QaQueue 429/448, AdminConsole
   513/543/623/639, QaTicketDetail 427/452/477/515/554 (grep). Sa
   variante `.dark .auth-input` (`index.css:311–330`) montre que le
   style a été conçu pour les deux régimes, mais toute réactivation
   sombre doit auditer TOUTES les consoles, pas seulement login/register.
3. **Résidus de l'ère bleu-nuit** (couleurs en dur qui casseraient
   n'importe quel thème) : `AdminConsole.tsx:393` (`bg-[#0e192c]`),
   375 et 592 (boutons `cyan-300`), 399–410 et 644 (textes slate),
   600 (`<pre>` `bg-[#0b1220]`) ; `status/StatusAnalytics.tsx:45–52`
   (palette de graphe bleue `#dbe7f2/#5c7c96/#0e7490`) et 351–356
   (segments `cyan/sky/indigo/emerald` Tailwind). Par contraste le
   graphe de `MonitorDetail.tsx:302–341` a bien été re-calé sur la
   palette chaude (`#7a7873/#fbfaf7/#e3e1d8/#e8503a`).

---

## 8. Accessibilité, état réel

### 8.1 Comment c'est vérifié

- Contrastes MESURÉS sur pixels réels, pas sur les valeurs de
  variables. Raison technique : Tailwind v4 compile les opacity
  modifiers en `color-mix(in oklab, …)` — visible dans le CSS lui-même
  (`index.css:247`, 276, 306, 451, 456, 476, 637) ; une regex `rgba(`
  sur le CSS généré ne voit RIEN de ces mélanges et donnerait de
  faux « OK ». La méthode est consignée dans la doc projet :
  « audit de contraste AA mesuré sur pixels réels »
  (`docs/04-project/decisions.md:119`, contexte 101 et 125) et
  `docs/02-technical/access-model.md:68, 96` (WCAG 2.1 AA 4.5:1).
- Les chiffres obtenus sont gravés dans le CSS :
  `#7a7873 → 3.97:1` (rejeté) et `#6b6a66 → 4.87:1 sur --page-bg /
4.58:1 sur --surface-2` (`index.css:83–85`).

### 8.2 Ce qui est en place

| Point                                 | Preuve                                                             | Citation                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lang="fr"`                           | html                                                               | `index.html:2`                                                                                                                                                                                            |
| Zoom non bloqué (WCAG 1.4.4)          | `maximum-scale` retiré, commentaire explicite                      | `index.html:5–7`                                                                                                                                                                                          |
| Cibles tactiles ≥ 44 px               | `min-h-12` (48 px) et `h-11`/`min-h-11` (44 px)                    | Landing 238, 247 ; Login 90 ; Register 116 ; ProductPreview 169 ; ClientReadsShowcase 397 ; SiteFooter 139, 267                                                                                           |
| `prefers-reduced-motion`              | bloc global tue transitions/animations + neutralise tilt/spotlight | `index.css:659–674` ; garde locale `wire-draw` `index.css:495–501`                                                                                                                                        |
| reduced-motion en JS                  | valeur finale directe ; écoute du changement À CHAUD               | `CountUp.tsx:20–23` ; `Reveal.tsx:10–13` ; `HeroCircuit.tsx:95` ; `ProductPreview.tsx:125` ; `ClientReadsShowcase.tsx:311–337` ; `SiteFooter.tsx:258–265` ; `skeleton.tsx` (`motion-reduce:animate-none`) |
| Focus visible                         | outline 2px `--ring`, offset 3px                                   | `index.css:240–245`                                                                                                                                                                                       |
| Trap de focus + Escape + restauration | Modal                                                              | `Modal.tsx:4–5, 28–65`                                                                                                                                                                                    |
| Menu accessible                       | `aria-haspopup/expanded`, Escape rend le focus, flèches roving     | `RowMenu.tsx:12–16, 39–60, 76–86`                                                                                                                                                                         |
| Graphes nommés                        | `role="img"` + aria-label, ou `aria-hidden` + lecture `sr-only`    | `HeroCircuit.tsx:124–127` ; `MonitorDetail.tsx:294–300` ; `StatusAnalytics.tsx:176–177, 393–396, 632–635, 238+286–293`                                                                                    |
| Ancres pas collées au bord            | `scroll-padding-top: 5rem` (SC 2.4.11)                             | `index.css:200–205`                                                                                                                                                                                       |
| Sidebar hors écran vraiment cachée    | `aria-hidden` + `inert`                                            | `AppShell.tsx:52–53, 75–80`                                                                                                                                                                               |
| Page courante marquée                 | `aria-current`                                                     | `AppShell.tsx:110–111`                                                                                                                                                                                    |
| Signalétique au clavier des démos     | lift focus-visible, pause au focus                                 | `HeroDeck.tsx:210–214, 247–258` ; `ClientReadsShowcase.tsx:311–337`                                                                                                                                       |
| JS désactivée                         | bandeau noscript français                                          | `index.html:25–27`                                                                                                                                                                                        |

### 8.3 Ce qui MANQUE (vérifié, pas deviné)

- Pas de lien d'évitement (« skip to content ») : grep
  `skip|évitement` sur `client/src` → zéro résultat. Le clavier
  repasse donc par la nav complète d'AppShell à chaque page.
- Titre de document changeant par route : non vérifié (aucun code
  `document.title` trouvé dans `client/src`).
- L'audit de contraste documenté (§8.1) couvre les surfaces ; une
  vérification systématique des états `:hover/:focus` sombres sur
  résidus d'ADMIN (slate/cyan, §7.3) n'est pas consignée :
  non vérifié.

---

## 9. Build du client (`vite.config.ts`, 224 lignes)

- `root: client` (ligne 190) ; sortie `dist/public` (ligne 193) ;
  sourcemaps désactivés en production (ligne 195).
- Aucun SSR : la config ne contient que `build` + `server` ;
  `main.tsx` est un entrée navigateur pure (pas de handler server).
- Alias `@` → `client/src` et `@shared` → `shared`
  (lignes 183–188).
- `manualChunks` (lignes 196–206) : `{react, react-dom, wouter}` →
  chunk `react`, `recharts` → `charts`, `zod` → `forms` ; le
  commentaire 196–201 explique l'invalidation de cache : les chunks
  mutualisés changent rarement, un déploiement de page ne doit pas
  casser le cache du framework.
- Plugin `manus-public-platform-config` (lignes 155–171) : sert
  `/api/platform/config.js` au vol en dev avec `Cache-Control:
no-store` (157–163) et l'ÉMET comme asset au build
  (`generateBundle`, 164–170) — le `<script defer>` de
  `index.html:28` le charge avant `main.tsx`. Commentaire 151–153 :
  liste blanche de variables, aucun secret. La fabrication du contenu
  vient de `server/_core/publicConfig` (import, ligne 6).
- Plugin `manus-debug-collector` (lignes 78–149) : en dev,
  `transformIndexHtml` injecte `/__manus__/debug-collector.js`
  (80–96) et un middleware POST `/__manus__/logs` accumule les logs
  dans `.manus-logs` (98–147), fichier plafonné à 1 Mo puis réduit à
  60 % (13–16, 26–68). SUPPRIMÉ en production : l'injection est
  gardée par `process.env.NODE_ENV !== "production"` (80–96).
- Serveur dev : `host`/`allowedHosts` explicites et
  `server.fs.deny: ["**/.*"]` (208–223) — les dotfiles (dont `.env`)
  ne sont jamais servis.
- Scripts racine : `build` = `vite build && esbuild server…` (le
  client se construit d'abord), `test` = `vitest run`.

---

## 10. Ce qui est dormant ou mort côté client

### 10.1 Dépendances sans consommateur client

Seize paquets ont été passés au grep sur `client/src`, `server/` et
`shared/` (plus l'absence de tout fichier de config Tailwind/PostCSS).

**Supprimés** (`package.json` et `pnpm-lock.yaml`, 539 lignes de lockfile
en moins) — aucun import, aucune référence de config, aucun usage
runtime :

| Paquet                                                                                   | Verdict de la vérification                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `autoprefixer`, `postcss`                                                                | aucun — Tailwind v4 préfixe seul, et aucun `postcss.config.*` dans le dépôt                                                                            |
| `@tailwindcss/typography`                                                                | aucun — zéro classe `prose` dans `client/src`                                                                                                          |
| `tailwindcss-animate`                                                                    | aucun — remplacé par `tw-animate-css`, importé ligne 2 de `index.css`                                                                                  |
| `class-variance-authority`                                                               | aucun — zéro appel `cva(`                                                                                                                              |
| `@radix-ui/react-dialog`, `-label`, `-select`, `-separator`, `-slot`, `-switch`, `-tabs` | aucun — seul `react-tooltip` (`package.json:22`) est importé (`ui/tooltip.tsx:2`) ; les dialogues sont faits main (`Modal.tsx:7–11`, commentaire §4.1) |

**Gardés alors qu'ils sont inertes côté client** — la colonne
« consommateur » ci-dessous est la raison pour laquelle ils ne doivent
PAS être supprimés lors d'un prochain ménage :

| Paquet         | Ligne (`package.json`) | Utilisateur réel                                                                                                             |
| -------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@trpc/server` | 23                     | serveur : `server/_core/trpc.ts:2`, `context.ts:1`, `index.ts:4`, et `TRPCError` dans `heartbeat.ts:1` / `notification.ts:1` |
| `superjson`    | 42                     | serveur : `server/_core/trpc.ts:3` (transformer tRPC)                                                                        |
| `axios`        | 25                     | serveur : `server/_core/sdk.ts:8,37,84` — le client, lui, n'utilise que `fetch` (`api.ts:122–126`)                           |
| `next-themes`  | 37                     | client : un seul import, `ui/sonner.tsx:1`, vers un provider non monté (§7.3)                                                |

`@trpc/server`, `superjson` et `axios` sont donc des dépendances de
service, pas des orphelins : le client ne les importe pas (§2.2), mais
`dist/index.js` sì.

Corroboré par `docs/01-product/cahier-des-charges.md:325` : « Quatre
dépendances déclarées et non référencées : tailwindcss-animate,
autoprefixer, postcss, @tailwindcss/typography » — depuis vérifiées et
retirées.

### 10.2 Code client sans consommateur

Deux états, séparés parce que l'un a été nettoyé et l'autre non.

**Supprimé** — chaque suppression a d'abord été vérifiée par grep sur le
dépôt entier (zéro importateur, ou zéro `className` pour le CSS) :

- `client/src/hooks/useScrollReveal.ts` et ses 4 hooks `useScrollReveal`
  (10), `useStaggeredReveal` (57), `useParallax` (120), `useMagnetic`
  (147) — l'équivalent vivant est `components/uptime/Reveal.tsx`.
- 284 lignes de CSS orphelin (`index.css` ramené de 959 à 675 lignes) :
  système `.reveal` + keyframes + `.reveal-d-0…7` (ancien 535–658),
  `.parallax-*` (663–674), `.animate-float-ambient` (689–691),
  `.animate-mesh` (709–711), `.glass` (355–364), `.gradient-border`
  (367–384), `.animate-count-up` (860–862) — le compteur réel est JS
  (`CountUp.tsx`) —, `.magnetic` (897–899), `.page-transition-in/out`
  (924–929), `.ecg-sweep` (809–811). Les numéros entre parenthèses
  pointent sur la version d'avant suppression ; le tableau §6.4 est à
  jour de la nouvelle numérotation.
- `apiRequest` (`lib/api.ts`, ancien 176–183) : simple alias de
  `request`, jamais importé (§2.1).
- `client/src/_core/` et `client/src/_core/hooks/` : répertoires vides.

**Toujours présent, consommateur non vérifié** — laissé en place parce
qu'un lecteur hors `client/` (runtime de la plateforme, outil de l'auteur)
n'a pas pu être écarté :

- `window.__WOUTER_ROUTES__` : le patch wouter l'ÉCRIT
  (`patches/wouter@3.7.1.patch:9–24`) ; grep du dépôt entier : AUCUN
  lecteur. Consommateur présumé (runtime de la plateforme) :
  non vérifié.
- `client/public/manus-routes.json` (6 routes listées) : aucun
  lecteur trouvé sous `client/` ; consommateur serveur/externe :
  non vérifié.
- `clearEvidence()` (`qaContext.ts:59`) : appelé uniquement par
  `qaContext.test.ts` (24, 36, 45, 57, 66, 81, 95) ; aucun chemin
  applicatif ne purge les preuves.
- Bloc `.dark` (`index.css:141–195`) et plomberie ThemeContext
  (§7.2) : dormant de bout en bout.

### 10.3 Fichiers client sans test

Le dépôt ne contient qu'UN seul fichier de test côté client :
`client/src/lib/qaContext.test.ts`. Les autres fichiers de `client/`
n'en ont aucun (listing complet vérifié) :

| Zone       | Fichiers non testés                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monture    | `main.tsx`, `App.tsx`                                                                                                                                                                                                                                                                                                                                                     |
| Lib        | `lib/api.ts` (tout le contrat §2), `lib/utils.ts`                                                                                                                                                                                                                                                                                                                         |
| Contexte   | `contexts/ThemeContext.tsx`                                                                                                                                                                                                                                                                                                                                               |
| Hooks      | `useAutoRefresh.ts`, `useMediaQuery.ts`, `useMyPlan.ts`                                                                                                                                                                                                                                                                                                                   |
| Pages      | les 11 : `Landing`, `Dashboard`, `MonitorDetail`, `PublicStatus`, `SupportTicket`, `Settings`, `QaQueue`, `AdminConsole`, `Login`, `Register`, `NotFound`                                                                                                                                                                                                                 |
| Composants | les 23 : `ErrorBoundary`, `ui/skeleton`, `ui/sonner`, `ui/tooltip`, `uptime/AppShell`, `ClientReadsShowcase`, `ConfirmDialog`, `CountUp`, `HeroCircuit`, `HeroDeck`, `Logo`, `Modal`, `PageState`, `PeriodSelector`, `ProductPreview`, `ReportIssueDialog`, `Reveal`, `RowMenu`, `SiteFooter`, `StatusBadge`, `qa/QaChips`, `qa/QaTicketDetail`, `status/StatusAnalytics` |
| Styles     | `index.css`, `index.html`                                                                                                                                                                                                                                                                                                                                                 |

Les trois hooks vivants ont quand même une protection indirecte :
`useMediaQuery` justifie son inert au départ (3–7), `useMyPlan` son
cache module-level (4–9) et son échec silencieux (23–26),
`useAutoRefresh` sa pause à l'onglet caché (14–16) — mais ces
comportements ne sont couverts par aucun test.
