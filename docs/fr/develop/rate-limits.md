---
title: Limites de débit
description: Limites de débit de l'API REST — budgets par clé par défaut, plafonds par org, forme de la réponse 429, et comment retraiter sans empirer la situation.
---

L'API REST de Tale est limitée par clé et par org. Les défauts sont taillés pour du trafic applicatif normal — les bursts passent, le martelage soutenu renvoie 429. Quand tu atteins une limite, la réponse porte les en-têtes dont tu as besoin pour reculer proprement ; le mauvais geste (retry sans délai, retry sans fin) ne fait qu'aggraver la régulation.

Lis ceci quand tu câbles un client qui appelle l'API planifié ou sous charge. Reviens-y quand une intégration jusque-là saine se met à renvoyer 429 — la réponse est presque toujours un backoff manquant, pas un manque de capacité accordée.

## Un 429 mis en pratique

L'échange utile le plus court est une requête qui dépasse le budget de sa clé. Le serveur renvoie :

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 12
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1717000060

{ "error": { "code": "rate_limited", "message": "Rate limit exceeded. Try again in 12 seconds." } }
```

`Retry-After` est l'attente faisant foi — dors au moins ce temps avant la prochaine tentative. `X-RateLimit-Reset` est le timestamp Unix auquel la fenêtre se recharge. Le `code` dans le body est `rate_limited` ; les clients doivent brancher sur le code, pas parser le message.

## Limites par défaut

| Surface                              | Budget                        | Bucket           |
| ------------------------------------ | ----------------------------- | ---------------- |
| API REST (`/api/v1/*`)               | 120 requêtes / minute / clé   | Token, burst 200 |
| Chat compatible OpenAI               | 30 requêtes / minute / clé    | Token, burst 50  |
| Listage de modèles compatible OpenAI | 120 requêtes / minute / clé   | Token, burst 200 |
| Webhooks de déclencheur de workflow  | 60 requêtes / minute / clé    | Token, burst 100 |
| Webhooks d'agent                     | 30 requêtes / minute / clé    | Token, burst 50  |
| Téléversement de fichier             | 50 requêtes / minute / membre | Fenêtre fixe     |
| Envoi de courriel                    | 100 messages / heure / org    | Token, burst 120 |

Les token buckets autorisent un burst court au-dessus du débit — utile pour les imports en lot — puis se stabilisent au débit soutenu. Les fenêtres fixes se rechargent à la frontière de la minute ; une requête à 14:59:59 et une autre à 15:00:00 passent toutes les deux. Choisis les buckets en conséquence : une UI qui se monte une fois par minute lit comme un token, pas comme 60 sur une fenêtre.

## Plafonds par org

Tale Cloud applique un plafond doux par org au-dessus des budgets par clé, ajusté au plan de l'org. Le plafond protège contre une clé emballée en s'assurant qu'un seul client ne peut pas consommer tout le budget de l'org. Les instances auto-hébergées n'ont pas de plafond par org par défaut — les budgets par clé ci-dessus sont le seul plancher.

Quand il te faut un budget par clé plus haut pour une charge connue sur Cloud, demande au support avec le nom de la clé et le débit soutenu attendu. Les octrois de capacité sont par clé, pas par org.

## Stratégie de retraitement

La bonne stratégie est un backoff exponentiel avec jitter, plafonné à la valeur `Retry-After` quand elle est présente :

1. Sur 429, lis `Retry-After` et dors au moins ce temps.
2. Si `Retry-After` est absent (rare), démarre à 1 s et double à chaque 429 suivant, plafonné à 60 s.
3. Ajoute jusqu'à 25 % de jitter pour que des clients concurrents ne retraitent pas en lock-step.
4. Abandonne après la huitième tentative et fais remonter l'échec — le bucket est saturé et continuer ne servira à rien.

L'idempotence compte ici : chaque endpoint d'écriture accepte un en-tête `Idempotency-Key`. Pose une clé stable par opération logique pour que les retries ne fassent pas double feu quand la requête initiale a réussi mais que la réponse s'est perdue. Voir [Référence API](/fr/develop/api-reference) pour la fenêtre d'idempotence.

## Où cela s'inscrit

Les limites de débit sont la manière dont Tale reste disponible quand un client se conduit mal. La [Référence API](/fr/develop/api-reference) nomme le 429 dans le modèle d'erreur et renvoie ici pour les règles ; la [Référence Webhooks](/fr/develop/webhooks) couvre la politique de retraitement correspondante sur les livraisons sortantes. Si ton trafic est mal formé pour les défauts et qu'un octroi du support ne suffit pas, l'onglet [Auto-hébergé](/fr/self-hosted/overview) est l'autre réponse — exécuter la plateforme sur ta propre infra lève les plafonds imposés par le Cloud.
