# Modèle de données — référence de schéma

Source de vérité exclusive : `shared/db/schema.ts` (définitions Drizzle) et
les migrations SQL réelles `shared/db/0000…0007.sql` + `shared/db/meta/`.
Aucune affirmation ici ne vient d'ailleurs. Quand une information n'est pas
lisible dans ces fichiers, la mention « non déterminé depuis le code » est
écrite.

Le schéma définit **treize tables** : `plans`, `users`, `user_credentials`,
`sessions`, `monitors`, `ping_logs`, `incidents`, `notification_channels`,
`notification_deliveries`, `status_pages`, `qa_tickets`, `qa_ticket_events`,
`qa_runs` (`shared/db/schema.ts:18,43,58,76,106,168,204,245,266,303,335,385,419`).

---

## 1. Convention d'écriture SQL

Les **colonnes sont en `camelCase`**, jamais en `snake_case` : chaque
définition Drizzle passe le nom camelCase comme nom SQL réel, par exemple
`varchar("errorMessage", …)` (`shared/db/schema.ts:186`) ou
`int("intervalSeconds")` (`shared/db/schema.ts:115`). Seuls les **noms de
tables** sont en `snake_case` (`mysqlTable("user_credentials", …)`,
`shared/db/schema.ts:59`). Le générateur entoure chaque identifiant d'accents
graves dans les DDL publiés : `` `checkedAt` ``, `` `nextCheckAt` ``,
`` `emailNormalized` `` (`shared/db/0001_magenta_microbe.sql:27,67,85`).

Conséquence en console MySQL : recopier un identifiant `snake_case` renvoie
`Unknown column`.

```sql
-- Correct : camelCase, entre accents graves (ou sans, si non réservé)
SELECT `m`.`nextCheckAt`, `p`.`checkedAt`
FROM `monitors` AS `m`
JOIN `ping_logs` AS `p` ON `p`.`monitorId` = `m`.`id`;
-- les identifiants viennent de shared/db/0001_magenta_microbe.sql:27,61

-- Incorrect : snake_case recopié d'une doc générique → Unknown column
SELECT m.next_check_at FROM monitors m;
```

La même convention vaut pour les valeurs de `CHECK`/colonnes calculées :
aucune colonne `snake_case` n'existe dans les 8 migrations lues.

---

## 2. Les tables

Légende des tableaux : type MySQL réel déduit du type Drizzle et confirmé par
le DDL ; « NULL » = nullabilité ; défaut `—` = aucun défaut SQL. Les booléens
sont déclarés `boolean` dans les DDL (`0001_magenta_microbe.sql:23`), alias
MySQL de `TINYINT(1)`. Les timestamps sont `timestamp`, défaut `(now())`
quand `defaultNow()`, et `ON UPDATE CURRENT_TIMESTAMP` quand `onUpdateNow()`
(`0000_initial_users.sql:9`).

### 2.1 `plans` — paliers freemium éditables à chaud

Rôle : quotas du modèle freemium, éditables sans redéploiement ; un
`planId` null retombe sur la ligne `free` (`shared/db/schema.ts:13-17`).
Définition `schema.ts:18-41`, DDL `0007_clever_kulan_gath.sql:1-18`.

| Colonne              | Type MySQL              | NULL | Défaut                  | FK / onDelete      |
| -------------------- | ----------------------- | ---- | ----------------------- | ------------------ |
| `id`                 | `INT AUTO_INCREMENT` PK | non  | auto                    | — (`schema.ts:21`) |
| `slug`               | `VARCHAR(40)`           | non  | —                       | — (`schema.ts:22`) |
| `name`               | `VARCHAR(60)`           | non  | —                       | — (`schema.ts:23`) |
| `maxMonitors`        | `INT`                   | non  | `3`                     | — (`schema.ts:24`) |
| `minIntervalSeconds` | `INT`                   | non  | `300`                   | — (`schema.ts:25`) |
| `maxTimeoutMs`       | `INT`                   | non  | `30000`                 | — (`schema.ts:26`) |
| `maxChannels`        | `INT`                   | non  | `1`                     | — (`schema.ts:27`) |
| `allowKeyword`       | `TINYINT(1)`            | non  | `false`                 | — (`schema.ts:28`) |
| `priceCents`         | `INT`                   | non  | `0`                     | — (`schema.ts:29`) |
| `trialDays`          | `INT`                   | non  | `0`                     | — (`schema.ts:30`) |
| `isPublic`           | `TINYINT(1)`            | non  | `true`                  | — (`schema.ts:32`) |
| `sortOrder`          | `INT`                   | non  | `0`                     | — (`schema.ts:33`) |
| `createdAt`          | `TIMESTAMP`             | non  | `(now())`               | — (`schema.ts:34`) |
| `updatedAt`          | `TIMESTAMP`             | non  | `(now())` + `ON UPDATE` | — (`schema.ts:35`) |

### 2.2 `users` — comptes

Rôle : comptes authentifiés, un rôle `user`/`admin`, rattachés à un palier.
Définition `schema.ts:43-56`, DDL `0000_initial_users.sql:1-13` + colonnes
ajoutées `0007_clever_kulan_gath.sql:23-24,26`.

| Colonne        | Type MySQL              | NULL | Défaut                  | FK / onDelete                                                   |
| -------------- | ----------------------- | ---- | ----------------------- | --------------------------------------------------------------- |
| `id`           | `INT AUTO_INCREMENT` PK | non  | auto                    | — (`schema.ts:44`)                                              |
| `openId`       | `VARCHAR(64)` UNIQUE    | non  | —                       | — (`schema.ts:45`, `0000.sql:12`)                               |
| `name`         | `TEXT`                  | oui  | —                       | — (`schema.ts:46`)                                              |
| `email`        | `VARCHAR(320)`          | oui  | —                       | — (`schema.ts:47`)                                              |
| `loginMethod`  | `VARCHAR(64)`           | oui  | —                       | — (`schema.ts:48`)                                              |
| `role`         | `ENUM('user','admin')`  | non  | `'user'`                | — (`schema.ts:49`)                                              |
| `planId`       | `INT`                   | oui  | —                       | `plans.id`, `set null` (`schema.ts:50`, `0007.sql:26`)          |
| `trialEndsAt`  | `TIMESTAMP`             | oui  | —                       | — ; null = essai consommé ou jamais démarré (`schema.ts:51-52`) |
| `createdAt`    | `TIMESTAMP`             | non  | `(now())`               | — (`schema.ts:53`)                                              |
| `updatedAt`    | `TIMESTAMP`             | non  | `(now())` + `ON UPDATE` | — (`schema.ts:54`)                                              |
| `lastSignedIn` | `TIMESTAMP`             | non  | `(now())`               | — (`schema.ts:55`)                                              |

