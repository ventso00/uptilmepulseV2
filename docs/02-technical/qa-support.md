# Qualité et support client

Document de référence du module QA : la file de signalements
(`server/qa/`), la capture de preuves côté navigateur
(`client/src/lib/qaContext.ts`), le poste de traitement `/qa`
(`client/src/pages/QaQueue.tsx`,
`client/src/components/uptime/qa/QaTicketDetail.tsx`) et le lien de suivi
confidentiel `/support/:token` (`client/src/pages/SupportTicket.tsx`).

Le module automatise les missions d'un poste « Test et analyse qualité /
support client » : tester les fonctionnalités, analyser les problèmes signalés,
documenter les anomalies (étapes, preuves, attendu vs réel), communiquer en
français avec le client, traduire la demande client en rapport interne, et
assurer le suivi quotidien des tickets jusqu'à leur résolution.

Règle centrale, appliquée partout : **aucun document généré n'affirme ce que le
ticket ne porte pas.** Une cause, une date de livraison ou un numéro de version
n'apparaissent jamais dans un rapport ni dans une réponse client, parce que le
code ne les connaît pas.

---

## 1. Mission par mission, ce que le code fait

| Mission du poste                                                 | Implémentation                                                                                                                                                                                                                       | Fichiers                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Tester les fonctionnalités de l'application                      | 7 invariants de fonctionnement rejoués toutes les 15 minutes par l'ordonnanceur interne, plus un test fonctionnel de la page publique quotidien                                                                                      | `server/qa/selfTest.ts`, `server/qa/digest.ts`                              |
| Analyser les problèmes signalés par les clients                  | Ticket unique par signalement, preuves du navigateur attachées d'office, lecture préliminaire générée à partir des seuls signaux présents                                                                                            | `server/qa/tickets.ts`, `server/qa/report.ts`                               |
| Identifier bugs, comportements inattendus, problèmes d'ergonomie | `kind` = `bug` / `behaviour` / `ux` + sévérité `P1`…`P4`, modifiables à tout moment depuis le poste de traitement                                                                                                                    | `shared/contracts.ts`, `client/src/components/uptime/qa/QaTicketDetail.tsx` |
| Documenter avec étapes, preuves et attendu vs réel               | Colonnes dédiées `steps`, `expected`, `actual`, `evidence` ; le rapport interne les reproduit telles quelles, avec « à demander au client » quand elles manquent                                                                     | `shared/db/schema.ts`, `server/qa/report.ts`                                |
| Communiquer avec les clients en français                         | Trois modèles de réponse (accusé, demande de précision, résolution) + publication d'une note visible depuis le lien de suivi                                                                                                         | `server/qa/report.ts`, `client/src/pages/SupportTicket.tsx`                 |
| Mises à jour quotidiennes et suivi jusqu'à résolution            | Point quotidien idempotent (flux du jour, relances, auto-tests, prochaines actions), **produit et consulté sur `/qa`, jamais envoyé** — le produit n'a aucun transport de messagerie + alerte de suivi au-delà de 48 h sans activité | `server/qa/digest.ts`, `shared/contracts.ts` (`QA_OVERDUE_AFTER_MINUTES`)   |

---

## 2. Modèle de données

Trois tables, créées par la migration `shared/db/0006_needy_lily_hollister.sql`.

### `qa_tickets`

Un ticket = un dossier, qu'il vienne d'un client, d'un auto-test ou d'une note
interne (`source` ∈ `client` / `auto` / `internal`). Le champ
`clientMessage` conserve le verbatim du client : il n'est jamais réécrit, car
tout le rapport interne en découle. `updatedAt` tient lieu de date de
dernière activité — chaque écriture d'événement la repositionne explicitement,
pour qu'une note compte dans le suivi au même titre qu'un changement d'état.

Deux colonnes ne sont jamais destinées au client :

- `reporterToken` (unique) — le jeton du lien de suivi, absent pour les
  tickets internes et automatiques ;
- `fingerprint` (unique) — la clé de déduplication des anomalies, **remise à
  `null` à la fermeture**. Une anomalie persistante met donc à jour un seul
  dossier (`selftest:<id_check>:u<compte>`) ; une réapparition après
  résolution ouvre un nouveau dossier, ce qui la rend visible.

### `qa_ticket_events`

Chronologie appendue. `visibility` ∈ `public` / `internal` est la frontière de
confidentialité du module : la lecture publique filtre `visibility = 'public'`,
le poste de traitement voit tout. Un événement porte aussi `fromStatus` /
`toStatus`, ce qui permet de rejouer l'historique d'états sans le déduire.

