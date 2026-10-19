# Vision produit

## Problème

Un propriétaire de site ou un développeur ne sait pas immédiatement qu’un site ou une API est indisponible.

## Promesse

UptimePulse fournit un signal fiable : surveiller une URL, conserver des preuves, confirmer une panne après plusieurs échecs et prévenir l’utilisateur sans spam.

## Utilisateurs

Le MVP cible le freelance qui gère plusieurs sites, le créateur de SaaS qui veut une alerte externe, l’agence web qui suit des clients et le propriétaire de boutique qui veut un historique simple.

## User stories MVP

1. En tant qu’utilisateur, je peux créer un compte, me connecter et me déconnecter.
2. En tant qu’utilisateur, je peux créer et gérer mes propres monitors HTTP/HTTPS.
3. En tant qu’utilisateur, je vois UP, DOWN, PAUSED ou UNKNOWN avec le dernier code et le temps de réponse.
4. En tant qu’utilisateur, je peux consulter historique, uptime et incidents.
5. En tant qu’utilisateur, je reçois une seule alerte Telegram quand une panne est confirmée, puis une alerte de rétablissement.
6. En tant qu’utilisateur, mes cibles internes et mes données privées sont protégées.

## Critères MVP

Le parcours complet register → login → monitor → checks → incident → Telegram → rétablissement est reproductible sur une cible de test contrôlée. Le plan Free démarre à 3 monitors et 5 minutes minimum. Les checks manquants sont distingués des checks en échec dans le calcul d’uptime.