### 2.3 `user_credentials` — identifiants mot de passe

Rôle : pair e-mail normalisé / hash de mot de passe, 1-ligne-pour-1-compte
(`userId` est la PK). Définition `schema.ts:58-74`, DDL
`0001_magenta_microbe.sql:82-90`.

| Colonne           | Type MySQL     | NULL | Défaut                  | FK / onDelete                                             |
| ----------------- | -------------- | ---- | ----------------------- | --------------------------------------------------------- |
| `userId`          | `INT` PK       | non  | —                       | `users.id`, `cascade` (`schema.ts:61-63`, `0001.sql:100`) |
| `emailNormalized` | `VARCHAR(320)` | non  | —                       | — (`schema.ts:64`)                                        |
| `passwordHash`    | `VARCHAR(255)` | non  | —                       | — (`schema.ts:65`)                                        |
| `createdAt`       | `TIMESTAMP`    | non  | `(now())`               | — (`schema.ts:66`)                                        |
| `updatedAt`       | `TIMESTAMP`    | non  | `(now())` + `ON UPDATE` | — (`schema.ts:67`)                                        |

### 2.4 `sessions` — sessions portées par jeton

Rôle : jetons de session stockés par hash, avec expiration et révocation.
Définition `schema.ts:76-95`, DDL `0001_magenta_microbe.sql:71-80`.

| Colonne     | Type MySQL              | NULL | Défaut    | FK / onDelete                                            |
| ----------- | ----------------------- | ---- | --------- | -------------------------------------------------------- |
| `id`        | `INT AUTO_INCREMENT` PK | non  | auto      | — (`schema.ts:79`)                                       |
| `tokenHash` | `VARCHAR(128)` UNIQUE   | non  | —         | — (`schema.ts:80`, `0001.sql:79`)                        |
| `userId`    | `INT`                   | non  | —         | `users.id`, `cascade` (`schema.ts:81-83`, `0001.sql:99`) |
| `expiresAt` | `TIMESTAMP`             | non  | —         | — (`schema.ts:84`)                                       |
| `revokedAt` | `TIMESTAMP`             | oui  | —         | — (`schema.ts:85`)                                       |
| `createdAt` | `TIMESTAMP`             | non  | `(now())` | — (`schema.ts:86`)                                       |

Pas de `updatedAt` dans cette table (`schema.ts:76-95`).

### 2.5 `monitors` — services surveillés

Rôle : sondes HTTP/HTTPS planifiées par l'ordonnanceur
(`api.md:5`), une ligne = une URL vérifiée à intervalle borné.
Définition `schema.ts:106-150`, DDL `0001_magenta_microbe.sql:16-32` +
`0004_loving_rhodey.sql:1-3` (SSL) + `0007_clever_kulan_gath.sql:21-22`
(mot-clé).

| Colonne                | Type MySQL                                | NULL | Défaut                  | FK / onDelete                                                   |
| ---------------------- | ----------------------------------------- | ---- | ----------------------- | --------------------------------------------------------------- |
| `id`                   | `INT AUTO_INCREMENT` PK                   | non  | auto                    | — (`schema.ts:109`)                                             |
| `userId`               | `INT`                                     | non  | —                       | `users.id`, `cascade` (`schema.ts:110-112`, `0001.sql:94`)      |
| `name`                 | `VARCHAR(120)`                            | non  | —                       | — (`schema.ts:113`)                                             |
| `url`                  | `VARCHAR(2048)`                           | non  | —                       | — (`schema.ts:114`)                                             |
| `intervalSeconds`      | `INT`                                     | non  | `300`                   | — (`schema.ts:115`)                                             |
| `timeoutMs`            | `INT`                                     | non  | `10000`                 | — (`schema.ts:116`)                                             |
| `keyword`              | `VARCHAR(160)`                            | oui  | —                       | — ; null désactive le contrôle de contenu (`schema.ts:117-121`) |
| `keywordMode`          | `ENUM('must_contain','must_not_contain')` | non  | `'must_contain'`        | — (`schema.ts:122-124`, `0007.sql:22`)                          |
| `enabled`              | `TINYINT(1)`                              | non  | `true`                  | — (`schema.ts:125`)                                             |
| `currentStatus`        | `ENUM('UNKNOWN','UP','DOWN','PAUSED')`    | non  | `'UNKNOWN'`             | — (`schema.ts:126-128`)                                         |
| `consecutiveFailures`  | `INT`                                     | non  | `0`                     | — (`schema.ts:129`)                                             |
| `consecutiveSuccesses` | `INT`                                     | non  | `0`                     | — (`schema.ts:130`)                                             |
| `nextCheckAt`          | `TIMESTAMP`                               | non  | `(now())`               | — (`schema.ts:131`)                                             |
| `lastCheckAt`          | `TIMESTAMP`                               | oui  | —                       | — (`schema.ts:132`)                                             |
| `sslIssuer`            | `VARCHAR(255)`                            | oui  | —                       | — (`schema.ts:133`, `0004.sql:1`)                               |
| `sslSubject`           | `VARCHAR(255)`                            | oui  | —                       | — (`schema.ts:134`, `0004.sql:2`)                               |
| `sslValidTo`           | `TIMESTAMP`                               | oui  | —                       | — (`schema.ts:135`, `0004.sql:3`)                               |
| `createdAt`            | `TIMESTAMP`                               | non  | `(now())`               | — (`schema.ts:136`)                                             |
| `updatedAt`            | `TIMESTAMP`                               | non  | `(now())` + `ON UPDATE` | — (`schema.ts:137`)                                             |

Le mot-clé est comparé sans sensibilité à la casse sur les 256 premiers KiB
du corps de réponse (`schema.ts:118-120`).

### 2.6 `ping_logs` — relevés de vérification

Rôle : un relevé par exécution de check ; la table la plus volumineuse du
schéma. Définition `schema.ts:168-195`, DDL
`0001_magenta_microbe.sql:59-69` + `0004_loving_rhodey.sql:4-7`.

