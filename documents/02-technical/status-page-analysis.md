# Analyse du statut public

Document de référence pour `GET /api/public/status/:slug` (`server/statuspages/routes.ts`),
le module d'analyse (`server/statuspages/analysis.ts`) et la page
`/status/:slug` (`client/src/pages/PublicStatus.tsx`,
`client/src/components/uptime/status/StatusAnalytics.tsx`).

Tout chiffre affiché publiquement est dérivé des `ping_logs` et des `incidents`
déjà stockés. Aucun n'est simulé, lissé, ni complété par une valeur par défaut
marketing : une mesure sans donnée rend `null` et l'interface affiche un état
vide explicite.

---

## 1. Ce qu'un visiteur peut déduire de la page

La page répond à cinq questions, dans cet ordre :

1. **Est-ce que ça marche maintenant ?** Bandeau global + liste des incidents
   ouverts avec leur horodatage de début, leur durée en cours et la cause.
2. **Est-ce que ça marche depuis longtemps ?** Uptime glissant sur 24 h, 7 j,
   30 j et 90 j, chacun accompagné du nombre de checks qui le fonde.
3. **Est-ce que c'est rapide ?** p50 / p90 / p95 / max sur 7 jours, moyenne,
   tendance vs les 7 jours précédents, et une courbe horaire.
4. **Où part le temps ?** Décomposition DNS / TCP / TLS / serveur.
5. **Pourquoi ça est tombé ?** Répartition des causes d'échec, nombre
   d'incidents confirmés, temps d'indisponibilité cumulé, MTTR, incident le
   plus long, certificat TLS restant.

Le bloc « Méthodologie » (`<details>` en bas de page) publie les seuils de
confirmation, la rétention, la fenêtre de mesure, le plafond d'échantillonnage
et l'avertissement sur l'objectif de 99,9 %. Un visiteur peut donc rejouer
chaque nombre à partir des données brutes.

---

## 2. Sources de données et fenêtres

| Fenêtre                         | Valeur                                                      | Base                  |
| ------------------------------- | ----------------------------------------------------------- | --------------------- |
| Calendrier et uptime            | `STATUS_WINDOW_DAYS` = `RETENTION.pingLogsDays` (90 j)      | `ping_logs.checkedAt` |
| Latence, phases, courbe horaire | `LATENCY_WINDOW_DAYS` = 7 j, échantillon sur 14 j           | idem                  |
| Incidents                       | 90 j, `status <> 'suspect'`                                 | `incidents.startedAt` |
| Certificat                      | lu sur la monitor (`sslValidTo`, `sslIssuer`, `sslSubject`) | dernier check         |

Une fenêtre est un intervalle **ouvert à gauche, fermé à droite** sur `now` :
`checkedAt >= now - N jours`. `windowStart`, `sampleStart` et les quatre
coupures (`d1`, `d7`, `d30`, `d90`) sont calculées une fois par requête HTTP,
avec l'horloge du serveur applicatif et non celle de MySQL, pour que les mêmes
bornes servent aux agrégats SQL et aux filtres JavaScript.

**Un incident `suspect` n'entre dans aucun compteur public.** Il n'est ni
confirmé ni résolu : le publier gonflerait le nombre d'incidents et le temps
mort. Seuls les incidents confirmés (3 échecs consécutifs, `INCIDENT_RULES`)
comptent, et un incident ouvert contribue son `elapsedSeconds` calculé à la
volée, jamais une durée inventée.

---

## 3. Les six requêtes

`buildPublicStatusAnalysis(db, monitorRows, now)` lance **six agrégats groupés
en parallèle** (`Promise.all`), jamais une requête par monitor : une page de
trois services coûterait ~18 allers-retours sinon, sur un endpoint public.