### `qa_runs`

Registre d'idempotence des deux jobs récurrents, contrainte unique sur
`(kind, periodKey)` :

| Job             | `kind`         | `periodKey`                                   | Cadence           |
| --------------- | -------------- | --------------------------------------------- | ----------------- |
| Auto-tests      | `self_test`    | `2026-10-09T10:15` (minute UTC arrondie à 15) | toutes les 15 min |
| Point quotidien | `daily_digest` | `2026-10-09` (jour UTC)                       | une fois par jour |

Le gain se fait par `INSERT` : le premier gagnant travaille, les autres
reviennent de `claimRun` avec `null` (`server/qa/runs.ts:17-34`). Le conflit
d'index unique est reconnu par `isDuplicateKeyError` (`server/qa/runs.ts:25`),
qui lit le code du pilote sur `.cause` : Drizzle enveloppe toute requête en
échec dans un `DrizzleQueryError` dont le `message` est le SQL avec ses
valeurs liées et dont le `code` est vide (`server/_core/db-error.ts:17-41`).
Plusieurs instances du serveur ou un cron externe ne produisent donc jamais
deux points du même jour, et l'instance qui perd la revendication ne
journalise rien. `finishedAt` reste `null` si la passe meurt en cours :
l'incident est visible au lieu d'être silencieusement perdu.

Les passes forcées (boutons du poste de traitement) ajoutent un suffixe
`-m<6 derniers chiffres de l'horloge>` : elles écrivent un nouveau bucket plutôt
que de renvoyer un 409 sur la période déjà revendiquée.

Les clés de période sont calculées en **UTC**, pas dans le fuseau de l'hôte : un
serveur ailleurs qu'en Europe aurait sinon sauté le point que l'opérateur
attends. Les deux fonctions sont couvertes par des tests
(`selfTestPeriodKey`, `digestPeriodKey`).

---

## 3. Circuit d'un signalement

```
Visiteur (page publique, landing, dashboard)
  └─ « Signaler un problème » → ReportIssueDialog
       └─ POST /api/public/qa/tickets   (10 requêtes / 15 min / IP)
            ├─ honeypot `website` rempli → 201 factice (id 0, jeton "0"×32)
            ├─ statusSlug présent → affecté au propriétaire de la page
            └─ sinon → affecté au responsable qualité (1er admin, sinon compte le plus ancien)
                 └─ qa_tickets (statut « new ») + qa_ticket_events (événement public)
                      └─ POST répond { id, reference UP-XXXXX, reporterToken }

Client                            Opérateur (compte propriétaire)
  └─ /support/:token                └─ /qa
       (thème clair, relance,          ├─ GET /api/qa/overview (stats, auto-tests, point du jour)
        60 lectures / min / IP)        ├─ GET /api/qa/tickets/:id (dossier + rapport interne)
                                       ├─ PATCH …          (tri, sévérité, domaine, état)
  message ←                            ├─ POST …/events    (note interne ou publique)
  POST /api/public/qa/…                └─ POST …/reply     (brouillon français, copié ou publié)
  → replaces waiting_client
    en « en cours » automatiquement
```

Le lien de suivi est le seul accès du client à son dossier : il n'y a pas de
compte à créer. Le jeton est validé par l'expression `^[0-9a-f]{32}$` avant la
moindre requête, et un jeton mal formé répond 404 comme un jeton inconnu — rien
ne permet de deviner si un dossier existe.

---

## 4. Capture automatique des preuves

`client/src/lib/qaContext.ts` vit en mémoire du module, sans persistance : une
preuve décrit la session courante et rien d'autre.