| Colonne          | Type MySQL              | NULL | Défaut           | FK / onDelete                                                 |
| ---------------- | ----------------------- | ---- | ---------------- | ------------------------------------------------------------- |
| `id`             | `INT AUTO_INCREMENT` PK | non  | auto             | — (`schema.ts:171`)                                           |
| `monitorId`      | `INT`                   | non  | —                | `monitors.id`, `cascade` (`schema.ts:172-174`, `0001.sql:98`) |
| `statusCode`     | `INT`                   | oui  | —                | — (`schema.ts:175`)                                           |
| `responseTimeMs` | `INT`                   | oui  | —                | — (`schema.ts:176`)                                           |
| `dnsMs`          | `INT`                   | oui  | —                | — (`schema.ts:177`, `0004.sql:4`)                             |
| `tcpMs`          | `INT`                   | oui  | —                | — (`schema.ts:178`, `0004.sql:5`)                             |
| `tlsMs`          | `INT`                   | oui  | —                | — (`schema.ts:179`, `0004.sql:6`)                             |
| `ttfbMs`         | `INT`                   | oui  | —                | — (`schema.ts:180`, `0004.sql:7`)                             |
| `isUp`           | `TINYINT(1)`            | non  | — (aucun défaut) | — (`schema.ts:181`)                                           |
| `classification` | `ENUM` (12 valeurs, §4) | non  | — (aucun défaut) | — (`schema.ts:182-185`, `0007.sql:20`)                        |
| `errorMessage`   | `VARCHAR(500)`          | oui  | —                | — (`schema.ts:186`)                                           |
| `checkedAt`      | `TIMESTAMP`             | non  | `(now())`        | — (`schema.ts:187`)                                           |

Pas de `updatedAt` : une ligne de log n'est jamais modifiée
(`schema.ts:168-195`).

### 2.7 `incidents` — interruptions

Rôle : cycle de vie d'une panne (suspecte → confirmée → résolue).
Définition `schema.ts:204-231`, DDL `0001_magenta_microbe.sql:1-14`.

| Colonne            | Type MySQL                               | NULL | Défaut                  | FK / onDelete                                                   |
| ------------------ | ---------------------------------------- | ---- | ----------------------- | --------------------------------------------------------------- |
| `id`               | `INT AUTO_INCREMENT` PK                  | non  | auto                    | — (`schema.ts:207`)                                             |
| `monitorId`        | `INT`                                    | non  | —                       | `monitors.id`, `cascade` (`schema.ts:208-210`, `0001.sql:92`)   |
| `startedAt`        | `TIMESTAMP`                              | non  | — (aucun défaut)        | — (`schema.ts:211`)                                             |
| `confirmedAt`      | `TIMESTAMP`                              | oui  | —                       | — (`schema.ts:212`)                                             |
| `resolvedAt`       | `TIMESTAMP`                              | oui  | —                       | — (`schema.ts:213`)                                             |
| `durationSeconds`  | `INT`                                    | oui  | —                       | — (`schema.ts:214`)                                             |
| `status`           | `ENUM('suspect','confirmed','resolved')` | non  | `'suspect'`             | — (`schema.ts:215-217`)                                         |
| `reason`           | `VARCHAR(500)`                           | oui  | —                       | — (`schema.ts:218`)                                             |
| `lastFailureLogId` | `INT`                                    | oui  | —                       | `ping_logs.id`, `set null` (`schema.ts:219-221`, `0001.sql:93`) |
| `createdAt`        | `TIMESTAMP`                              | non  | `(now())`               | — (`schema.ts:222`)                                             |
| `updatedAt`        | `TIMESTAMP`                              | non  | `(now())` + `ON UPDATE` | — (`schema.ts:223`)                                             |

### 2.8 `notification_channels` — canaux d'alerte

Rôle : canaux de notification par utilisateur, configuration chiffrée au
repos. Définition `schema.ts:245-264`, DDL
`0001_magenta_microbe.sql:34-43`.

| Colonne                  | Type MySQL              | NULL | Défaut                  | FK / onDelete                                              |
| ------------------------ | ----------------------- | ---- | ----------------------- | ---------------------------------------------------------- |
| `id`                     | `INT AUTO_INCREMENT` PK | non  | auto                    | — (`schema.ts:248`)                                        |
| `userId`                 | `INT`                   | non  | —                       | `users.id`, `cascade` (`schema.ts:249-251`, `0001.sql:95`) |
| `type`                   | `ENUM('telegram')`      | non  | — (aucun défaut)        | — (`schema.ts:252`)                                        |
| `configurationEncrypted` | `TEXT`                  | non  | —                       | — (`schema.ts:253`)                                        |
| `enabled`                | `TINYINT(1)`            | non  | `true`                  | — (`schema.ts:254`)                                        |
| `createdAt`              | `TIMESTAMP`             | non  | `(now())`               | — (`schema.ts:255`)                                        |
| `updatedAt`              | `TIMESTAMP`             | non  | `(now())` + `ON UPDATE` | — (`schema.ts:256`)                                        |

### 2.9 `notification_deliveries` — files d'envoi

Rôle : une ligne par (incident, canal, type) à livrer, avec retries.
Définition `schema.ts:266-301`, DDL `0001_magenta_microbe.sql:45-57` +
contrainte unique `0002_overconfident_wraith.sql:1`.

| Colonne      | Type MySQL                          | NULL | Défaut                  | FK / onDelete                                                              |
| ------------ | ----------------------------------- | ---- | ----------------------- | -------------------------------------------------------------------------- |
| `id`         | `INT AUTO_INCREMENT` PK             | non  | auto                    | — (`schema.ts:269`)                                                        |
| `incidentId` | `INT`                               | non  | —                       | `incidents.id`, `cascade` (`schema.ts:270-272`, `0001.sql:96`)             |
| `channelId`  | `INT`                               | non  | —                       | `notification_channels.id`, `cascade` (`schema.ts:273-275`, `0001.sql:97`) |
| `type`       | `ENUM('failure','recovery','test')` | non  | — (aucun défaut)        | — (`schema.ts:276`)                                                        |
| `status`     | `ENUM('pending','sent','failed')`   | non  | `'pending'`             | — (`schema.ts:277-279`)                                                    |
| `attempts`   | `INT`                               | non  | `0`                     | — (`schema.ts:280`)                                                        |
| `lastError`  | `VARCHAR(500)`                      | oui  | —                       | — (`schema.ts:281`)                                                        |
| `sentAt`     | `TIMESTAMP`                         | oui  | —                       | — (`schema.ts:282`)                                                        |
| `createdAt`  | `TIMESTAMP`                         | non  | `(now())`               | — (`schema.ts:283`)                                                        |
| `updatedAt`  | `TIMESTAMP`                         | non  | `(now())` + `ON UPDATE` | — (`schema.ts:284`)                                                        |

