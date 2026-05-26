---
title: Concepts d'automatisation
description: Une automatisation est une définition de workflow plus un déclencheur plus un historique d'exécutions. Cette page nomme les quatre pièces et montre comment un rapport quotidien y circule.
---

Une automatisation est l'unité vers laquelle Tale se tourne quand le travail est multi-étapes et que tu veux des approbations, de la planification ou des déclencheurs externes entre les étapes. Elle est une définition de workflow plus un déclencheur plus un historique d'exécutions — trois choses que tu composes pour transformer une tâche récurrente en un graphe qui s'exécute lui-même.

Cette page te donne le vocabulaire que le reste de la section automatisations présuppose. Lis-la avant de construire un workflow, et reviens-y quand tu ne sais plus si un comportement appartient à une étape, au déclencheur ou à un point d'approbation.

## Les quatre pièces

**Workflows** sont la définition — l'ensemble ordonné d'étapes avec leurs entrées et sorties. Les étapes peuvent s'exécuter en séquence, en parallèle ou derrière une branche conditionnelle. Un workflow est versionné ; chaque enregistrement crée une nouvelle version à laquelle tu peux revenir.

**Déclencheurs** décident quand un workflow tourne. Quatre types de déclencheurs sont fournis : manuel (un bouton dans l'UI), planifié (de forme cron), webhook (un système externe POST sur une URL) et événement (quelque chose se passe dans Tale — un document est téléversé, un agent termine une réponse).

**Étapes** sont ce qui s'exécute. Des types d'étapes intégrés appellent des agents, exécutent du code sandbox, frappent des API externes, écrivent dans la base de connaissances, envoient du mail ou attendent une entrée humaine. Les étapes qui touchent l'extérieur sont enveloppées de clés d'idempotence pour qu'un retry ne tire pas en double.

**Exécutions** sont l'historique des passages. Chaque déclenchement de workflow crée un enregistrement d'exécution : qui a déclenché, ce que chaque étape a reçu et émis, où étaient les défaillances, combien de temps cela a pris. Le log d'exécution est à la fois la piste d'audit et la surface de débogage.

## Approbations comme points de contrôle

Une étape de workflow peut être un point d'approbation. L'exécution s'arrête, une carte d'approbation apparaît dans le pool d'approbateurs configuré, et l'étape suivante ne tire que lorsqu'un approbateur clique sur Approuver. Rejeter termine l'exécution ; un timeout escalade ou échoue selon la configuration du point. Les approbations sont la couture entre l'automatisation et le jugement humain.

La page de concept [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) couvre les états du point et les règles de routage en détail.

## Mis bout à bout — une automatisation de rapport quotidien

Une automatisation de rapport quotidien met les quatre pièces dans une chaîne :

- Déclencheur : une planification qui tire en semaine à 08h00.
- Étape 1 : un agent qui résume les conversations clients de la veille depuis la boîte de réception.
- Étape 2 : un point d'approbation routé vers le responsable d'équipe — Approuver pour envoyer, Rejeter pour jeter.
- Étape 3 : une étape mail qui envoie le résumé approuvé à la liste de diffusion de l'équipe.

Chaque passage retient le brouillon de l'agent, la décision de l'approbateur et la liste de destinataires de l'étape mail. Si une étape échoue — l'agent dépasse son timeout, l'approbateur ne répond pas, le serveur mail est injoignable — l'exécution capture l'erreur et l'étape défaillante est rejouable depuis la vue d'exécution.

## Quand y recourir

| Utilise … quand                                              | Automatisation | Agent | Cron |
| ------------------------------------------------------------ | -------------- | ----- | ---- |
| Le travail a plusieurs étapes avec dépendances               | ✓              |       |      |
| Tu as besoin d'une approbation humaine entre étapes          | ✓              |       |      |
| Le même prompt revient mais toujours en un seul tir          |                | ✓     |      |
| Tu as juste besoin d'une commande shell récurrente sur Linux |                |       | ✓    |

Les agents sont la bonne forme pour des conversations en un seul tir ; les automatisations sont la bonne forme quand le travail a des étapes et que tu veux capturer l'entrée, la sortie et l'approbateur de chacune.

## Construis-en une

Workflows, déclencheurs, étapes et exécutions sont les quatre pièces dont chaque automatisation Tale est faite : le workflow est la recette, le déclencheur est le départ, les étapes sont les coups, l'exécution est l'enregistrement. Va vers une automatisation quand le travail a des étapes ; va vers un agent quand la conversation reste dans une voix. La lecture suivante naturelle est [Workflow avec approbations](/fr/tutorials/editor/workflow-with-approvals) — elle parcourt les quatre pièces sur une instance neuve.
