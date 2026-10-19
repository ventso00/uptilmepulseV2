# Notifications

Telegram est le premier adaptateur de l’interface `NotificationChannel`. Les configurations bot token/chat ID sont chiffrées AES-GCM avec `UPTIMEPULSE_ENCRYPTION_KEY`; l’API ne renvoie jamais la configuration en clair.

Une notification de panne est créée seulement lors de la transition vers incident confirmé après trois échecs. Une notification de rétablissement est créée après deux succès consécutifs. La table `notification_deliveries` impose une unicité `(incidentId, channelId, type)` afin que deux ticks concurrents ne créent pas de doublon.

Chaque livraison est journalisée en `pending`, puis `sent` ou `failed`, avec trois tentatives par cycle. Les livraisons échouées ou restées pending sont reprises au tick Heartbeat suivant, avec un nouveau cycle borné et sans recréer de ligne. Une erreur Telegram est résumée sans payload sensible.