### 2.10 `status_pages` — pages de statut publiques

Rôle : une page publique par utilisateur (`userId` unique), adressée par
slug. Définition `schema.ts:303-314`, DDL
`0005_spooky_lake.sql:1-14`.

| Colonne       | Type MySQL              | NULL | Défaut                  | FK / onDelete                                                 |
| ------------- | ----------------------- | ---- | ----------------------- | ------------------------------------------------------------- |
| `id`          | `INT AUTO_INCREMENT` PK | non  | auto                    | — (`schema.ts:304`)                                           |
| `userId`      | `INT` UNIQUE            | non  | —                       | `users.id`, `cascade` (`schema.ts:305-308`, `0005.sql:10,14`) |
| `slug`        | `VARCHAR(64)` UNIQUE    | non  | —                       | — (`schema.ts:309`, `0005.sql:11`)                            |
| `title`       | `VARCHAR(120)`          | non  | —                       | — (`schema.ts:310`)                                           |
| `description` | `VARCHAR(500)`          | oui  | —                       | — (`schema.ts:311`)                                           |
| `createdAt`   | `TIMESTAMP`             | non  | `(now())`               | — (`schema.ts:312`)                                           |
| `updatedAt`   | `TIMESTAMP`             | non  | `(now())` + `ON UPDATE` | — (`schema.ts:313`)                                           |

Aucune table de liaison page↔monitors : la page est par compte, pas par
service (`schema.ts:303-314`).

### 2.11 `qa_tickets` — dossiers qualité/support

Rôle : signalement client et anomalie auto-détectée partagent la même table,
donc le même cycle de vie et le même digest (`schema.ts:316-320`).
Définition `schema.ts:335-383`, DDL `0006_needy_lily_hollister.sql:26-55`.

