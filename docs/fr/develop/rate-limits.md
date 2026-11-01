---
title: Gérer les limites de requêtes
description: Planifie les appels REST, MCP et webhook, interprète Retry-After et réessaie sans dupliquer un travail déjà accepté.
---

Tale limite le trafic API par détenteur de clé. Toutes les clés d’une même personne partagent son budget ; une clé qu’un propriétaire ou un admin a créée pour un membre, une équipe, un projet ou l’organisation a son propre budget. Compte donc l’ensemble des intégrations et processus de suivi utilisant cette identité, plutôt que chaque clé séparément.

Les limites ci-dessous décrivent le backend actuel. Un proxy de l’opérateur ou un fournisseur en aval peut ajouter ses propres limites.

## Les budgets

Un seau de jetons se remplit en continu jusqu’à sa capacité de rafale. Une courte série peut utiliser cette réserve ; le débit soutenu doit rester inférieur au rythme de remplissage.

| Trafic | Débit soutenu | Rafale | Budget attribué à |
| --- | --- | --- | --- |
| Appels généraux `/api/v1`, MCP et endpoints de modèles compris | 120/minute | 200 | Détenteur de la clé |
| Démarrages d’exécution, messages au modèle, démarrages de tâche et exécutions MCP | 20/minute | 40 | Détenteur de la clé |
| Modifications de paramètres par MCP (`apply_settings`) | 30/minute | 60 | Détenteur de la clé |
| Autorisation de téléversement et rattachement de fichier au projet | 240/minute | 300 | Détenteur de la clé |
| Authentification par clé API échouée | 20/minute | 40 | IP source |
| Auto-enregistrement d’un agent de code auprès du serveur de connexion | 10/heure par source, 500/jour pour le déploiement | Aucune | IP source, déploiement |
| Demandes de jeton refusées par le serveur de connexion | 20/minute | 40 | IP source |
| Livraisons webhook avant validation du jeton | 120/minute | 240 | Adresse de l’expéditeur |
| Livraisons à un déclencheur webhook vérifié | 20/minute | 40 | Déclencheur |

Chaque serveur prélève les appels généraux `/api/v1` sur leur seau quelques requêtes à l’avance. Une rafale peut donc s’arrêter jusqu’à 10 requêtes avant 200 : prévoyez des rafales de 190 requêtes au plus.

Un agent de code qu’une personne a connecté puise dans les budgets de cette personne, les mêmes que ceux que partagent ses clés API ; il n’a pas de clé à lui. Un jeton qui n’a jamais été valide compte comme une authentification échouée, comme une mauvaise clé ; un jeton simplement expiré, non, puisque l’agent le renouvelle ensuite. L’enregistrement et les demandes de jeton refusées sont imputés à l’adresse source ; une demande de jeton qui aboutit ne coûte rien, car les agents hébergés partagent leurs adresses.

Les étapes HTTP des automatisations ont leur propre budget, par organisation : 120 appels par minute sur tout le déploiement, et 10 à la fois sur un serveur. Voir [Appeler une API depuis une automatisation](/fr/platform/automations/http).

Les exécutions jamais conservées ont un budget propre, par organisation : essayer une automatisation avec des sorties simulées et lancer ses tests à la main, dans l’application, par MCP (`run_automation`, `test_automation`) ou par REST (`POST …/versions/{version}/tests`). Chaque exécution, et chaque test d’une suite, en coûte une ; le budget se remplit à 120 par minute jusqu’à 240, et un serveur en exécute quatre à la fois.

Les appels REST d’exécution et de téléversement consomment aussi le budget général. Un fichier de projet nécessite par exemple une autorisation de téléversement puis un rattachement. Chacun de ces appels compte dans les deux budgets. Le budget de téléversement plus large ne contourne pas la limite générale.

L’exécution comprend les démarrages d’automatisation avec ou sans projet, la mise en service d’une version d’automatisation (`POST /api/v1/automations/{name}/deployments`), l’exécution des tests d’une version enregistrée (`POST /api/v1/automations/{name}/versions/{version}/tests`), les messages de fil et les démarrages explicites de tâche. La création ou mise à jour d’une tâche consomme aussi ce budget si `runWorkflowSlug` est fourni. Une requête qui démarre du travail est facturée une fois que son corps et ses en-têtes ont passé les vérifications propres de la porte — un `400 INVALID_BODY` ou `INVALID_HEADER` ne coûte rien — et avant que quoi que ce soit soit cherché, si bien qu’un `404` pour un fil, une tâche ou une automatisation que tu ne peux pas voir coûte un jeton, comme un `409` que l’état répond. Certaines mutations, comme les commentaires de tâche ou les changements de dossier, ont des limites supplémentaires partagées avec l’application.

Dans un lot MCP, les appels d’outil supplémentaires consomment du budget supplémentaire. Le [point d’accès MCP](/fr/develop/mcp-endpoint) distingue une réponse HTTP `429` d’un message refusé à l’intérieur du lot. Un outil MCP qui exécute une automatisation (`run_automation`, `test_automation`, `deploy_automation`, `run_deployed`, `start_run` et `invoke_capability`) consomme en plus une exécution, une fois que le rôle du détenteur de la clé autorise l’appel ; de même pour `answer_run_ask`, dont la réponse relance une exécution en attente, comme la réponse REST. `run_automation` et `test_automation` consomment en plus une unité du budget des exécutions jamais conservées pour chaque exécution ou chaque test, et reçoivent la même réponse quand il est épuisé ou que le serveur en exécute déjà autant qu’il peut. Quand le budget d’exécution est épuisé, l’appel reçoit un résultat d’outil dont le `code` est `RATE_LIMITED` et dont `data.retryAfterMs` indique l’attente, et non une réponse HTTP `429`. Les lectures, la validation et l’enregistrement ne consomment aucune exécution. Une modification de paramètres (`apply_settings`) consomme de la même façon une unité de son propre budget de paramètres et reçoit `RATE_LIMITED` dès qu’il est épuisé ; lire et planifier des paramètres n’en consomme pas. Les webhooks ont des budgets séparés ; les limites de l’expéditeur et du déclencheur doivent toutes deux permettre la livraison.