- **Ce qui est capturé** : route visible, user-agent, langue, viewport,
  horodatage, les 10 dernières erreurs JavaScript (dont les rejets de Promise
  non gérés et les erreurs remontées à l'`ErrorBoundary`), et les 10 derniers
  appels API en échec (chemin, statut, code, durée).
- **Ce qui ne l'est jamais** : le corps des réponses, les jetons de session,
  les mots de passe, le contenu des formulaires. La route est prise sur
  `location.pathname`, **la chaîne de requête est supprimée** — un jeton peut y
  figurer.
- **Bornage** : 300 caractères par texte, 60 par code d'erreur, 10 entrées par
  tampon, côté navigateur (`clip`, `remember`) et à nouveau côté serveur par
  `qaEvidenceSchema`. Un payload trop volumineux est **rejeté à la lecture**
  (`parseEvidence` renvoie `null`) : une preuve corrompue ne casse jamais la
  file.

Le `Host` ne fournit pas l'origine des liens : `requestOrigin` lit
`APP_BASE_URL` en priorité, puis `x-forwarded-host`/`host` en fallback local, et
refuse tout hôte qui ne ressemble pas à un hôte (`^[A-Za-z0-9.\-:[\]]{1,253}$`).
Un hôte forgé — avec un saut de ligne, par exemple — produit une origine vide,
donc **aucun lien** dans le rapport et la réponse, au lieu d'un lien contrôlé
par l'attaquant.

---

## 5. Les sept invariants d'auto-test

Chaque contrôle est une agrégation **en lecture seule** sur des colonnes déjà
indexées ; une passe coûte quelques scans bornés (20 lignes maximum remontées,
3 exemples affichés).

| id                       | Sévérité | Invariant (motif du ticket)                                            | Marge        |
| ------------------------ | -------- | ---------------------------------------------------------------------- | ------------ |
| `database_reachable`     | P1       | une lecture simple des services aboutit                                | —            |
| `scheduler_alive`        | P1       | tout service activé dont l'heure de vérification est passée est repris | 2 min        |
| `first_check_ran`        | P2       | un service activé obtient un premier résultat                          | 15 min       |
| `notification_backlog`   | P2       | une notification en attente ou en échec est reprise                    | 10 min       |
| `notification_exhausted` | P3       | aucune notification n'accumule 3 tentatives échouées sans traitement   | 3 tentatives |
| `down_without_incident`  | P1       | tout service marqué en panne possède un incident non résolu            | —            |
| `retention_stalled`      | P3       | aucun relevé conservé au-delà de la rétention                          | 90 j + 2 j   |

Deux règles d'honnêteté, toutes deux testées :

1. **Un test qui ne peut pas s'exécuter est un échec**, jamais un succès.
   `database_reachable` capture l'exception et l'écrit dans `actual` ; une
   exception levée par n'importe quel contrôle pendant `runSelfTest` devient
   « Test impossible : … ». Dans les deux cas le texte inséré est celui du
   pilote, jamais la requête : `safeErrorMessage` écarte le SQL et ses valeurs
   liées que Drizzle met dans le `message` de son enveloppe
   (`server/qa/selfTest.ts:149,493`, `server/_core/db-error.ts:47-55`). Le
   journal `qa_self_test_error` suit la même règle (`server/qa/selfTest.ts:584-585`).
2. **Une observation se chiffre, elle ne se résume pas.** `actual` porte le
   nombre réel et des exemples (« API publique : en retard de 10 min »), jamais
   « tout va bien ». Le texte est produit par `describe()`, qui oblige l'auteur
   du contrôle à fournir les trois formes françaises (aucun / un / plusieurs),
   le genre des noms ne se déduisant pas.

Statut d'une passe : `failed` si une anomalie est P1 (le produit lui-même est
faux), `attention` sinon, `ok` si tout est conforme. Les anomalies
systémiques — file de notifications, purge — ne portent pas de compte : elles
sont rattachées au responsable qualité, tandis qu'une anomalie liée à des
services précis est rattachée au propriétaire de ces services, un seul dossier
par (contrôle, compte) même si cinq services sont concernés.

L'ordonnanceur appelle `maybeRunSelfTest` puis `maybeRunDailyDigest` après la
purge de rétention, à chaque tick de 30 s (`server/scheduler/tick.ts`). Les deux
fonctions attrapent tout : un auto-test cassé ne bloque pas les vérifications.

---

## 6. Rapport interne et réponses clients

`server/qa/report.ts` ne fait que mettre en forme : `buildInternalReport` et
`buildClientReply` sont des fonctions pures du ticket, régénérables à volonté et
relisible dans le code.

**Rapport interne** — sections en français : en-tête qualifié (source, domaine,
sévérité, état, dates, service et page concernés, lien client), verbatim du
client, étapes de reproduction, attendu vs réel, preuves, chronologie, **lecture
préliminaire**, prochaine action.

La lecture préliminaire est la partie « analyse » : elle n'infère que depuis les
signaux présents — source automatique, appels API en échec (statuts dédupliqués),
erreurs JavaScript, ticket `ux` sans aucune erreur technique (= probablement
ergonomique), étapes absentes (= demander au client). Si rien ne parle, elle
l'écrit : « Aucun signal exploitable pour l'instant : le ticket doit d'abord
être qualifié. »

