# Sommaire

Documentation complète d'UptimePulse, rédigée depuis le code et non depuis un
cahier des charges. Chaque page indique ses sources sous forme
`chemin:ligne`, et les chiffres cités sont mesurés à la date de rédaction.

UptimePulse est un moniteur de disponibilité auto-hébergé, pensé pour un
**opérateur unique** : une seule personne crée un compte, déclare des moniteurs,
reçoit des alertes Telegram et publie une page de statut que les propriétaires
des sites surveillés lisent sans jamais avoir de login. React 19 + Vite 7 +
Tailwind v4 côté client, Express 4 + tRPC 11 + Drizzle (MySQL) côté serveur, un
scheduler qui revendique atomiquement chaque check.

## Comment cette documentation est organisée

| Dossier              | Contient                                                                  | Nature                                    |
| -------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| `01-product/`        | la vision, le cahier des charges                                          | ce que le produit promet et jusqu'où      |
| `02-technical/`      | modèle de données, API, client, sécurité, accès, statut, qualité, paliers | comment c'est construit                   |
| `03-infrastructure/` | checks, notifications, environnement, observabilité, déploiement, local   | comment ça tourne                         |
| `04-project/`        | décisions (ADR), registre des corrections documentaires                   | pourquoi et qu'est-ce qui a changé d'avis |
| `05-exploitation/`   | prises en main et guides par rôle                                         | quoi cliquer                              |
| `06-verification/`   | tests et couverture réelle                                                | ce qui est prouvé et ce qui ne l'est pas  |

Les fichiers racines `README.md`, `CONTRIBUTING.md` et `SECURITY.md` restent la
porte d'entrée publique du dépôt ; ce `docs/` est la couche détaillée.

## Ordres de lecture selon le profil

**Faire tourner le produit ce soir**
`05-exploitation/prise-en-main.md` → `03-infrastructure/local-dev.md` →
`03-infrastructure/environnement.md` → `03-infrastructure/deploiement.md` →
`05-exploitation/depannage.md`.

**Comprendre l'architecture avant de modifier**
`02-technical/modele-donnees.md` → `02-technical/api-http.md` →
`02-technical/client.md` → `02-technical/access-model.md` →
`02-technical/security.md`.

**Exploiter en production**
`03-infrastructure/checks.md` → `03-infrastructure/notifications.md` →
`03-infrastructure/observabilite.md` → `03-infrastructure/deploiement.md` →
`06-verification/tests-et-couverture.md`.

**Reprendre une décision de conception**
`04-project/decisions.md`, puis `04-project/documentation-ledger.md` pour savoir
ce qui a été corrigé et sur quelle mesure.

**Donner l'outil à quelqu'un d'autre**
`01-product/vision.md` → `01-product/cahier-des-charges.md` →
`05-exploitation/page-statut-lecteur.md` → `05-exploitation/file-qualite.md` →
`05-exploitation/console-plans.md`.

## Les pages

### `01-product/`

- `vision.md` — le problème, la promesse, à qui cela s'adresse, et ce que le
  produit ne cherche pas à devenir.
- `cahier-des-charges.md` — spécification mesurée : identité du dépôt, objectifs
  fonctionnels numérotés, contraintes, annexes chiffrées (paramètres internes,
  limites de débit, paliers).

### `02-technical/`

- `modele-donnees.md` — les 13 tables, colonne par colonne : type, nullabilité,
  défaut, clés étrangères et `onDelete`, tous les index avec leur rationale quand
  le source en porte une, les valeurs exactes de chaque enum, le graphe de
  dépendances, les migrations `0000`→`0007` et la seule donnée semée, puis ce
  que le schéma ne contient volontairement pas.
- `api.md` — vue d'ensemble des surfaces d'API et conventions. La liste exhaustive
  des points de terminaison est dans `api-http.md`.
- `api-http.md` — les 47 points HTTP et les 2 procédures tRPC : garde d'accès,
  clé de rate limit exacte, bornes zod champ par champ, forme de réponse, codes
  d'erreur, et l'audit complet du débit. Le décompte part de 46 sites
  d'enregistrement, dont une boucle qui déclare `/pause` et `/resume` en un seul
  endroit (`server/monitors/routes.ts:540-545`).
- `client.md` — le plan de montage, le contrat `api.ts` validé par zod, appel par
  appel ce que chaque page déclenche, l'inventaire des composants, les tokens
  `@theme inline` avec leurs valeurs hex, l'état réel d'accessibilité, et les
  dépendances sans consommateur.
- `access-model.md` — les quatre sphères d'authentification, le choix d'un régime
  visuel unique, les jetons et la règle d'écriture.
- `security.md` — la protection SSRF, le limiteur à fenêtre fixe, le chiffrement
  AES-256-GCM, les en-têtes, ce qui n'est pas chiffré.
- `status-page-analysis.md` — les mathématiques de la page publique : fenêtrage,
  échantillonnage à 4 320 points, uptime, latence, SSL.
- `qa-support.md` — la technique du file qualité : jeton rapporteur, intake,
  digest, auto-tests.
- `plans-and-billing.md` — les paliers, leur application, l'absence de
  facturation réelle.

### `03-infrastructure/`

- `infra.md` — la page charnière : runtime, heartbeat, boucle interne, fuseau
  horaire, CI, observabilité, dans une version courte. Les détails sont dans les
  pages suivantes.
- `checks.md` — la pipeline de check de bout en bout : les deux déclencheurs, le
  claim atomique à six minutes, la résolution DNS et les 22 CIDR refusés, les
  phases, le plafond de 256 Ko, les redirections, les certificats, les 12
  classifications, la machine à états 3 échecs / 2 réussites, la rétention.
