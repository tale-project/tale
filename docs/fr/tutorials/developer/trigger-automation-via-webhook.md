---
title: Déclencher un workflow par webhook
description: Crée une clé de déclencheur dans un workflow Tale et POSTe sur l'URL de déclencheur depuis un système externe pour démarrer un run avec idempotence.
---

Un déclencheur webhook transforme un workflow Tale en quelque chose qu'un système externe peut allumer en POSTant du JSON. Tale vérifie le bearer token, stocke la clé d'idempotence, lance un run et renvoie un ID d'exécution — la même forme que tout webhook entrant doit prendre pour être sûr à rejouer. Ce parcours mène un workflow neuf de « je veux le déclencher depuis l'extérieur » à « un événement de commande POSTe et le workflow tourne » sur une seule instance.

Il te faut le rôle Developer dans l'organisation, un workflow existant (ou le démarrage vide) et un shell avec `curl`. Le contrat webhook complet — signature, idempotence, retries — vit dans [Webhooks](/fr/develop/webhooks) ; ce parcours est la plus petite utilisation de bout en bout du côté entrant.

## Avant de commencer

Confirme deux choses. Le workflow que tu vas déclencher existe et est publié — les brouillons ne se déclenchent pas. Ton rôle est au moins Developer — créer des clés de déclencheur est restreint à Developer et au-dessus. Si tu n'as pas encore de workflow, le petit canonique est « logue la charge utile dans l'enregistrement d'exécution » ; crée-le via [Workflow avec approbations](/fr/tutorials/editor/workflow-with-approvals) et retire l'étape d'approbation pour ce parcours.

## Étape 1 — Ajouter un déclencheur webhook au workflow

Le premier geste est de lier un déclencheur webhook au workflow. Sans déclencheur, le workflow n'est appelable que depuis l'UI ; avec un, il obtient une URL et une clé.

Ouvre l'éditeur de workflow, clique le nœud déclencheur en haut et choisis **Webhook**. Donne-lui un nom (`order-created`) — l'URL générée par Tale utilise ce nom. Enregistre. Le panneau de droite affiche désormais deux choses dont tu as besoin : l'**URL du déclencheur** et la **Clé du déclencheur**.

Tale affiche la clé une seule fois, comme toute autre clé API. Copie-la ; tu ne la reverras pas.

```bash
export TALE_TRIGGER_KEY="tk_trigger_..."
export TALE_TRIGGER_URL="https://your-host.example.com/api/v1/workflows/triggers/order-created"
```

## Étape 2 — POSTer une charge utile depuis curl

Une URL de déclencheur est un endpoint POST classique. Le corps devient l'entrée de la première étape du workflow ; la réponse porte l'ID d'exécution pour que l'appelant corrèle les runs.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Authorization: Bearer $TALE_TRIGGER_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

Un 200 renvoie `{ "executionId": "exe_..." }`. Le workflow tourne maintenant en asynchrone ; ouvre l'onglet **Executions** du workflow et tu devrais voir un run en cours avec ta charge utile comme entrée du déclencheur.

Un 401 veut dire que la clé est fausse ; un 404 que le nom de déclencheur dans l'URL ne correspond à aucun workflow publié ; un 422 que le workflow est archivé ou le déclencheur désactivé.

## Étape 3 — Sécuriser les retries avec l'idempotence

Les systèmes externes rejouent sur timeouts et erreurs 5xx ; sans idempotence, un rejeu déclenche le workflow deux fois. L'en-tête `Idempotency-Key` de l'étape 2 est la solution : Tale stocke la clé pendant 24 heures et renvoie l'exécution d'origine à chaque rejeu avec la même clé.

Teste-le en rejouant exactement la même requête curl ci-dessus. La réponse porte le même `executionId` que le premier appel, et l'onglet **Executions** du workflow montre toujours un seul run. Change la clé en `order-12346` et curl à nouveau — celui-là déclenche un second run.

Le système source doit utiliser une clé stable et déterministe par événement logique. Un schéma courant est `<event-type>-<event-id>` ; n'utilise jamais un UUID aléatoire généré au moment du rejeu, sinon chaque rejeu crée un nouveau run.

## Où ça s'utilise

Les déclencheurs webhook sont la moitié entrante de l'API de workflow de Tale — la couture où ton CRM, ton système de commandes ou ton outil de monitoring POSTe. Sers-t'en pour « ceci s'est passé dans notre monde, lance un workflow Tale dessus » ; tourne-toi vers la [référence de l'API](/fr/develop/api-reference) quand tu veux une réponse synchrone à la place.

Pour la moitié sortante — Tale POSTant à ton URL quand un événement Tale arrive — et pour le contrat complet de signature et de retries, voir [Webhooks](/fr/develop/webhooks). La configuration côté workflow du déclencheur vit sur la page [Concepts de workflow](/fr/platform/workflows/concepts).
