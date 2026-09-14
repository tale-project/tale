---
title: Gérer les limites de requêtes
description: Planifie les appels REST, MCP et webhook, interprète Retry-After et réessaie sans dupliquer un travail déjà accepté.
---

Tale limite le trafic API par détenteur de clé. Toutes les clés d’une même personne partagent son budget. Compte donc l’ensemble des intégrations et processus de suivi utilisant cette identité, plutôt que chaque clé séparément.

Les limites ci-dessous décrivent le backend actuel. Un proxy de l’opérateur ou un fournisseur en aval peut ajouter ses propres limites.

## Les budgets

Un seau de jetons se remplit en continu jusqu’à sa capacité de rafale. Une courte série peut utiliser cette réserve ; le débit soutenu doit rester inférieur au rythme de remplissage.

| Trafic | Débit soutenu | Rafale | Budget attribué à |
| --- | --- | --- | --- |
| Appels généraux `/api/v1`, MCP compris | 120/minute | 200 | Détenteur de la clé |
| Démarrages d’exécution, messages au modèle et démarrages de tâche | 20/minute | 40 | Détenteur de la clé |
| Autorisation de téléversement et rattachement de fichier au projet | 240/minute | 300 | Détenteur de la clé |
| Authentification par clé API échouée | 20/minute | 40 | IP source |
| Livraisons webhook avant validation du jeton | 120/minute | 240 | Adresse de l’expéditeur |
| Livraisons à un déclencheur webhook vérifié | 20/minute | 40 | Déclencheur |

Les appels REST d’exécution et de téléversement consomment aussi le budget général. Un fichier de projet nécessite par exemple une autorisation de téléversement puis un rattachement. Chacun de ces appels compte dans les deux budgets. Le budget de téléversement plus large ne contourne pas la limite générale.

L’exécution comprend les démarrages d’automatisation avec ou sans projet, les messages de fil et les démarrages explicites de tâche. La création ou mise à jour d’une tâche consomme aussi ce budget si `runWorkflowSlug` est fourni. Certaines mutations, comme les commentaires de tâche ou les changements de dossier, ont des limites supplémentaires partagées avec l’application.

Dans un lot MCP, les appels d’outil supplémentaires consomment du budget supplémentaire. Le [point d’accès MCP](/fr/develop/mcp-endpoint) distingue une réponse HTTP `429` d’un message refusé à l’intérieur du lot. Les webhooks ont des budgets séparés ; les limites de l’expéditeur et du déclencheur doivent toutes deux permettre la livraison.

## La réponse 429

Un refus HTTP pour dépassement de limite indique `Retry-After` en secondes entières. Le corps JSON exprime la même attente en millisecondes. Cet exemple impose au moins deux secondes de pause :

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 2
Content-Type: application/json

{"error":"RATE_LIMITED","code":"RATE_LIMITED","data":{"retryAfterMs":1500}}
```

Appuie ta logique sur `code`. Ici, `error` répète le code au lieu de contenir une phrase explicative. Tale ne fournit pas de compteur de budget restant ; mesure ton trafic et respecte l’attente indiquée.

1. Arrête la boucle de relance immédiate.
2. Attends au moins `Retry-After`. Si plusieurs processus partagent l’identité, coordonne leur pause.
3. Si les refus continuent, augmente le délai exponentiellement avec une borne et une variation aléatoire. Par exemple, passe d’une à soixante secondes en respectant toujours une attente serveur plus longue.
4. Conserve la clé d’idempotence initiale pour les opérations qui la prennent en charge. Un timeout au démarrage peut survenir après l’acceptation du travail.

Les autres réponses `4xx` nécessitent généralement une correction de requête, d’identifiants ou de droits. Ne traite pas tout échec comme une limite ; consulte le [modèle d’erreur](/fr/develop/api-reference#modele-derreur).

## Planifier le suivi et les relances

Une réponse `304` après vérification d’`ETag` compte toujours comme une requête. Elle économise des octets, pas du budget. Suivre une exécution toutes les cinq secondes consomme douze lectures par minute avant les relances et les autres opérations. Réserve de la capacité pour ces appels supplémentaires.

Demande uniquement les champs nécessaires, comme `?fields=status,finishedAt` pour une exécution. Espace les lectures lorsqu’une décision humaine est attendue et arrête-les une fois l’exécution terminée. [Démarrer puis suivre une exécution](/fr/develop/api-reference#demarrer-une-execution-puis-la-suivre) explique les états et les démarrages idempotents.

Pour les imports importants, utilise les opérations groupées prises en charge, telles que `POST /api/v1/contacts/bulk`, et répartis les lots dans le temps. Créer d’autres clés pour la même personne n’augmente pas le budget. Si un traitement nécessite sa propre identité de service, prépare-la par le processus habituel de comptes et de permissions. Changer de clé n’est pas une stratégie de relance.
