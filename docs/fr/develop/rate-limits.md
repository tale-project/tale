---
title: Limites de débit
description: Limites de débit REST et MCP — les buckets, la réponse 429 et son Retry-After, et comment relancer sans empirer la situation.
---

L'API limite avec des token buckets rattachés au détenteur de la clé — l'utilisateur au nom duquel ta clé API agit — si bien qu'un budget appartient toujours à un appelant identifiable et qu'aucun en-tête réseau ne peut en fabriquer un neuf : les rafales passent, le martèlement continu répond **429**. Chaque clé qu'un utilisateur crée puise dans le budget de cet utilisateur ; une flotte de workers qui a besoin de son propre budget reçoit son propre utilisateur machine. Une clé qui échoue à s'authentifier est freinée par IP source à la place (20 requêtes par minute, rafale de 40) : les inconnus ne puisent donc jamais dans le budget d'un détenteur de clé, et une requête sans clé ne coûte rien du tout. Les budgets sont taillés pour qu'une connector normale ne les voie jamais — quand un client jusque-là sain se met à recevoir des 429, la cause est presque toujours un backoff manquant ou une boucle chaude, pas un manque de capacité.

Lis ceci quand tu câbles un client qui appelle l'API sur un planning ou sous charge.

## Les buckets

| Surface                                                                                                                               | Budget             | Rafale |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------ |
| Lectures et CRUD — chaque endpoint `/api/v1` absent des lignes du dessous, y compris `POST /api/v1/mcp`                               | 120 requêtes / min | 200    |
| Démarrer du travail — exécutions de projet (`POST /api/v1/projects/{id}/automations/{name}/runs`), messages (`POST /api/v1/projects/{id}/threads/{threadId}/messages`) et tâches (`POST /api/v1/projects/{id}/tasks/{taskId}/start`), ainsi que les exécutions et messages de threads sans projet | 20 requêtes / min | 40 |
| Le flux de fichiers projet — le handoff de chargement et la liaison de fichier (`POST .../uploads` et `POST .../files`)  | 240 requêtes / min | 300    |
| Livraisons webhook entrantes (`POST /api/automations/webhook/{token}` et la forme projet) — par adresse d’expéditeur, facturées avant même la vérification du jeton | 120 requêtes / min | 240 |
| Les mêmes livraisons, par déclencheur vérifié                                                                                         | 20 requêtes / min  | 40     |

Le second bucket est petit à dessein : chacune de ces requêtes coûte une exécution durable entière ou un tour de modèle, pas une lecture de base — et le bucket webhook par déclencheur l’est pour la même raison ; la porte webhook ne porte aucune clé, ses budgets tiennent donc à l’adresse de l’expéditeur et au déclencheur que le jeton nomme (la [page Webhooks](/fr/develop/webhooks) a le vocabulaire de cette porte). Le troisième est spacieux à dessein : un fichier coûte ici au moins deux appels — demander le handoff, lier le fichier — le budget couvre donc toute la chorégraphie. Chaque requête compte aussi contre le budget général — c'est la porte — donc un POST de démarrage de travail ou de chargement tire sur deux voies à la fois, et la plus étroite gouverne ; dimensionne sur elle. Un token bucket se remplit en continu — la capacité de rafale absorbe un lot, puis le débit soutenu s'applique.

Certaines écritures passent aussi par les mêmes budgets par utilisateur ou par organisation que leurs jumelles dans l'app — un commentaire de tâche, un changement de dossier — et répondent la même 429 au-delà.

## La 429

Un dépassement répond avec l'enveloppe d'erreur ordinaire de l'API, plus un header `Retry-After` qui nomme l'attente en secondes entières (arrondies au-dessus) :

```json
{ "error": "RATE_LIMITED", "code": "RATE_LIMITED", "data": { "retryAfterMs": 1500 } }
```

`code` est la valeur sur laquelle brancher, comme partout dans le [modèle d’erreur](/fr/develop/api-reference) ; sur ce seul refus, `error` le répète au lieu de porter une phrase, parce que la même 429 sert aussi les portes de l’app, dont les clients lisent `error`. Le corps indique l’attente en millisecondes dans `data.retryAfterMs` ; l’en-tête `Retry-After` l’arrondit aux secondes entières supérieures. Par exemple, `1500` millisecondes donnent `Retry-After: 2`.

Une interrogation qui répond **304** (`ETag` inchangé, voir [cache](/fr/develop/api-reference#cache-compression-et-lectures-partielles)) coûte une requête comme les autres — la revalidation économise des octets, pas du budget. Dimensionne donc l’intervalle d’interrogation sur le budget : à une lecture par seconde, un détenteur de clé peut suivre deux exécutions, à cinq secondes dix. Ne lis que ce dont tu as besoin (`?fields=status,finishedAt` sur une exécution) pour que chaque requête reste petite, et préfère un planning à une boucle serrée.

Dors au moins `Retry-After` avant le prochain essai. Il n'y a pas de compteurs de budget restant — au-delà, recule à l'aveugle : commence à une seconde, double à chaque 429 consécutif, plafonne à soixante, et ajoute du jitter pour que des workers parallèles ne relancent pas au pas. Comme démarrer une exécution répond **202** avant que le travail n’ait lieu, une réponse perdue est le cas ordinaire, pas un cas limite : nomme le démarrage avec `Idempotency-Key` et relance-le — la répétition répond l’exécution que la première tentative a lancée, marquée `duplicate: true`, au lieu d’en démarrer une seconde (la [référence API](/fr/develop/api-reference) donne les règles).

## Où ça se place

La [référence API](/fr/develop/api-reference) nomme la 429 dans le modèle d'erreur et pointe ici. Si ta charge a vraiment besoin de plus que les budgets, regroupe de ton côté — `POST /api/v1/contacts/bulk` existe exactement pour ça — ou étale le planning ; les buckets valent par détenteur de clé — répartir le trafic sur plusieurs clés du même utilisateur ne change rien. Une intégration qui a vraiment besoin de son propre budget reçoit son propre utilisateur machine.