- `notifications.md` — Telegram comme seul canal réel, l'enveloppe chiffrée,
  l'idempotence par index unique, la file de reprise et ses règles.
- `environnement.md` — les **quinze** variables que le code lit, leur site de
  lecture, le comportement en leur absence, la rotation et ses conséquences.
- `observabilite.md` — les **vingt-trois** événements structurés, leur charge
  utile, les seize lignes libres qui dérogent à la convention, et les erreurs
  jamais journalisées.
- `deploiement.md` — la chaîne de build, les trois étages de l'image, le blocage
  de démarrage mesuré puis corrigé, l'image restant à construire, la base au
  premier déploiement, l'obligation HTTPS, le CI et ses trois manques, la
  checklist avant mise en ligne.
- `local-dev.md` — la procédure de développement sur ce poste, Windows compris.

### `04-project/`

- `decisions.md` — les ADR, de 001 à 018, avec leur statut. ADR-017 y est
  explicitement marqué comme reversé par ADR-018, et le texte d'origine reste
  lisible comme histoire.
- `documentation-ledger.md` — le registre des corrections apportées à cette
  documentation, avec pour chacune l'affirmation fausse, la mesure qui l'a
  invalidée et la page touchée. C'est la page à lire pour savoir **faire
  confiance** aux autres.

### `05-exploitation/`

- `prise-en-main.md` — du clone à un moniteur qui produit des données.
- `page-statut-lecteur.md` — ce que voit un visiteur sans compte, et comment
  chaque chiffre de la page publique est calculé.
- `file-qualite.md` — le guide opérationnel du file qualité : jeton rapporteur,
  cycle de ticket, point quotidien, auto-tests.
- `console-plans.md` — la console d'administration des paliers.
- `depannage.md` — par symptôme : ce qu'on observe, la cause probable, comment la
  confirmer, quoi faire.

### `06-verification/`

- `tests-et-couverture.md` — la vérité sur les tests : 23 fichiers, 223 tests
  mesurés, ce qu'ils ne touchent pas (la base, jamais), les handlers HTTP jamais
  exercés, et ce que le CI ne peut donc pas prouver.

### `images/`

Douze captures, nommées `NN-<sujet>.png`, référencées dans le cahier des charges.
Leur légende porte la date de création, et les captures antérieures au régime
clair unique (ADR-018) sont marquées comme non reproductibles à l'identique.

## Import dans Notion

Aucun connecteur Notion n'est configuré dans ce dépôt, et la documentation est
donc livrée en Markdown versionnable. Pour la charger dans Notion :

1. zipper le dossier `docs/` **sans** le modifier ;
2. dans Notion, **Import** → **Text & Markdown** → sélectionner le `.zip` ;
3. Notion recrée l'arborescence `NN-dossier/fichier.md` sous forme de pages
   imbriquées, et le nom ordonné du fichier devient le titre de page.

Le paquet est déjà produit (mesuré le 2026-10-19) :
`uptimepulse-docs-notion.zip`, à la racine du dossier de travail, **au-dessus**
du dépôt — il n'est donc pas versionné et ne part pas avec le code. Il compte
cinquante entrées, dont quarante-deux fichiers : les vingt-sept pages de
`docs/`, les douze images `docs/images/*.png`, et les trois pages racines
`README.md`, `CONTRIBUTING.md`, `SECURITY.md` (les huit entrées restantes sont
les dossiers). La commande exacte, depuis la racine du dépôt :
`py -3 -m zipfile -c ../uptimepulse-docs-notion.zip docs README.md CONTRIBUTING.md SECURITY.md`.
Les séparateurs y sont des `/`, et c'est la raison pour laquelle l'archive est
faite ainsi plutôt qu'avec `Compress-Archive` de PowerShell, qui écrit des
chemins en `\` : beaucoup de lecteurs les interprètent alors comme un seul nom
de fichier, et l'arborescence n'est plus reconstruite. Le dossier `docs/`
arrivant aplati à la racine de l'archive, les images se résolvent depuis
`docs/images/` une fois importées.

Deux limites à connaître d'avance : les liens relatifs entre pages Markdown
(`checks.md`, `../02-technical/api-http.md`) ne sont **pas** réécrits vers les
pages Notion et restent du texte cliquable seulement dans le dépôt ; les images
`images/*.png` sont importées mais ne suivent pas les déplacements de dossier.
Si un rendu fidèle compte, importer `docs/00-sommaire.md` en page-racine et
garder le dépôt comme source des liens.

## Conventions de vérité de cette documentation

- Aucun compte de démonstration, aucun moniteur d'exemple, aucune métrie
  inventée n'est affirmé : le dépôt ne sème que la table `plans`. Ce qui est
  présenté sur la page d'accueil comme aperçu est explicitement étiqueté
  « valeurs de démonstration » par le code, et les pages techniques le
  rappellent.
- Une capacité absente est écrite comme absente (« aucun transport du digest »,
  « pas de script de backup », « `POST /api/qa/tickets/:id/reply` sans limite de
  débit »), jamais remplacée par une formulation vague.
- Un chiffre non mesuré est marqué « non vérifiable depuis le code ».
- Un mécanisme dormant est dit dormant avec son site de réactivation, pas
  supprimé du récit.
- Les variables d'environnement n'apparaissent que par leur nom ; jamais une
  valeur.

Dernière passe de cohérence : 2026-10-19. Les dénombrements cités dans ce
sommaire — quinze variables d'environnement, vingt-trois événements de log,
47 points HTTP, 13 tables, 223 tests — ont été recomptés sur l'arbre de cette
date, chacun avec sa source dans la page concernée.
