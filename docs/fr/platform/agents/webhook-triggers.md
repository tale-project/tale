---
title: Déclencheurs webhook d'agent
description: La surface Workers — un endpoint HTTP par agent vers lequel des systèmes externes POSTent pour invoquer l'agent sans passer par Chat.
---

L'onglet **Workers** d'un agent expose un endpoint HTTP vers lequel un autre système peut POSTer. Le POST exécute l'agent contre la charge utile et retourne la réponse ; rien dans l'UI n'est impliqué. Va-y quand quelque chose hors de Tale a besoin que l'agent réponde à une question — un bot Slack, un gestionnaire de formulaire, un travail planifié.

Cette page couvre uniquement la surface Workers. Pour l'équivalent côté développeur (appeler Tale depuis des scripts quelconques), voir [Develop → API reference](/fr/develop/api-reference) ; pour des déclencheurs d'automatisation entrants qui exécutent un workflow plutôt qu'un agent, voir [Automatisations → déclencheurs](/fr/platform/automations/triggers).

## Un Worker déroulé

Ouvre l'agent et passe à **Workers**. La page montre une URL par agent et un `curl` d'exemple. POST une charge JSON avec un champ `message` ; Tale la reçoit, exécute l'agent contre le message, et retourne la réponse de l'agent comme corps de réponse. La même charge envoyée deux fois produit deux exécutions indépendantes — les Workers ne dédupliquent pas.

## Authentification

Les endpoints Worker exigent une clé API. L'endpoint montre l'URL mais pas un `curl` fonctionnel tant qu'une clé n'est pas attachée ; l'en-tête **Authorization** porte la clé comme bearer token. Renouveler la clé invalide chaque appelant actif — provisionne de nouvelles clés avant de retirer les anciennes. Les clés API se gèrent sous [Clés API](/fr/platform/admin/api-keys).

## Forme de la charge

La charge par défaut est `{"message": "…"}`. Des champs supplémentaires que les instructions de l'agent référencent peuvent être ajoutés ; ils passent dans le contexte du modèle comme entrée structurée. La réponse de l'agent est retournée comme objet JSON avec le texte de la réponse, tout appel d'outil, et toute citation. Le streaming est pris en charge quand l'appelant pose l'en-tête `Accept: text/event-stream`.

## Où ça s'inscrit

Les Workers sont l'équivalent léger, par-agent, de l'API. Ils sont utiles quand l'intégration est « cet agent unique fait cette chose unique » ; pour des flux plus riches, modélise l'appel comme une [Automatisation](/fr/platform/automations/concepts) et pointe l'intégration vers le déclencheur webhook de l'automatisation. Le tutoriel [Déclencher une automatisation via un webhook](/fr/tutorials/developer/trigger-automation-via-webhook) parcourt la forme automatisation de bout en bout.