Les appels aux [endpoints de modèles](/fr/develop/api-reference#model-endpoints) sous `/api/v1/openai` et `/api/v1/anthropic` ne comptent que dans le budget général, pour une requête chacun, en flux ou non ; ce qu’un appel peut dépenser est plafonné à part par les règles de budget. Une personne, et chaque clé API, peuvent en outre avoir huit de ces appels en cours en même temps : un neuvième reçoit `429` avec le `code` `MODEL_API_CONCURRENCY_EXCEEDED` et `Retry-After: 2`.

Le budget d’exécution limite la vitesse d’acceptation des messages, pas le nombre de tours simultanés. Les messages acceptés partagent une file entre toutes les organisations et les clés de l’instance. Chaque worker exécute jusqu’à 16 tours en même temps (davantage si `WORKER_CONCURRENCY` est plus élevé) et prend le suivant dès qu’un tour se termine. Un envoi accepté peut donc attendre derrière d’autres clients. L’API n’expose ni position dans la file ni heure de démarrage estimée.

## La réponse 429

Un refus HTTP pour dépassement de limite indique `Retry-After` en secondes entières. Le corps JSON exprime la même attente en millisecondes. Cet exemple impose au moins deux secondes de pause :

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 2
Content-Type: application/json

{
  "error": "Too many requests — retry after 1500 ms",
  "code": "RATE_LIMITED",
  "requestId": "example-request-id",
  "data": {"retryAfterMs": 1500}
}
```

Branche ta logique sur `code`. `error` décrit l’attente dans une phrase et `requestId` identifie la requête pour une investigation. Ce format est celui de REST. Les refus de débit de `/api/app` et des webhooks conservent le code machine dans `error` ; ne traite donc pas ce texte comme un format commun aux interfaces. Tale ne fournit pas de compteur de budget restant : mesure ton trafic et respecte l’attente indiquée.

1. Arrête la boucle de relance immédiate.
2. Attends au moins `Retry-After`. Si plusieurs processus partagent l’identité, coordonne leur pause.
3. Si les refus continuent, augmente le délai exponentiellement avec une borne et une variation aléatoire. Par exemple, passe d’une à soixante secondes en respectant toujours une attente serveur plus longue.
4. Conserve la clé d’idempotence initiale pour les opérations qui la prennent en charge. Un timeout au démarrage peut survenir après l’acceptation du travail.

Un plafond de dépenses répond aussi par `429`, avec le `code` `BUDGET_EXCEEDED` : une règle de budget qui s’applique au propriétaire de la clé — la sienne, celle d’une équipe, de l’organisation ou de la clé API et, pour le travail dans un projet, celle du projet — est atteinte. Attendre quelques secondes ne suffit pas. `Retry-After` indique le temps restant avant la réinitialisation de la période, et `data` décrit le plafond : `scope`, `period`, `limitCode`, `used`, `limit` et `resetsAt` en millisecondes epoch. Rien n’est mis en file d’attente ; suspends le travail jusqu’à `resetsAt` ou demande à un administrateur de relever la limite dans [Politiques et limites](/fr/platform/admin/governance/policies-and-limits). Sur les endpoints de modèles, les deux `429` arrivent au format d’erreur d’OpenAI ou d’Anthropic, avec le même `code` et `Retry-After`. Un budget épuisé y nomme son plafond dans le message plutôt que dans `data` et porte `x-should-retry: false`, pour que les SDK des fournisseurs ne réessaient pas d’eux-mêmes.

Les autres réponses `4xx` nécessitent généralement une correction de requête, d’identifiants ou de droits. Ne traite pas tout échec comme une limite ; consulte le [modèle d’erreur](/fr/develop/api-reference#modele-derreur).

## Planifier le suivi et les relances

Une réponse `304` après vérification d’`ETag` compte toujours comme une requête. Elle économise des octets, pas du budget. Suivre une exécution toutes les cinq secondes consomme douze lectures par minute avant les relances et les autres opérations. Réserve de la capacité pour ces appels supplémentaires.

Demande uniquement les champs nécessaires, comme `?fields=status,finishedAt` pour une exécution. Espace les lectures lorsqu’une décision humaine est attendue et arrête-les une fois l’exécution terminée. [Démarrer puis suivre une exécution](/fr/develop/api-reference#demarrer-une-execution-puis-la-suivre) explique les états et les démarrages idempotents.

Pour les imports importants, utilise les opérations groupées prises en charge, telles que `POST /api/v1/contacts/bulk`, et répartis les lots dans le temps. Créer d’autres clés pour la même personne n’augmente pas le budget. Un traitement qui a besoin de sa propre identité et de son propre budget peut utiliser une clé qu’un propriétaire ou un admin crée pour une équipe, un projet ou l’organisation. Changer de clé n’est pas une stratégie de relance.
