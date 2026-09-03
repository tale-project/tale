---
title: Limites de débit
description: Limites de débit REST et MCP — les buckets, la réponse 429 et son Retry-After, et comment relancer sans empirer la situation.
---

L'API est limitée par IP cliente — avant l'authentification, le budget tient donc même face au martèlement non authentifié — avec des token buckets : les rafales passent, le martèlement continu répond **429**. Une flotte de workers derrière une même sortie NAT arrive comme une seule IP et partage un seul budget. Les budgets sont taillés pour qu'une connector normale ne les voie jamais — quand un client jusque-là sain se met à recevoir des 429, la cause est presque toujours un backoff manquant ou une boucle chaude, pas un manque de capacité.

Lis ceci quand tu câbles un client qui appelle l'API sur un planning ou sous charge.

## Les buckets

| Surface                                                                                                                               | Budget             | Rafale |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------ |
| Lectures et CRUD — chaque endpoint `/api/v1` absent des lignes du dessous, y compris `POST /api/v1/mcp`                               | 120 requêtes / min | 200    |
| Démarrer du travail — `POST /api/v1/automations/{name}/runs`, `POST /api/v1/threads/{id}/messages` et `POST /api/v1/tasks/{id}/start` | 20 requêtes / min  | 40     |
| Le flux de fichiers projet — le handoff de chargement et la liaison de fichier (`POST .../uploads` et `POST .../files`)  | 240 requêtes / min | 300    |

Le second bucket est petit à dessein : chacune de ces requêtes coûte une exécution durable entière ou un tour de modèle, pas une lecture de base. Le troisième est spacieux à dessein : un fichier coûte ici au moins deux appels — demander le handoff, lier le fichier — le budget couvre donc toute la chorégraphie. Chaque requête compte aussi contre le budget général — c'est la porte — donc un POST de démarrage de travail ou de chargement tire sur deux voies à la fois, et la plus étroite gouverne ; dimensionne sur elle. Une création de dossier est une simple écriture et tire uniquement sur le budget général. Un token bucket se remplit en continu — la capacité de rafale absorbe un lot, puis le débit soutenu s'applique.

Certaines écritures passent aussi par les mêmes budgets par utilisateur ou par organisation que leurs jumelles dans l'app — un commentaire de tâche, un changement de dossier — et répondent la même 429 au-delà.

## La 429

Un dépassement répond avec l'enveloppe d'erreur ordinaire de l'API, plus un header `Retry-After` qui nomme l'attente en secondes entières (arrondies au-dessus) :

```json
{ "error": "Rate limit exceeded" }
```

Dors au moins `Retry-After` avant le prochain essai. Il n'y a pas de compteurs de budget restant — au-delà, recule à l'aveugle : commence à une seconde, double à chaque 429 consécutif, plafonne à soixante, et ajoute du jitter pour que des workers parallèles ne relancent pas au pas. Comme démarrer une exécution répond **202** avant que le travail n'ait lieu, une réponse perdue se détecte à bas prix — liste les dernières exécutions de l'automatisation avant de tirer à nouveau, plutôt que de rejouer des écritures au soupçon.

## Où ça se place

La [référence API](/fr/develop/api-reference) nomme la 429 dans le modèle d'erreur et pointe ici. Si ta charge a vraiment besoin de plus que les budgets, regroupe de ton côté — `POST /api/v1/contacts/bulk` existe exactement pour ça — ou étale le planning ; les buckets valent par IP — répartir le trafic sur plusieurs clés ne change rien, une flotte partage le budget de sa sortie NAT.