| #   | Requête                                                            | Sortie                           | Coût                  |
| --- | ------------------------------------------------------------------ | -------------------------------- | --------------------- |
| 1   | Buckets par jour UTC (`date_format(checkedAt,'%Y-%m-%d')`)         | up/total par monitor et par jour | scan 90 j, `GROUP BY` |
| 2   | Sommes conditionnelles `sum(case when checkedAt >= X …)`           | up/total à 1, 7, 30, 90 j        | **un seul** scan 90 j |
| 3   | Échantillon brut 14 j, trié décroissant, `LIMIT cap × nb_monitors` | lignes de latence/phases         | borné, voir §4        |
| 4   | Comptes par `classification` sur 90 j, `isUp = false`              | causes d'échec                   | scan 90 j filtré      |
| 5   | Agrégats incidents par monitor (`count`, somme, max)               | stats incidents                  | table petite          |
| 6   | Chronologie incidents jointe à `monitors.name`, `LIMIT 40`         | timeline + dernier incident      | borné                 |

Les points communs aux six requêtes : filtre `monitorId IN (…)` issu des
monitors de la page, index `ping_logs_monitor_checked_idx (monitorId, checkedAt)`
— déclaré ascendant, MySQL relit le B-tree à rebours pour le tri décroissant de
la requête 3 — et une unique horloge de référence.

Deux pièges évités volontairement :

- **`date_format` plutôt que la colonne date brute.** MySQL 8 renvoie un
  `TIMESTAMP` comme une chaîne `YYYY-MM-DD HH:MM:SS` sans fuseau que l'JS
  interprète en heure locale : les buckets de jour glisseraient de plusieurs
  heures selon la machine. La fonction force une chaîne ASCII déjà normalisée.
- **Pas de fonction de percentile en SQL.** MySQL 8 n'en expose aucune ; les
  percentiles sont donc calculs côté applicatif sur l'échantillon borné (§4),
  ce qui les rend exacts et reproductibles plutôt qu'approximés par histogramme.

---

## 4. Bornage de l'échantillon de latence

Requête 3 lit au plus `LATENCY_SAMPLE_CAP_PER_MONITOR × nb_monitors` lignes.
Ce plafond n'est pas un chiffre arbitraire : il est **dérivé du contrat**.

- `intervalSecondsSchema` interdit un intervalle sous **300 s**, pour tous les
  plans (`shared/contracts.ts`).
- Donc un monitor produit au plus `24 × 60 × 60 / 300 = 288` checks/jour.
- L'échantillon couvre 14 jours (7 jours courants + 7 jours de comparaison) :
  au plus `2 × 7 × 288 = 4 032` lignes par monitor.
- `LATENCY_SAMPLE_CAP_PER_MONITOR = 4 032 + 288 = 4 320`, soit une journée de
  marge.

Le `LIMIT` est **partagé** entre monitors et le tri est global décroissant : si
le budget était trop petit, MySQL couperait les lignes **les plus anciennes**,
c'est-à-dire la fenêtre de comparaison. La tendance publierait alors une
variation calculée sur quelques centaines de checks contre plus de 2 000 pour
la période courante — un biais invisible. Le cap dérivé rend cette troncature
impossible, et `analysis.test.ts` le vérifie : le test « sample bounds »
recalcule 4 032 depuis le plancher de 300 s et exige que le cap soit au-dessus.

Le `methodology.latencySampleCap` publié reprend la même constante : la page
montre le plafond qu'elle a réellement utilisé.

---

## 5. Formules, une par une

### Uptime par fenêtre — `windowFromCounts(up, total)`

`uptimePercent = round2(up / total × 100)`, `failedChecks = total − up`,
et `null` si `total = 0`.

Le ratio se compte **en checks, pas en secondes** : la cadence est propre à
chaque monitor, donc un pourcentage de checks est la seule grandeur que
l'opérateur peut vérifier en relisant les logs. Une fenêtre sans check affiche
`—`, jamais `0 %`.

### Percentiles — `percentile(sorted, q)`

Rang le plus proche, sans interpolation : `index = ceil(q/100 × n)`, borné à
`[1, n]`, sur le tableau trié croissant. `null` sur échantillon vide.
Conséquence assumée : `p50` sur quatre valeurs `[10,20,30,40]` renvoie `20`,
pas `25`. C'est une valeur réellement observée, donc reproductible.

### Moyennes