| Colonne         | Type MySQL                         | NULL | Défaut                  | FK / onDelete                                                                                              |
| --------------- | ---------------------------------- | ---- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`            | `INT AUTO_INCREMENT` PK            | non  | auto                    | — (`schema.ts:338`)                                                                                        |
| `userId`        | `INT`                              | non  | —                       | `users.id`, `cascade` ; anomalie système → compte QA (`schema.ts:339-342`, `0006.sql:54`)                  |
| `source`        | `ENUM('client','auto','internal')` | non  | — (aucun défaut)        | — (`schema.ts:343`)                                                                                        |
| `kind`          | `ENUM('bug','behaviour','ux')`     | non  | `'bug'`                 | — (`schema.ts:344`)                                                                                        |
| `severity`      | `ENUM('P1','P2','P3','P4')`        | non  | `'P3'`                  | — (`schema.ts:345-347`)                                                                                    |
| `status`        | `ENUM` (6 valeurs, §4)             | non  | `'new'`                 | — (`schema.ts:348`)                                                                                        |
| `title`         | `VARCHAR(160)`                     | non  | —                       | — (`schema.ts:349`)                                                                                        |
| `clientMessage` | `TEXT`                             | non  | —                       | — ; verbatim jamais réécrit (`schema.ts:350-351`)                                                          |
| `steps`         | `TEXT`                             | oui  | —                       | — (`schema.ts:352`)                                                                                        |
| `expected`      | `TEXT`                             | oui  | —                       | — (`schema.ts:353`)                                                                                        |
| `actual`        | `TEXT`                             | oui  | —                       | — (`schema.ts:354`)                                                                                        |
| `reporterName`  | `VARCHAR(120)`                     | oui  | —                       | — (`schema.ts:355`)                                                                                        |
| `reporterEmail` | `VARCHAR(320)`                     | oui  | —                       | — (`schema.ts:356`)                                                                                        |
| `reporterToken` | `VARCHAR(64)` UNIQUE               | oui  | —                       | — ; jeton de suivi, null pour tickets internes (`schema.ts:357-358`, `0006.sql:49`)                        |
| `pageUrl`       | `VARCHAR(2048)`                    | oui  | —                       | — (`schema.ts:359`)                                                                                        |
| `monitorId`     | `INT`                              | oui  | —                       | `monitors.id`, `set null` (`schema.ts:360-362`, `0006.sql:55`)                                             |
| `evidence`      | `TEXT`                             | oui  | —                       | — ; contexte sérialisé, borné côté serveur (`schema.ts:363-364`)                                           |
| `fingerprint`   | `VARCHAR(64)` UNIQUE               | oui  | —                       | — ; clé de déduplication des anomalies, remise à null à la résolution (`schema.ts:365-370`, `0006.sql:50`) |
| `resolvedAt`    | `TIMESTAMP`                        | oui  | —                       | — (`schema.ts:371`)                                                                                        |
| `createdAt`     | `TIMESTAMP`                        | non  | `(now())`               | — (`schema.ts:372`)                                                                                        |
| `updatedAt`     | `TIMESTAMP`                        | non  | `(now())` + `ON UPDATE` | — (`schema.ts:373`)                                                                                        |

### 2.12 `qa_ticket_events` — chronologie des tickets

Rôle : journal append-only des échanges et transitions, à deux visibilités.
Définition `schema.ts:385-408`, DDL `0006_needy_lily_hollister.sql:14-24`.

| Colonne      | Type MySQL                          | NULL | Défaut           | FK / onDelete                                                         |
| ------------ | ----------------------------------- | ---- | ---------------- | --------------------------------------------------------------------- |
| `id`         | `INT AUTO_INCREMENT` PK             | non  | auto             | — (`schema.ts:388`)                                                   |
| `ticketId`   | `INT`                               | non  | —                | `qa_tickets.id`, `cascade` (`schema.ts:389-391`, `0006.sql:53`)       |
| `author`     | `ENUM('client','support','system')` | non  | — (aucun défaut) | — (`schema.ts:392`)                                                   |
| `visibility` | `ENUM('public','internal')`         | non  | `'public'`       | — ; `internal` ne sort jamais de l'UI opérateur (`schema.ts:393-396`) |
| `body`       | `TEXT`                              | non  | —                | — (`schema.ts:397`)                                                   |
| `fromStatus` | `ENUM` (6 valeurs, §4)              | oui  | —                | — (`schema.ts:398`)                                                   |
| `toStatus`   | `ENUM` (6 valeurs, §4)              | oui  | —                | — (`schema.ts:399`)                                                   |
| `createdAt`  | `TIMESTAMP`                         | non  | `(now())`        | — (`schema.ts:400`)                                                   |

Pas d'`updatedAt` : les événements ne sont pas modifiés (`schema.ts:385-408`).

### 2.13 `qa_runs` — registre d'idempotence des jobs QA

Rôle : revendication par `INSERT` unique `(kind, periodKey)` ; une passe
crashée garde `finishedAt` null et reste visible (`schema.ts:413-418`).
Définition `schema.ts:419-437`, DDL `0006_needy_lily_hollister.sql:1-12`.

| Colonne      | Type MySQL                         | NULL | Défaut           | FK / onDelete       |
| ------------ | ---------------------------------- | ---- | ---------------- | ------------------- |
| `id`         | `INT AUTO_INCREMENT` PK            | non  | auto             | — (`schema.ts:422`) |
| `kind`       | `ENUM('self_test','daily_digest')` | non  | — (aucun défaut) | — (`schema.ts:423`) |
| `periodKey`  | `VARCHAR(32)`                      | non  | —                | — (`schema.ts:424`) |
| `status`     | `ENUM('ok','attention','failed')`  | non  | `'ok'`           | — (`schema.ts:425`) |
| `summary`    | `VARCHAR(500)`                     | oui  | —                | — (`schema.ts:426`) |
| `detail`     | `TEXT`                             | oui  | —                | — (`schema.ts:427`) |
| `startedAt`  | `TIMESTAMP`                        | non  | `(now())`        | — (`schema.ts:428`) |
| `finishedAt` | `TIMESTAMP`                        | oui  | —                | — (`schema.ts:429`) |

`qa_runs` est la seule table sans lien FK avec le reste du graphe
(`schema.ts:419-437`).

---

## 3. Index

Tous les index sont déclarés dans la 3e argument des `mysqlTable` ; le DDL
confirmé est cité. Le motif est recopié quand `schema.ts` le documente, sinon
la mention « motif non documenté dans le code » s'applique.

| Table                                             | Index                                                                                                                           | Colonnes                                     | Unique | Motif                                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plans`                                           | `plans_slug_unique` (`schema.ts:38`, `0007.sql:17`)                                                                             | `slug`                                       | oui    | unicité du slug de palier ; motif non documenté                                                                                                                                                                    |
| `plans`                                           | `plans_sort_order_idx` (`schema.ts:39`, `0007.sql:25`)                                                                          | `sortOrder`                                  | non    | tri d'affichage ; motif non documenté                                                                                                                                                                              |
| `users`                                           | `users_openId_unique` (dérivé de `.unique()`, `schema.ts:45`, `0000.sql:12`)                                                    | `openId`                                     | oui    | lookup d'identité à l'ouverture de session ; motif non documenté                                                                                                                                                   |
| `user_credentials`                                | `user_credentials_email_unique` (`schema.ts:70-72`, `0001.sql:89`)                                                              | `emailNormalized`                            | oui    | un compte par e-mail ; motif non documenté                                                                                                                                                                         |
| `sessions`                                        | `sessions_token_hash_unique` (`schema.ts:89`, `0001.sql:79`)                                                                    | `tokenHash`                                  | oui    | résolution session→compte par jeton ; motif non documenté                                                                                                                                                          |
| `sessions`                                        | `sessions_user_expiry_idx` (`schema.ts:90-93`, `0001.sql:107`)                                                                  | `userId`, `expiresAt`                        | non    | motif non documenté dans le code                                                                                                                                                                                   |
| `monitors`                                        | `monitors_owner_due_idx` (`schema.ts:140-144`, `0001.sql:102`)                                                                  | `userId`, `enabled`, `nextCheckAt`           | non    | sélection des monitors dus par compte ; l'ordonnanceur sélectionne les monitors dus (`api.md:5`) ; motif non commenté dans `schema.ts`                                                                             |
| `monitors`                                        | `monitors_enabled_next_check_idx` (`schema.ts:145-148`, `0001.sql:103`)                                                         | `enabled`, `nextCheckAt`                     | non    | idem, sans filtre compte ; motif non commenté                                                                                                                                                                      |
| `ping_logs`                                       | `ping_logs_monitor_checked_idx` (`schema.ts:190-193`, `0001.sql:106`)                                                           | `monitorId`, `checkedAt` — **pas de `DESC`** | non    | lectures d'historique triées en SQL ; MySQL parcourt un B-tree à rebours (`api.md:56-59`)                                                                                                                          |
| `incidents`                                       | `incidents_monitor_status_idx` (`schema.ts:226-229`, `0001.sql:101`)                                                            | `monitorId`, `status`                        | non    | motif non documenté dans le code                                                                                                                                                                                   |
| `notification_channels`                           | `notification_channels_user_type_idx` (`schema.ts:259-262`, `0001.sql:104`)                                                     | `userId`, `type`                             | non    | motif non documenté                                                                                                                                                                                                |
| `notification_deliveries`                         | `notification_deliveries_incident_channel_idx` (`schema.ts:287-290`, `0001.sql:105`)                                            | `incidentId`, `channelId`                    | non    | motif non documenté                                                                                                                                                                                                |
| `notification_deliveries`                         | `..._incident_channel_type_unique` (`schema.ts:291-293`, `0002.sql:1`)                                                          | `incidentId`, `channelId`, `type`            | oui    | un seul envoi par (incident, canal, type) ; motif implicite, non commenté                                                                                                                                          |
| `notification_deliveries`                         | `notification_deliveries_retry_queue_idx` (`schema.ts:294-299`, `0003.sql:1`)                                                   | `status`, `createdAt`                        | non    | **documenté** : la passe de retry balaie les lignes `failed`/`pending` à chaque tick ; sans cet index ce balayage était un full scan minute par minute (`schema.ts:294-295`)                                       |
| `status_pages`                                    | `status_pages_userId_unique`, `status_pages_slug_unique` (`.unique()` colonne, `schema.ts:306,309`, `0005.sql:10-11`)           | `userId` ; `slug`                            | oui    | une page par compte, slug public unique ; motif non documenté                                                                                                                                                      |
| `qa_tickets`                                      | `qa_tickets_owner_status_idx` (`schema.ts:376-379`, `0006.sql:57`)                                                              | `userId`, `status`                           | non    | motif non documenté                                                                                                                                                                                                |
| `qa_tickets`                                      | `qa_tickets_open_idx` (`schema.ts:380`, `0006.sql:58`)                                                                          | `status`, `createdAt`                        | non    | motif non documenté                                                                                                                                                                                                |
| `qa_tickets`                                      | `qa_tickets_source_idx` (`schema.ts:381-382`, `0006.sql:59`)                                                                    | `source`, `createdAt`                        | non    | motif non documenté                                                                                                                                                                                                |
| `qa_tickets`                                      | `qa_tickets_reporterToken_unique`, `qa_tickets_fingerprint_unique` (`.unique()` colonne, `schema.ts:358,370`, `0006.sql:49-50`) | `reporterToken` ; `fingerprint`              | oui    | `fingerprint` **documenté** : une anomalie persistante met à jour un seul ticket au lieu d'en ouvrir un neuf à chaque passe ; la remise à null à la résolution rend une réapparition visible (`schema.ts:365-369`) |
| `qa_ticket_events`                                | `qa_ticket_events_ticket_created_idx` (`schema.ts:403-406`, `0006.sql:56`)                                                      | `ticketId`, `createdAt`                      | non    | chronologie par ticket ; motif non documenté                                                                                                                                                                       |
| `qa_runs`                                         | `qa_runs_kind_period_unique` (`schema.ts:432-436`, `0006.sql:11`)                                                               | `kind`, `periodKey`                          | oui    | **documenté** : l'insert unique est la revendication du créneau ; avec plusieurs instances ou un cron externe, un seul gagnant par période, et un crash après revendication reste visible                          |
| car `finishedAt` reste null (`schema.ts:413-418`) |

