---
title: Limites de débit
description: Limites de débit REST et MCP — les deux buckets, la réponse 429, et comment relancer sans empirer la situation.
---

L'API est limitée par clé avec des token buckets : les rafales passent, le martèlement continu répond **429**. Les budgets sont taillés pour qu'une intégration normale ne les voie jamais — quand un client jusque-là sain se met à recevoir des 429, la cause est presque toujours un backoff manquant ou une boucle chaude, pas un manque de capacité.

Lis ceci quand tu câbles un client qui appelle l'API sur un planning ou sous charge.

## Les buckets

| Surface                                                                                                  | Budget             | Rafale |
| -------------------------------------------------------------------------------------------------------- | ------------------ | ------ |
| Lectures et CRUD — chaque endpoint `/api/v1` absent de la ligne du dessous, y compris `POST /api/v1/mcp` | 120 requêtes / min | 200    |
| Démarrer du travail — `POST /api/v1/automations/{name}/runs` et `POST /api/v1/threads/{id}/messages`     | 20 requêtes / min  | 40     |

Le second bucket est petit à dessein : chacune de ces requêtes coûte une exécution durable entière ou un tour de modèle, pas une lecture de base. Un token bucket se remplit en continu — la capacité de rafale absorbe un lot, puis le débit soutenu s'applique.

## La 429

Un dépassement répond avec l'enveloppe d'erreur ordinaire de l'API — rien à parser au-delà du statut :

```json
{ "error": "Rate limit exceeded" }
```

Il n'y a pas de headers de limite — pas de `Retry-After`, pas de compteurs de budget restant. Recule à l'aveugle : commence à une seconde, double à chaque 429 consécutif, plafonne à soixante, et ajoute du jitter pour que des workers parallèles ne relancent pas au pas. Comme démarrer une exécution répond **202** avant que le travail n'ait lieu, une réponse perdue se détecte à bas prix — liste les dernières exécutions de l'automatisation avant de tirer à nouveau, plutôt que de rejouer des écritures au soupçon.

## Où ça se place

La [référence API](/fr/develop/api-reference) nomme la 429 dans le modèle d'erreur et pointe ici. Si ta charge a vraiment besoin de plus que les budgets, regroupe de ton côté — `POST /api/v1/contacts/bulk` existe exactement pour ça — ou étale le planning ; les buckets valent par clé, deux clés ne partagent donc pas un budget.
