# Checks et scheduler

Le worker sélectionne au maximum 50 monitors activés dont `nextCheckAt <= now`. Avant toute connexion, il effectue un **claim atomique** en avançant `nextCheckAt` de six minutes ; un second callback concurrent ne peut donc pas traiter le même monitor. Le check utilise HTTP/HTTPS, une résolution DNS contrôlée au moment de la connexion, un callback `lookup` qui revalide les adresses, un timeout par monitor, une limite de réponse de 256 KiB et trois redirects manuels maximum.

Les réponses 2xx et 3xx sont UP ; 4xx et 5xx sont DOWN. Les erreurs sont classifiées en timeout, DNS, TLS, réseau, cible invalide ou cible bloquée. Une réponse lente reçue avant l’expiration reste une réponse, pas un timeout.

## Assertion de contenu

Quand un monitor porte un `keyword`, le contrôle de contenu s’ajoute **après** un 2xx/3xx ; il ne remplace jamais le code HTTP. `evaluateContent` (`server/checks/client.ts`) compare insensiblement à la casse le corps décodé brut, et ne rend un verdict définitif que si le corps est lisible en entier :

- `must_contain` absent sur un corps **tronqué** au cap de 256 Ko → `unknown`, jamais `DOWN`. Le texte peut se trouver au-delà du cap ; en faire un incident reproduirait le faux positif que ce module refuse déjà pour les pages volumineuses.
- `must_not_contain` présent → `DOWN_KEYWORD_PRESENT` : trouver la chaîne est une preuve, aucune indulgence de troncature.
- `must_contain` absent sur un corps complet → `DOWN_KEYWORD_MISSING`.
- `Content-Type` ni texte, ni JSON/XML/HTML/JavaScript → `unknown` avec le type en clair, sans chercher.

Un `unknown` ne confirme ni n’invalide rien : la classification HTTP reste celle du check, et le motif non concluant est visible dans `errorMessage`. Les deux classifications d’échec de contenu traversent les contrats (`checkClassificationValues`), la base (`ping_logs.classification`) et les libellés français partagés (`checkClassificationLabels`), et un test rejoue la parité des trois listes.

Heartbeat appelle `POST /api/scheduled/checks` à la minute en UTC après publication. Le handler vérifie le JWT `app_session_id` signé par `MANUS_JWT_SECRET`, le `appId` et l’identité `cron_`, reprend les livraisons Telegram échouées puis exécute le lot. Les logs JSON `scheduler_tick`, `monitor_check`, `incident_confirmed` et `incident_resolved` n’incluent pas de secret.
