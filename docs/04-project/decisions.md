# Décisions et changelog

## ADR-001 — Monolithe MVP

**Statut : accepté.** Une application React/Express/tRPC/Drizzle et un scheduler Heartbeat suffisent pour valider le produit. QStash, Turso, EventBridge et Kubernetes sont différés jusqu’à un besoin mesuré.

## ADR-002 — Base MySQL-compatible managée

**Statut : accepté.** Le runtime Webdev fournit cette base ; le starter Drizzle est déjà configuré pour MySQL. Le cahier mentionne PostgreSQL comme option future, mais il serait incohérent de maintenir deux stockages au MVP.

## ADR-003 — Session applicative email/mot de passe

**Statut : accepté.** Le cahier exige explicitement création de compte et mot de passe. Les sessions sont opaques, hashées et séparées des cookies réservés à la plateforme. OAuth Manus reste une option future, pas une substitution silencieuse.

## ADR-004 — Heartbeat à la minute

**Statut : accepté.** Une seule cadence système sélectionne les monitors dus par `next_check_at`; les plans n’ajoutent pas de crons.

## ADR-005 — Paliers freemium en base, pas en dur

**Statut : remplacé par ADR-013.** Le free initial (3 monitors, 5 minutes minimum, sans billing) a été codé puis décodé : ces valeurs sont désormais des lignes de la table `plans`, éditables depuis la console créateur. Le palier intégré `free` reste une constante de `server/plans/service.ts` pour qu'aucun compte ne puisse être verrouillé par une suppression en base.

## ADR-006 — Contrainte de lookup Node respectée par le client HTTP

**Statut : accepté.** Node appelle un `lookup` personnalisé avec `{all: true}`, ce qui impose de renvoyer un tableau `{address, family}` au callback. L’implémentation initiale renvoyait une chaîne, ce qui faisait échouer **tous** les checks avec `ERR_INVALID_IP_ADDRESS` : le service ne détectait aucune panne parce qu’aucun check ne réussissait. Le hook est couvert par `server/checks/client.test.ts`, qui vérifie aussi qu’un hôte public est bien classé `UP_HTTP_2XX`.

## ADR-007 — Fuseau UTC épinglé sur le pool

**Statut : accepté.** Le pool force `timezone: "Z"` et `SET time_zone = '+00:00'` sur chaque connexion. Voir `docs/03-infrastructure/infra.md` pour le mécanisme et la migration des données existantes.

## ADR-008 — Agrégats d’uptime calculés en SQL

**Statut : accepté.** L’uptime par monitor et l’uptime global sont agrégés par `COUNT`/`SUM`/`AVG` en base. Le chargement de tous les ping logs d’une fenêtre de 30 jours en mémoire rendait la charge du dashboard proportionnelle à l’historique. `max(checkedAt)` est renormalisé car MySQL renvoie un agrégat sur `TIMESTAMP` sous forme de chaîne.

## ADR-009 — Contrats de réponse validés côté client

**Statut : accepté.** Chaque réponse est parsée par son schéma zod dans `shared/contracts.ts`. Le cast non vérifié précédent transformait une dérive de forme serveur en `undefined` silencieux au rendu.

## ADR-010 — Preuve structurée plutôt que capture d’écran

**Statut : accepté.** Le signalement attaché par le navigateur contient la route, le user-agent, la langue, le viewport et les dix dernières erreurs JavaScript et appels API en échec — pas une image. Une capture exigerait une dépendance headless, un stockage d’objets binaires et un chemin de upload, pour un diagnostic que les erreurs déjà présentes donnent mieux. Les tampons sont bornés côté client **et** côté serveur (`qaEvidenceSchema`), la chaîne de requête est retirée de la route parce qu’un jeton peut s’y trouver, et une preuve illisible se réduit à `null` au lieu de casser la file.

## ADR-011 — Suivi client par lien tokenisé en lecture seule

**Statut : accepté.** Le client qui signale ne crée pas de compte : il reçoit `/support/<jeton>`, jeton de 16 octets aléatoires stocké sur le ticket. Seuls les événements marqués `public` s’affichent, la sérialisation est construite champ par champ pour que l’e-mail, l’empreinte et le jeton ne puissent pas fuir par ajout futur, et les réponses générées ne promettent ni date, ni version, ni cause. Le produit n’ayant aucun transport de messagerie, un modèle de réponse est un brouillon que l’opérateur copie ou publie en note publique : c’est ce qui le rend visible sur le lien, sans prétendre un envoi automatique.