**Prochaine action** est déterministe, avec une priorité : le dépassement de
48 h sans activité impose une relance, **même sur un ticket clos**. Ensuite,
l'action dépend de l'état (trier / reproduire / continuer et publier une note /
relancer le client / confirmer la résolution / aucune).

**Réponses clients** — trois modèles, jamais envoyés automatiquement :

| Modèle            | Contenu                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `acknowledgement` | référence, titre, prise en charge, mention des preuves reçues s'il y en a                                                                   |
| `clarification`   | énumère **exactement** les champs qui manquent ; si rien ne manque, le texte dit que le dossier est complet et que la reproduction continue |
| `resolution`      | date de résolution si elle existe, et demande de confirmation sans laquelle le dossier reste ouvert                                         |

Les trois respectent les mêmes interdits : pas de date de livraison, pas de
version, pas de cause, pas de promesse. L'exigence est vérifiée par les tests de
`server/qa/report.test.ts`, y compris les cas dégénérés (ticket sans nom,
ticket sans preuve, ticket complet en demande de précision).

Le produit **n'a pas de transport de messagerie** pour ces réponses :
l'opérateur les copie, ou les publie comme note `public` depuis le poste de
traitement, ce qui les affiche sur le lien de suivi du client. C'est un choix
assumé, pas une finition manquante — l'interface le dit à l'opérateur.

---

## 7. Le point quotidien

`buildDailyDigest` agrège, toutes les 24 heures glissantes et tous comptes
confondus :

1. **Flux du jour** — nouveaux signalements (dont automatiques), résolutions
   confirmées, tickets ouverts (non triés / en attente client), suivi dû,
   résolus sur 7 jours.
2. **Nouveaux signalements** et **résolutions confirmées** — puces par ticket,
   formulation transmissible telle quelle.
3. **Relances en attente** — tickets ouverts sans activité depuis 48 h, triés
   du plus ancien.
4. **Auto-tests de fonctionnement** — uniquement la dernière passe _encore dans
   la fenêtre_ ; une passe d'hier reporterait les anomalies d'hier comme
   celles d'aujourd'hui.
5. **Test fonctionnel de la page publique** — le payload réel de la première
   page publiée est repassé dans `publicStatusResponseSchema`. C'est le seul
   contrôle bout-en-bout du produit visible par un client : s'il échoue, le
   point passe en `failed` et l'action proposée est de corriger la page publique
   « en priorité ».
6. **Prochaines actions** — dérivées des sections précédentes, jamais inventées.

`lastDailyDigest` **rejoue** le point stocké et recalcule les compteurs à partir
des tickets du jour concerné, au lieu de les relire depuis le blob : un point
mis en cache ne peut pas affirmer qu'une journée fut calme alors qu'elle ne le
fut pas.

**Deux fenêtres, un seul rythme.** Le contenu est calculé sur `WINDOW_HOURS = 24`
heures glissantes depuis `now` (`digest.ts:30`), tandis que la passe est réservée
(`claimRun`) sur une clé de **jour UTC** (`digest.ts:219-222`) : la première
passe du jour produit le point, les suivantes refusent, et
`POST /api/qa/digest/run` répond `409` sans `force`. Un point lu le soir ne
couvre donc pas les mêmes heures qu'un point lu le matin, alors qu'ils portent la
même date.

**Le point quotidien est produit, jamais transporté.** C'est une distinction à
faire devant quelqu'un qui attend un e-mail : `buildDailyDigest` écrit le
markdown dans `qa_runs.detail`, `GET /api/qa/digest` le rejoue, et le panneau
« Point quotidien » de `/qa` est le **seul** consommateur du dépôt. Le produit
n'a aucun transport de messagerie — ni SMTP, ni envoi vers les canaux de
notification, ni cron externe qui récupère le point. Une instance qui ne monte
pas l'ordonnanceur interne (`SCHEDULER_INTERNAL=0`) et un opérateur qui n'ouvre
jamais `/qa` ne voient donc jamais de point, et rien ne le signale à l'écran :
l'échec est journalisé en événement structuré `qa_daily_digest_error`
(`digest.ts:396-402`, message porté par `safeErrorMessage` à la ligne `:399`)
puis avalé — et une base absente fait `return null` avant
même cela (`digest.ts:382-383`).

---

## 8. Suivi à 48 heures

