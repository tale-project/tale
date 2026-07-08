---
title: Déclencher un workflow par webhook
description: Ajoute un webhook à un workflow Tale et POSTe sur son URL depuis un système externe pour démarrer une exécution avec idempotence.
---

Un déclencheur webhook transforme un workflow Tale en quelque chose qu'un système externe peut allumer en POSTant du JSON. Tale reconnaît le jeton de l'URL, stocke la clé d'idempotence et lance une exécution — la même forme que tout webhook entrant doit prendre pour être sûr à rejouer. Ce parcours mène un workflow neuf de « je veux le déclencher depuis l'extérieur » à « un événement de commande POSTe et le workflow tourne » sur une seule instance.

Il te faut le rôle Developer dans l'organisation, un workflow existant (ou le démarrage vide) et un shell avec `curl`. Le contrat webhook complet — signature, idempotence, retries — vit dans [Webhooks](/fr/develop/webhooks) ; ce parcours est la plus petite utilisation de bout en bout du côté entrant.

## Avant de commencer

Confirme deux choses. Le workflow que tu vas déclencher existe et est publié — les brouillons ne se déclenchent pas. Ton rôle est au moins Developer — créer des clés de déclencheur est restreint à Developer et au-dessus. Si tu n'as pas encore de workflow, le petit canonique est « logue la charge utile dans l'enregistrement d'exécution » ; crée-le via [Workflow avec approbations](/fr/tutorials/editor/workflow-with-approvals) et retire l'étape d'approbation pour ce parcours.

## Étape 1 — Ajouter un déclencheur webhook au workflow

Le premier geste est de lier un déclencheur webhook au workflow. Sans déclencheur, le workflow n'est appelable que depuis l'UI ; avec un, il obtient une URL sur laquelle n'importe quel système peut POSTer.

Ouvre l'onglet **Déclencheurs** du workflow et clique sur **Ajouter un webhook**. Tale émet une **URL de webhook** unique, avec le justificatif embarqué comme jeton dans le chemin — il n'y a ni nom de déclencheur ni clé séparée.

Enregistre l'URL quand elle s'affiche : quiconque la détient peut tirer le workflow, traite-la donc entièrement comme un secret. Supprimer le webhook la révoque.

```bash
export TALE_TRIGGER_URL="https://your-host.example.com/api/workflows/wh/<token>"
```

## Étape 2 — POSTer une charge utile depuis curl

L'URL de webhook est un endpoint POST classique. Le corps devient l'entrée de la première étape du workflow ; un en-tête `Idempotency-Key` rend les rejeux sûrs — un rejeu renvoie l'exécution d'origine au lieu d'en lancer une nouvelle.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

Un 200 renvoie `{ "status": "accepted", "workflowSlug": "..." }`. Le workflow tourne maintenant en asynchrone ; ouvre l'onglet **Exécutions** du workflow et tu devrais voir une exécution en cours avec ta charge utile comme entrée du déclencheur.

Un 404 veut dire que le jeton de l'URL ne correspond à aucun webhook ; un 403 que le webhook est désactivé ou que le workflow n'est plus installé ; un 429 que l'IP appelante a atteint la limite de débit.

## Étape 3 — Sécuriser les retries avec l'idempotence

Les systèmes externes rejouent sur timeouts et erreurs 5xx ; sans idempotence, un rejeu déclenche le workflow deux fois. L'en-tête `Idempotency-Key` de l'étape 2 est la solution : Tale mémorise la clé par organisation et répond au rejeu par `{ "status": "duplicate", "executionId": "..." }` — l'exécution d'origine — au lieu de déclencher à nouveau.

Teste-le en rejouant exactement la même requête curl ci-dessus. La réponse porte l'`executionId` du premier appel, et l'onglet **Exécutions** du workflow montre toujours une seule exécution. Change la clé en `order-12346` et curl à nouveau — celui-là déclenche une seconde exécution.

Le système source doit utiliser une clé stable et déterministe par événement logique. Un schéma courant est `<event-type>-<event-id>` ; n'utilise jamais un UUID aléatoire généré au moment du rejeu, sinon chaque rejeu crée une nouvelle exécution.

## Où ça s'utilise

Les déclencheurs webhook sont la moitié entrante de l'API de workflows de Tale — la couture où ton CRM, ton système de commandes ou ton outil de monitoring POSTe. Sers-t'en pour « ceci s'est passé dans notre monde, lance un workflow Tale dessus » ; tourne-toi vers la [référence de l'API](/fr/develop/api-reference) quand tu veux une réponse synchrone à la place.

Pour la moitié sortante — Tale POSTant à ton URL quand un événement Tale arrive — et pour le contrat complet de signature et de retries, voir [Webhooks](/fr/develop/webhooks). La configuration côté workflow du déclencheur vit sur la page [Déclencheurs de workflow](/fr/platform/automations/triggers).