`mean(arrondit au ms entier le plus proche)` sur les checks **réussis**
uniquement. Un check en timeout n'a pas de `responseTimeMs` exploitable :
l'inclure fausserait la moyenne vers le haut avec une valeur de compteur.

### Tendance de latence

`trendPercent = round2((moyenne_7j − moyenne_précédents_7j) / moyenne_précédents_7j × 100)`,
`null` si l'un des deux côtés est absent ou si la moyenne précédente vaut 0.
Négatif = plus rapide. L'UI n'affiche la flèche que si les deux fenêtres ont
des échantillons.

### Décomposition des phases

Moyenne par phase sur les checks réussis portant la colonne. Une valeur
manquante (check antérieur à la migration des phases, cible non-HTTPS sans TLS)
sort du calcul de cette phase seule, jamais remplacée par 0.

`serverMs = max(0, ttfb − dns − tcp − tls)` : le TTFB est mesuré du démarrage
socket au premier octet, il **contient** déjà DNS, TCP et TLS. La soustraction
isole le temps applicatif distant. Le `max(0, …)` absorbe l'arrondi au ms, pas
un signal.

`phases.sampleChecks` compte les lignes de la fenêtre courante ayant un `ttfbMs`
non nul, c'est-à-dire exactement la population sur laquelle les moyennes ci-dessus sont calculées — et non le nombre de checks disposant d'un timing.

### Causes d'échec

Compte par `classification` sur 90 j (`DOWN_TIMEOUT`, `DOWN_HTTP_5XX`,
`DOWN_DNS`, …), trié décroissant, tronqué aux 6 premières causes. La
troncature est affichée comme telle (« causes principales ») : les causes
rares ne disparaissent pas silencieusement du total.

### Incidents et MTTR

- `confirmedCount` = incidents non suspects démarrés dans la fenêtre.
- `resolvedCount` = ceux ayant un `resolvedAt`.
- `totalDowntimeSeconds` = somme des `durationSeconds` (donc des incidents
  **résolus** seulement ; un incident ouvert a `durationSeconds` null).
- `averageDownSeconds` = `round(total / resolvedCount)` : le MTTR. `null` si
  aucun incident résolu — une page vierge n'a pas de MTTR de 0 s.
- `longestDownSeconds` = max SQL.
- `lastIncidentAt` = premier élément de la chronologie pour ce monitor (tri
  `startedAt DESC`), donc le plus récent, incident ouvert inclus.

### Budget d'erreur — `errorBudget()`

Objectif publié `SLA_TARGET_PERCENT = 99,9`, présenté comme un **objectif de
référence**, jamais comme un contrat commercial.

```
windowMinutes   = windowDays × 24 × 60
allowedMinutes  = windowMinutes × (100 − target) / 100
consumedMinutes = windowMinutes × (100 − uptimeMesuré) / 100
budget          = round2(max(0, allowed − consumed))
consommé        = round2(min(allowed, consumed))
```

Les deux champs restent `null` sans uptime mesuré : un service créé il y a dix
minutes ne présente pas de budget fabrication. Une fois l'objectif manqué, le
budget tombe à 0 et la consommation est plafonnée à l'allowance — la page
n'affiche jamais « budget négatif ».

### Certificat — `certificateFrom()`

Renvoie `null` si **l'un** des trois champs (`sslValidTo`, `sslIssuer`,
`ssl_subject`) manque, plutôt qu'un certificat à moitié connu.
`daysRemaining = floor((valid_to − now) / 1 jour)` ; il devient négatif après
expiration, et l'UI colore en rouge `< 0`, orange `≤ 30`, avec une alerte
comptabilisée dans `summary.certificatesExpiringSoon`.

---

## 6. Agrégats de page (`summary`)

Sommes et moyennes pondérées par les mêmes fenêtres que les monitors :

- `services` / `pausedServices` : monitors de la page, `enabled = false` compté
  à part — un service en pause n'est pas un service en panne.
- `checks24h` : somme des checks à 24 h.
- `globalUptimePercent` : uptime 90 j **pondéré par le nombre de checks**
  (total up / total checks), pas une moyenne des pourcentages : trois services
  peu checkés ne doivent pas peser autant qu'un service vérifié toutes les
  5 minutes.