PK (rappel) : `AUTO_INCREMENT` partout, sauf `user_credentials` dont la PK
est `userId` (`schema.ts:61-63`, `0001.sql:88`).

---

## 4. Enums et valeurs exactes

Valeurs dans l'ordre déclaré, telles quelles (`shared/db/schema.ts`).
En DDL, chaque enum est un `ENUM(...)` MySQL avec exactement ces chaînes.

| Const / colonne                                                                      | Valeurs                                                                                                                                                                                                    | Source                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `users.role` (inline)                                                                | `user`, `admin`                                                                                                                                                                                            | `schema.ts:49`, `0000.sql:7`                         |
| `monitorStatusValues` → `monitors.currentStatus`                                     | `UNKNOWN`, `UP`, `DOWN`, `PAUSED`                                                                                                                                                                          | `schema.ts:97,126-128`, `0001.sql:24`                |
| `monitorKeywordModeValues` → `monitors.keywordMode`                                  | `must_contain`, `must_not_contain`                                                                                                                                                                         | `schema.ts:100-103,122-124`, `0007.sql:22`           |
| `checkClassificationValues` → `ping_logs.classification`                             | `UP_HTTP_2XX`, `UP_HTTP_3XX`, `DOWN_HTTP_4XX`, `DOWN_HTTP_5XX`, `DOWN_TIMEOUT`, `DOWN_DNS`, `DOWN_TLS`, `DOWN_NETWORK`, `INVALID_TARGET`, `BLOCKED_TARGET`, `DOWN_KEYWORD_MISSING`, `DOWN_KEYWORD_PRESENT` | `schema.ts:152-165,182-185`                          |
| `incidentStatusValues` → `incidents.status`                                          | `suspect`, `confirmed`, `resolved`                                                                                                                                                                         | `schema.ts:197-201,215-217`, `0001.sql:8`            |
| `notificationChannelTypeValues` → `notification_channels.type`                       | `telegram` (valeur unique)                                                                                                                                                                                 | `schema.ts:233,252`, `0001.sql:37`                   |
| `notificationDeliveryTypeValues` → `notification_deliveries.type`                    | `failure`, `recovery`, `test`                                                                                                                                                                              | `schema.ts:234-238,276`, `0001.sql:49`               |
| `notificationDeliveryStatusValues` → `notification_deliveries.status`                | `pending`, `sent`, `failed`                                                                                                                                                                                | `schema.ts:239-243,277-279`, `0001.sql:50`           |
| `qaTicketSourceValues` → `qa_tickets.source`                                         | `client`, `auto`, `internal`                                                                                                                                                                               | `schema.ts:321,343`, `0006.sql:29`                   |
| `qaTicketKindValues` → `qa_tickets.kind`                                             | `bug`, `behaviour`, `ux`                                                                                                                                                                                   | `schema.ts:322,344`, `0006.sql:30`                   |
| `qaTicketSeverityValues` → `qa_tickets.severity`                                     | `P1`, `P2`, `P3`, `P4`                                                                                                                                                                                     | `schema.ts:323,345-347`, `0006.sql:31`               |
| `qaTicketStatusValues` → `qa_tickets.status`, `qa_ticket_events.fromStatus/toStatus` | `new`, `triaged`, `in_progress`, `waiting_client`, `resolved`, `closed`                                                                                                                                    | `schema.ts:324-331,348,398-399`, `0006.sql:32,20-21` |
| `qaTicketAuthorValues` → `qa_ticket_events.author`                                   | `client`, `support`, `system`                                                                                                                                                                              | `schema.ts:332,392`, `0006.sql:17`                   |
| `qaTicketVisibilityValues` → `qa_ticket_events.visibility`                           | `public`, `internal`                                                                                                                                                                                       | `schema.ts:333,394-396`, `0006.sql:18`               |
| `qaRunKindValues` → `qa_runs.kind`                                                   | `self_test`, `daily_digest`                                                                                                                                                                                | `schema.ts:410,423`, `0006.sql:2`                    |
| `qaRunStatusValues` → `qa_runs.status`                                               | `ok`, `attention`, `failed`                                                                                                                                                                                | `schema.ts:411,425`, `0006.sql:5`                    |

Dérive d'enum : `classification` est créé avec 10 valeurs en 0001
(`0001.sql:65`) puis élargi à 12 par `MODIFY COLUMN` en 0007, l'ajout étant
`DOWN_KEYWORD_MISSING` et `DOWN_KEYWORD_PRESENT` (`0007.sql:20`).