## ADR-012 — Un seul type de dossier, idempotence par registre

**Statut : accepté.** Les signalements clients, les anomalies des auto-tests et les notes internes partagent `qa_tickets` : un rapport interne, une chronologie et un suivi à 48 h s’appliquent identiquement aux trois, et une file séparée par source ferait trois suivis. La déduplication passe par `fingerprint` (unique, remis à `null` à la fermeture), et les passes récurrentes par `qa_runs` unique sur `(kind, periodKey)` avec une clé en UTC : plusieurs instances ou un cron externe ne produisent jamais deux points du même jour, et une passe interrompue reste visible par son `finishedAt` nul.

## ADR-013 — Quotas et paliers lus en base, bornés par le schéma

**Statut : accepté.** Les paliers live dans `plans` et s'éditent depuis `/console` (`users.role = 'admin'`), parce qu'un freemium s'ajuste en permanence : un quota codé impose une redeploy à chaque décision commerciale, et le créateur est justement le décideur. Deux garde-fous empêchent l'éditeur de se mordre la queue. D'abord, `minIntervalSeconds` ne peut pas descendre sous 300 s, la borne déjà codée de `intervalSecondsSchema` — l'échantillon des percentiles du statut public est dimensionné à partir de cette valeur, un plan à 60 s ferait silencieusement sauter la bound de 4 032 lignes ; les plans ne peuvent que remonter le minimum. Ensuite, `slug` est immuable pour un palier existant : renommer `free` supprimerait le repli, renommer un autre palier en `free` ferait deux candidats au repli. L'ordre du landing n'est pas `sortOrder` mais le prix, avec `free` épinglé en tête, pour qu'un champ que la console laisse en l'état ne puisse pas désordonner la vitrine. Un compte dont le palier a disparu est réancré sur `planId IS NULL` et reçoit le palier intégré : l'opération d'effacement d'un administrateur ne verrouille jamais un client. Baisser un quota ne supprime pas les monitors existants, il rend le surnombre visible. Aucun paiement en ligne : `priceCents` est un affichage, l'affectation d'un palier payant reste un geste d'administrateur.

## ADR-014 — Assertion de contenu sans faux positif de troncature

**Statut : accepté.** Le mot-clé s'ajoute après un 2xx/3xx et ne remplace jamais le code HTTP. Un `must_contain` absent sur un corps tronqué au cap des 256 Ko rend `unknown`, pas `DOWN` : le texte peut être au-delà du cap, et en faire un incident reproduirait exactement la classe de faux positifs que le module refuse déjà pour les pages volumineuses. `must_not_contain` n'a pas besoin de cette indulgence — trouver la chaîne est une preuve. Un `Content-Type` non textuel n'est pas inspecté. Les deux classifications d'échec (`DOWN_KEYWORD_MISSING`, `DOWN_KEYWORD_PRESENT`) sont déclarées une seule fois et un test rejoue la parité entre la liste zod du contrat, l'enum MySQL et les libellés français.

## ADR-015 — Refus de plans centralisés et compte puis insère transactionnel

**Statut : accepté.** `QUOTA_EXCEEDED` (409), `FEATURE_UNAVAILABLE` (403) et le dépassement de borne (`VALIDATION_ERROR` 400) sortent d'un unique répondeur (`server/plans/respond.ts`) partagé par les routes monitors et notifications : deux surfaces qui refusent la même chose avec deux vocabulaires rendent le client incapable d'expliquer pourquoi. La création d'un moniteur comme d'un canal compte puis insère dans la même transaction, sinon deux requêtes parallèles décrochent le même dernier slot libre et le quota devient décoratif. Le garde d'accès administrateur `requireAdmin` est unit-testé (401 sans session, 403 pour un rôle `user`, passe pour `admin`, une seule lecture de session par requête) plutôt que présumé correct, parce qu'il ouvre l'écriture des paliers.

## ADR-016 — Un seul compte opérable, les clients sans compte