- `globalMedianLatencyMs` : `percentile` au rang 50 sur le rassemblement des
  timings des monitors, trié.
- `incidents90d`, `downtime90dSeconds` : sommes des agrégats par monitor.
- `activeIncidents` : incidents non résolus de la chronologie.
- `certificatesExpiringSoon` : comptes `daysRemaining ≤ 30`.

---

## 7. Règles d'honnêteté côté affichage

Le client ne récalcule rien et ne devine rien ; il met en forme. Les règles
appliquées dans `StatusAnalytics.tsx` :

- Un service `UNKNOWN` avec `nextCheckAt` affiche « Premier check prévu à
  HH:MM », pas une uptime de 0 %.
- `hourly`, `days` : les heures sans check restent des zéros. Une barre grise
  veut dire « pas encore de données » (légende explicite), jamais « panne ».
- Sous 10 checks dans la fenêtre de latence, les percentiles sont accompagnés
  d'un avertissement « échantillon trop faible pour être stable ».
- Toute valeur `null` s'affiche `—`.
- Les courbes ont une alternative textuelle `sr-only` et le calendrier un
  `aria-label` résumant l'uptime ; les couleurs ne portent jamais l'information
  seules.
- Pas de fenêtre de maintenance : le schéma n'a pas de table pour ça, donc la
  page n'en affiche pas.

---

## 8. Coût, fraîcheur, protection

- L'endpoint est public, limité par `consumeRateLimit`, et les réponses portent
  un cache court (~30 s) ; six requêtes bornées par requête client reste le
  budget assumé.
- L'écriture de page (`/api/status-page`) passe par `requireUser` et un quota
  de plan ; la lecture publique n'expose que les monitors choisis par
  l'utilisateur.
- Le client rafraîchit toutes les 60 s (`useAutoRefresh`) seulement quand une
  donnée existe, pour ne pas marteler un slug inexistant.

---

## 9. Vérifier localement

`pnpm dev` écrit son environnement en syntaxe POSIX (`NODE_ENV=development tsx
watch …`, `package.json:7`) : il échoue sous Windows et cmd. Là-bas, lancer le
serveur directement — le client est monté par Vite en mode middleware, les
modifications du client sont donc servies sans rebuild :

```bash
NODE_ENV=development node_modules/.bin/tsx watch server/_core/index.ts
# http://localhost:3000
```

**Il n'existe aucun jeu de données de démonstration.** L'unique seed du dépôt
concerne les trois paliers de `plans` (`shared/db/0007_clever_kulan_gath.sql`).
Une URL `/api/public/status/demo-services` copiée telle quelle répond `404
NOT_FOUND` sur une base neuve, parce que la route exige une ligne dans
`status_pages`. Le slug s'obtient en deux gestes réels, dans
`/settings` une fois connecté : ajouter un moniteur, puis enregistrer la page
de statut et lire le slug affiché.

```bash
SLUG=…slug-créé-depuis-settings…

# Charge utile réelle (fenêtres, percentiles, phases, budget)
curl -s "http://localhost:3000/api/public/status/$SLUG" | node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);console.log(p.summary,p.methodology);const m=p.monitors[0];console.log(m.windows,m.latency,m.phases,m.sla)})"

# Page
# http://localhost:3000/status/$SLUG
```

Tests attaquants :

```bash
pnpm exec vitest run shared/contracts.test.ts server/statuspages/analysis.test.ts
```

- `shared/contracts.test.ts` fige la forme du contrat public : payload complet
  accepté, payload sans `summary`/`methodology` refusé, monitor sans certificat
  et sans check accept (tous les champs à `null`).
- `server/statuspages/analysis.test.ts` couvre le calcul pur : percentiles
  exacts aux bornes, fenêtres à pourcentage `null`, bucketting horaire zéro-rempli
  et éviction hors fenêtre, budget d'erreur aux trois régimes (pile l'objectif,
  mieux, manqué), certificat manquant/expiré, et le bornage de l'échantillon §4.

Le module étant un ensemble de fonctions pures sur des lignes, une modification
de formule se vérifie sans base de données.