---

## 5. Graphe des clés étrangères

Format `table.colonne -> table.cible (onDelete)`, tel que déclaré dans
`schema.ts` et posé dans le DDL :

- `users.planId -> plans.id (set null)` (`schema.ts:50`, `0007.sql:26`)
- `user_credentials.userId -> users.id (cascade)` (`schema.ts:61-63`, `0001.sql:100`)
- `sessions.userId -> users.id (cascade)` (`schema.ts:81-83`, `0001.sql:99`)
- `monitors.userId -> users.id (cascade)` (`schema.ts:110-112`, `0001.sql:94`)
- `ping_logs.monitorId -> monitors.id (cascade)` (`schema.ts:172-174`, `0001.sql:98`)
- `incidents.monitorId -> monitors.id (cascade)` (`schema.ts:208-210`, `0001.sql:92`)
- `incidents.lastFailureLogId -> ping_logs.id (set null)` (`schema.ts:219-221`, `0001.sql:93`)
- `notification_channels.userId -> users.id (cascade)` (`schema.ts:249-251`, `0001.sql:95`)
- `notification_deliveries.incidentId -> incidents.id (cascade)` (`schema.ts:270-272`, `0001.sql:96`)
- `notification_deliveries.channelId -> notification_channels.id (cascade)` (`schema.ts:273-275`, `0001.sql:97`)
- `status_pages.userId -> users.id (cascade)` (`schema.ts:305-308`, `0005.sql:14`)
- `qa_tickets.userId -> users.id (cascade)` (`schema.ts:340-342`, `0006.sql:54`)
- `qa_tickets.monitorId -> monitors.id (set null)` (`schema.ts:360-362`, `0006.sql:55`)
- `qa_ticket_events.ticketId -> qa_tickets.id (cascade)` (`schema.ts:389-391`, `0006.sql:53`)

Sur `ON UPDATE`, toutes les FK du DDL sont `no action`
(`0001.sql:92-100`, `0005.sql:14`, `0006.sql:53-55`, `0007.sql:26`).

Effets réels des suppressions :

- **Supprimer un `users`** : cascade → `user_credentials`, `sessions`,
  `monitors`, `notification_channels`, `status_pages`, `qa_tickets` ;
  puis deuxième étage : les `monitors` supprimés emportent `ping_logs` et
  `incidents` (cascade), les `incidents` emportent `notification_deliveries`,
  les `qa_tickets` emportent `qa_ticket_events` ; `users.planId` des autres
  comptes n'est pas touché. Un compte efface donc 100 % de ses données
  métier en une suppression (`schema.ts:50-52,112,174,210,221,251,272,275,308,342,362,391`).
- **Supprimer un `plans`** : seul effet, `users.planId` passe à `NULL` ; le
  compte retombe sur la ligne `free` au lieu d'échouer (`schema.ts:15-16,50`).
- **Supprimer un `monitors`** : ses `ping_logs` et `incidents` (donc leurs
  `notification_deliveries`) sont supprimés ; ses `qa_tickets` survivent avec
  `monitorId = NULL` (`schema.ts:174,210,272,362`).
- **Supprimer un `ping_logs`** : les `incidents` qui le pointaient via
  `lastFailureLogId` survivent, référence remise à `NULL`
  (`schema.ts:219-221`).
- **Supprimer un `incidents`** : ses `notification_deliveries`
  disparaissent (`schema.ts:272`) ; les `ping_logs` ne sont pas touchés.
- **Supprimer un `notification_channels`** : ses `notification_deliveries`
  disparaissent (`schema.ts:275`).
- **Supprimer un `qa_tickets`** : sa chronologie `qa_ticket_events`
  disparaît (`schema.ts:391`).

---

## 6. Historique des migrations

Huit fichiers dans `shared/db/`, ordonnés par le journal
`shared/db/meta/_journal.json:4-61` (dialecte `mysql`, version de format 7,
`_journal.json:2-3`). Les snapshots `meta/000X_snapshot.json` reflètent l'état
de schéma après chaque passe.

| Migration                           | Ce qu'elle fait réellement                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000_initial_users.sql`            | Crée `users` seule, PK `id`, unique sur `openId` (`0000.sql:1-13`)                                                                                                                                                                                                                                                                                                                                          |
| `0001_magenta_microbe.sql`          | Crée `incidents`, `monitors`, `notification_channels`, `notification_deliveries`, `ping_logs`, `sessions`, `user_credentials` ; pose les 9 premières FK (dont les uniques `sessions_token_hash_unique`, `user_credentials_email_unique` en DDL de table) ; crée 7 index (`0001.sql:1-107`). À ce stade `classification` a 10 valeurs (`0001.sql:65`) et `monitors` n'a ni SSL ni keyword (`0001.sql:16-32`) |
| `0002_overconfident_wraith.sql`     | Ajoute la contrainte `notification_deliveries_incident_channel_type_unique` (`incidentId`,`channelId`,`type`) (`0002.sql:1`)                                                                                                                                                                                                                                                                                |
| `0003_notification_retry_index.sql` | Ajoute l'index `notification_deliveries_retry_queue_idx` (`status`,`createdAt`) (`0003.sql:1`)                                                                                                                                                                                                                                                                                                              |
| `0004_loving_rhodey.sql`            | Ajoute `monitors.sslIssuer/sslSubject/sslValidTo` et `ping_logs.dnsMs/tcpMs/tlsMs/ttfbMs` (7 `ADD COLUMN`) (`0004.sql:1-7`)                                                                                                                                                                                                                                                                                 |
| `0005_spooky_lake.sql`              | Crée `status_pages` (uniques `userId`, `slug`) + FK cascade vers `users` (`0005.sql:1-14`)                                                                                                                                                                                                                                                                                                                  |
| `0006_needy_lily_hollister.sql`     | Crée le module QA : `qa_runs`, `qa_ticket_events`, `qa_tickets` ; 3 FK (cascade ticket→events, cascade user→tickets, set null monitor→tickets) ; 4 index QA ; uniques colonne `reporterToken` et `fingerprint` (`0006.sql:1-59`)                                                                                                                                                                            |
| `0007_clever_kulan_gath.sql`        | Crée `plans` + index `sortOrder` ; élargit `ping_logs.classification` à 12 valeurs ; ajoute `monitors.keyword` + `keywordMode` ; ajoute `users.planId` + `trialEndsAt` et la FK `set null` vers `plans` ; **seed des 3 paliers** (`0007.sql:1-34`)                                                                                                                                                          |