**Statut : accepté.** L'authentification est verrouillée sur l'adresse du créateur (`OWNER_EMAIL`, surcharge par `UPTIMEPULSE_OWNER_EMAIL`), l'inscription refuse toute autre adresse avant le calcul du hash, et `requireUser` répond `403 ACCESS_RESERVED` pour toute session qui ne résout pas cette adresse. Le produit se vend à des propriétaires de site qui veulent savoir si leur boutique tourne — pas à une équipe qui a besoin d'un login partagé : un compte par visiteur introduirait la gestion d'utilisateurs, les e-mails de réinitialisation et le support associés, alors que `/status/:slug` et `/support/:token` répondent au même besoin sans état. Le verrou est serveur (masquer des liens côté client ne protège rien) et l'adresse est comparée après la normalisation de `emailSchema`, sinon `" Email "` contournerait le garde. Le compte réclamé porte `role = 'admin'` : l'administrateur ne peut pas dériver vers un inconnu, parce que personne d'autre ne peut s'inscrire. Les comptes de démonstration antérieurs restent en base mais perdent l'accès — c'est le comportement voulu, pas une régression.

## ADR-017 — Deux régimes visuels dérivés de la route

**Statut : accepté.** `/`, `/status/:slug` et `/support/:token` rendent en clair, `/dashboard`, `/monitors/:id`, `/settings`, `/qa`, `/console`, `/login` et `/register` restent sombres, et c'est `client/src/App.tsx` qui le déduit du chemin — pas un réglage utilisateur, pas un `localStorage`. Un lecteur qui vérifie l'état de son commerce et un opérateur qui pilote une file de checks n'ont pas la même tolérance à la densité : imposer le thème de l'un à l'autre dégrade les deux. Le mécanisme est unique : `:root` porte les jetons clairs, `.dark` les mêmes noms en valeurs sombres, et `@theme inline` les publie comme utilitaires Tailwind (`bg-page`, `bg-surface-2`, `text-ink-soft`, `border-line`, `bg-brand`, `text-state-up|down|warn`). La contrepartie est une règle d'écriture : un composant monté sur les deux régimes — `Modal`, `StatusBadge`, `ReportIssueDialog`, `QaChips`, `Skeleton`, `ErrorBoundary` — n'a pas droit à une couleur littérale, sinon il devient lisible dans un régime et illisible dans l'autre. Les polices sont déclarées et réellement chargées (`DM Sans`, `Space Grotesk` pour les titres, `JetBrains Mono` pour les métriques tabulaires) : la version précédente annonçait Inter sans le charger. Aucune dépendance d'animation n'a été ajoutée — les micro-animations sont des keyframes CSS locaux, tous couverts par `prefers-reduced-motion`.

## Changelog

- 2026-10-10 : accès à opérateur unique et surfaces clientes en clair — verrou d'authentification sur l'adresse du créateur (`REGISTRATION_CLOSED`, `ACCESS_RESERVED`), landing, analyse publique et suivi de signalement rendus en thème clair par régime dérivé de la route, verdict en une phrase et liste de problèmes déduits du seul payload mesuré sur `/status/:slug`, progression d'étape lisible sur `/support/:token`, jetons sémantiques et polices chargées.
- 2026-10-09 : modèle freemium et vérification de contenu — paliers en base éditables depuis `/console` (overview, création/édition, affectation de comptes), quotas et limites appliqués côté serveur par le plan effectif, assertion de contenu avec classifications dédiées, bande tarifs du landing branchée sur `/api/plans`.
- 2026-10-09 : module qualité et support client — file de tickets avec preuves capturées par le navigateur, rapport interne et réponses françaises générés, sept invariants rejoués toutes les 15 minutes, point quotidien idempotent, lien de suivi client en lecture seule, poste de traitement `/qa`.

- 2026-10-05 : corrections du hook `lookup` DNS et du fuseau du pool MySQL, qui rendaient le produit non fonctionnel ; gestionnaire d’erreurs Express, pool de checks borné, agrégats SQL, pagination, contrats zod client, accessibilité du dialogue et du menu ; suppression du code mort ; ESLint ; Dockerfile multi-stage non-root ; CI enrichie ; documentation du développement local.
- 2026-09-30 : initialisation du projet géré, direction Signal clair, documentation fondation et contrat de routes créés.