`QA_OVERDUE_AFTER_MINUTES = 48 * 60` vit dans `shared/contracts.ts` parce que
**quatre consommateurs doivent afficher le même chiffre** :

- `computeTotals` → la carte « Suivi dû » de la file ;
- `findOverdueTickets` → la liste utilisée par le point quotidien ;
- `recommendedNextStep` → la ligne RELANCE du rapport interne ;
- `isOverdue` côté client → la ligne et le bandeau roses du dossier.

Un ticket n'est jamais « oublié » silencieusement : `newReporterToken` donne un
lien permanent au client, l'opérateur voit l'attente, et le point du jour la
répète tant qu'elle dure.

---

## 9. Sécurité et confidentialité

- **Pas d'écriture anonyme dans un compte tiers** : un signalement est
  affecté au propriétaire de la page de statut citée, ou au responsable
  qualité. Le client ne choisit jamais un identifiant de compte.
- **Secrets** : ni mot de passe, ni jeton de session, ni jeton Telegram dans
  une preuve, un événement ou un rapport. La sérialisation publique est
  construite champ par champ — `serializePublicTicket` — plutôt qu'en retirant
  des clés d'un objet : un futur champ interne ne peut donc pas fuir par
  oubli. Un test d'inventaire de clés le verrouille.
- **Visibilité** : les notes `internal` ne quittent jamais l'API publique, et
  les réponses publiques sont marquées `Cache-Control: private, no-store`.
- **Limitation de débit** : 10 signalements / 15 min, 60 lectures / min,
  20 messages / heure, 60 écritures d'opérateur / min, 6 forçages / min — par
  IP.
- **En-têtes** : `requestOrigin` valide la forme du `Host` et ignore
  entièrement un hôte suspect (voir §4).
- **Injection** : aucun contenu utilisateur n'est évalué ; le markdown du
  rapport et du point du jour est affiché en `<pre>`, pas en HTML.

---

## 10. Limites assumées

- **Pas de capture d'écran ni de headless browser** : la preuve est le contexte
  structuré (route, viewport, erreurs, appels en échec). Ajouter Playwright
  serait une dépendance externe lourde pour un gain marginal sur le diagnostic.
- **Pas d'envoi automatique des réponses** : pas de transport de messagerie
  configuré dans ce produit ; le flux complet s'appuie sur le lien de suivi.
- **Pas de fenêtres de maintenance** : le schéma n'a pas de table pour cela, et
  le point quotidien préfère taire ce qu'il ne mesure pas.
- **Un seul interlocuteur interne** : le module ne fait pas la répartition
  entre plusieurs opérateurs (pas d'affectation nominative, `assignee` n'existe
  pas) ; la file est celle du compte.
- **Français uniquement** : les libellés sont des constantes partagées
  (`qaTicket*Labels`), pas une couche i18n.

---

## 11. Tests

| Fichier                                          | Ce qu'il verrouille                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/qa/report.test.ts`                       | structure et ordering des sections du rapport interne, citation du verbatim, valeurs de repli (« Non fournies — à demander au client. », « Non précisé. », « Fenêtre : — », « Aucun appel API en échec capturé. »), tous les embranchements de la lecture préliminaire, priorité de la relance sur l'état, les trois modèles clients et leurs cas dégénérés |
| `server/qa/selfTest.test.ts`                     | clés de période arrondies en UTC, les 7 invariants et leurs sévérités, observation chiffrée et pluriel français, échantillon limité à 3 exemples, échec de lecture = anomalie, incident orphelin, borne de rétention                                                                                                                                        |
| `server/qa/tickets.test.ts`                      | table de transitions (y compris `closed` sans issue et `resolved → in_progress`), jeton au format attendu, `parseEvidence` tolérant, calcul de `idleMinutes` jamais négatif, inventaire exhaustif des champs publics                                                                                                                                        |
| `server/qa/digest.test.ts`                       | `digestPeriodKey` sur le jour UTC, ordre lexical = ordre chronologique                                                                                                                                                                                                                                                                                      |
| `server/qa/runs.test.ts`                         | `parseDetail` : `null`, JSON illisible ou non-tableau → liste vide                                                                                                                                                                                                                                                                                          |
| `server/_core/db-error.test.ts`                  | déballage de l'enveloppe Drizzle : code du pilote lu à travers `.cause`, conflit d'index unique reconnu sur les deux formes (enveloppée et nue), message qui ne contient jamais le texte de la requête (3 tests)                                                                                                                                            |
| `server/qa/routes.test.ts`                       | `requestOrigin` : `APP_BASE_URL` prioritaire, `x-forwarded-host`, proto fiable, liste virgule, refus d'un hôte forgé ou vide, IPv6 entre crochets                                                                                                                                                                                                           |
| `shared/contracts.test.ts` (bloc _qa contracts_) | référence `UP-XXXXX` padding, transitions, `QA_OPEN_STATUSES` et 48 h, défauts et bornes de `qaEvidenceSchema`, valeurs par défaut de l'intake et honeypot, visibilité par défaut d'une note, kinds de réponse, champs requis des tickets, suppression des champs privés                                                                                    |
| `client/src/lib/qaContext.test.ts`               | route sans chaîne de requête, aucune fuite du jeton, tampons circulaires de 10, rognage 300/60, copie insensible aux erreurs ultérieures, `clearEvidence`                                                                                                                                                                                                   |