### Seed 0007 — l'unique seed du dépôt

`INSERT IGNORE` (idempotent : rejouer la migration n'écrase pas les limites
retunées par l'owner, `0007.sql:28-30`). `minIntervalSeconds` reste à 300 s
minimum « volontairement », car la borne d'échantillonnage des percentiles de
la page publique est dérivée de ce plancher (`0007.sql:30-31`).
Valeurs insérées (`0007.sql:32-34`) :

| Colonne              | `free`    | `pro`    | `business` |
| -------------------- | --------- | -------- | ---------- |
| `slug`               | `free`    | `pro`    | `business` |
| `name`               | `Free`    | `Pro`    | `Business` |
| `maxMonitors`        | 3         | 25       | 100        |
| `minIntervalSeconds` | 300       | 300      | 300        |
| `maxTimeoutMs`       | 30000     | 30000    | 30000      |
| `maxChannels`        | 1         | 3        | 8          |
| `allowKeyword`       | 0 (false) | 1 (true) | 1 (true)   |
| `priceCents`         | 0         | 900      | 2900       |
| `trialDays`          | 0         | 14       | 14         |
| `isPublic`           | 1 (true)  | 1 (true) | 1 (true)   |
| `sortOrder`          | 1         | 2        | 3          |

Aucun autre `INSERT` n'existe dans les 8 migrations lues.

---

## 7. Rétention et volume

Tables qui grossissent en continu :

- `ping_logs` : un relevé par check, donc par monitor toutes les
  `intervalSeconds` ≥ 300 (`schema.ts:115,187`) ; c'est la plus grosse table.
- `notification_deliveries` : une ligne par (incident, canal, type)
  (`schema.ts:291-293`).
- `qa_ticket_events` : append-only, sans `updatedAt` ni purge déclarée
  (`schema.ts:385-408`).
- `sessions` : une ligne par ouverture de session, purgée à expiration
  (`schema.ts:76-95`).

Purge — `server/scheduler/retention.ts` :

- Bornes : `ping_logs` supprimés quand `checkedAt` < now − 90 jours,
  `notification_deliveries` quand `createdAt` < now − 90 jours
  (`retention.ts:6-8,23-31,62-71`). Commentaire : les fenêtres UI interrogent
  au plus 30 jours, 90 garde une marge d'audit (`retention.ts:6`).
- `sessions` : suppression des lignes `expiresAt < now`, sans borne de date
  (`retention.ts:57-61`).
- Volume par passe : `DELETE … LIMIT 1000` par table, pour que chaque
  suppression reste trop courte pour bloquer un check
  (`retention.ts:9-10,41`).
- Fréquence : une passe incrémentale « appelée depuis le tick de
  l'ordonnanceur », idempotente donc tolérante aux ticks qui se chevauchent
  (`retention.ts:47-53`). La cadence exacte du tick n'est pas fixée dans les
  fichiers sources de ce document ; à recouper dans `server/scheduler/`.
  Indices discordants : `schema.ts:294-299` qualifie le balayage de retry de
  « une fois par minute » ; `docs/02-technical/qa-support.md:185-187` place
  la purge sur un tick de 30 s. Cadence réelle : non déterminé depuis le code
  cité ici.
- Tables jamais purgées par ce module : `qa_ticket_events`, `qa_runs`,
  `incidents` (aucune DELETE les concernant dans `retention.ts:51-73`).

---

## 8. Ce que le schéma ne contient pas

Inventaire négatif, établi en lisant `schema.ts` en entier (aucune définition
de table ou colonne hors des 13 §2) :

- **Aucune table de rate limit.** Le compteur est une `Map` en mémoire de
  processus, bornée à 10 000 clés (`api.md:22-25`, qui cite
  `server/auth/rateLimit.ts:10`). Un redémarrage remet donc les compteurs à
  zéro ; c'est un comportement de processus, pas de base.
- **Aucun stockage binaire ni pièce jointe.** Pas de `BLOB`/`LONGBLOB` ; les
  preuves QA tiennent dans `qa_tickets.evidence` (`TEXT`, sérialisé et borné,
  `schema.ts:363-364`) et la configuration Telegram dans
  `notification_channels.configurationEncrypted` (`TEXT`, `schema.ts:253`).
  Capture d'écran et headless browser n'ont pas de table (`qa-support.md:323-325`).
- **Aucune organisation, équipe ni affectation.** `users` existe bien, mais
  avec seulement `role ∈ user/admin` (`schema.ts:49`) ; il n'y a pas de table
  de membership ni de colonne `assignee` (`qa-support.md:330-332`).
- **Aucune fenêtre de maintenance** : pas de table dédiée
  (`qa-support.md:327-329`).
- **Aucune table de paiement, facture ou abonnement.** `plans.priceCents` et
  `trialDays` existent (`schema.ts:29-30`), mais rien n'enregistre de
  transaction ni d'abonnement tiers dans les 13 tables.
- **Aucune liaison page↔monitors.** `status_pages.userId` est unique
  (`schema.ts:306-308`) : une page par compte, pas de table de sélection
  explicite des services publiés.
- **Aucune sonde multi-région ni étape.** `monitors` n'a ni `region`, ni
  type autre qu'HTTP : une `url` à intervalle fixe (`schema.ts:106-150`).
- **Aucun reset de mot de passe en base.** `user_credentials` + `sessions`
  sont les deux seules tables d'identité ; pas de table de jeton de reset
  (`schema.ts:58-95`).
- **Aucun soft delete** : pas de colonne `deletedAt` dans les 13 tables.
- **Aucune métrique temps réel ni dashboard persisté** : le dashboard se
  calcule sur `ping_logs`/`incidents` (`api.md:56-66`), rien n'est agrégé en
  table.
- **Aucune horloge de vérification de SSL** : les colonnes `sslIssuer/
sslSubject/sslValidTo` sont des snapshots écrits par le check
  (`schema.ts:133-135`), sans table d'historique SSL dédiée.
- **Aucun `updatedAt` sur `ping_logs`, `sessions`, `qa_ticket_events`** :
  lignes immuables par conception (`schema.ts:168-195,76-95,385-408`).