```bash
pnpm exec vitest run          # 23 fichiers, 223 tests
pnpm exec tsc --noEmit
pnpm exec oxlint --deny-warnings .
pnpm format:check
pnpm build
```

Une leçon de comptage, à énoncer telle quelle : le test de la passerelle
base→503 (`server/platform.test.ts:103-130`) jetait une erreur **nue** portant
`.code` — exactement la forme que Drizzle ne produit plus. Il restait vert alors
que la revendication `qa_runs`, le `409 SLUG_TAKEN` et la déduplication des
notifications étaient cassés en production. Le cas ajouté
(`server/platform.test.ts:132-167`) jette l'enveloppe réelle et vérifie que la
ligne de journal ne contient pas le texte de la requête.

`server/checks/client.test.ts` est le seul fichier de test qui sorte sur le
réseau : il interroge `example.com`, un hôte inexistant en `.invalid` et une
page réelle de plus de 256 Ko pour prouver la troncature. C'est le point à
revoir en premier si `pnpm test` devient lent ou rouge sans raison.

---

## 12. Vérification en local

1. Démarrer le serveur (sous Windows, `pnpm dev` échoue sur sa syntaxe d'env
   POSIX : `NODE_ENV=development node_modules/.bin/tsx watch
server/_core/index.ts`), puis ouvrir `/`. En développement, `setupVite` ne
   fabrique plus la configuration lui-même : il passe le chemin de
   `vite.config.ts` et laisse Vite le charger (`server/_core/vite.ts:12-20`),
   donc `server.host: true` (`vite.config.ts:209`) et
   `server.fs = { strict: true, deny: ["**/.*"] }` (`vite.config.ts:219-222`)
   s'appliquent réellement — mesuré : `GET /@fs/<chemin absolu>/.env` répond
   `403 Restricted`, et `GET /.env` répond `200` mais rend le shell HTML du
   repli SPA (`server/_core/vite.ts:23`), jamais le fichier. Aucun seed ne
   préremplit la base —
   il faut créer un moniteur et une page de statut depuis `/settings` pour avoir
   un slug, et donc une `/status/:slug` à consulter.
2. Sur cette page, « Signaler un problème » → décrire un comportement, laisser
   les preuves se remplir → le `201` renvoie `UP-XXXXX` et le jeton.
3. Ouvrir `/support/<jeton>` : progression d'étape lisible, échanges publics
   uniquement ; le complément envoyé depuis la page y reparaît.
4. Réclamer le compte créateur (`UPTIMEPULSE_OWNER_EMAIL`, dont la valeur par
   défaut est l'adresse du créateur posée dans `server/auth/owner.ts`) depuis
   `/register`, puis ouvrir `/qa` — même régime clair que le reste du produit
   depuis ADR-018 : stats, auto-tests, point du jour, le dossier dans la liste.
   Un compte antérieur au verrou, `demo@` ou autre, répond `403
ACCESS_RESERVED` depuis ADR-016.
5. Traiter : trier, publier une note, générer un brouillon français, le publier
   au client, puis vérifier qu'il apparaît bien sur `/support/<jeton>`.
6. Forcer une passe (« Régénérer » le point, relancer les auto-tests) pour
   observer l'idempotence : une passe programmée du même bucket ne produit
   rien, un forçage produit un bucket distinct.

Les captures de `docs/images/` et les figures du `cahier-des-charges.md` ont été
prises sur une base de développement qui portait le slug `demo-services` ; ce
slug n'existe dans aucun seed du dépôt. Les chiffres qu'elles montrent sont donc
ceux d'un instant donné, pas un jeu de données reproductible.
