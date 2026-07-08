---
title: Concepts d’automatisation
description: Une automatisation est le bundle installable d’intégrations, d’agents, de compétences, d’un workflow et de vues intégrées que le catalogue des automatisations installe en une seule action. Cette page nomme les pièces et dit quand y recourir plutôt qu’à un agent ou un workflow isolés.
---

Une automatisation est l’unité vers laquelle Tale se tourne quand un travail a besoin de plus d’une pièce mobile assemblée à la main — une connexion d’intégration, un ou plusieurs agents, un workflow, parfois une page à elle — et que tu veux tout ça installé et branché en une seule action. Les Propriétaires, Admins et Développeurs installent les automatisations depuis le catalogue Automatisations ; une fois installée, les Éditeurs et Membres se servent de ce qu’elle a livré — un onglet Boîte de réception, une entrée de Backlog, un agent de chat — sans avoir besoin de savoir ce qu’il y a dessous. Cette page nomme les pièces qu’une automatisation empaquette, comment un bundle regroupe plusieurs automatisations ensemble, et quand une automatisation est la bonne unité plutôt qu’un agent seul ou un workflow seul.

## Les pièces

Le manifeste d’une automatisation nomme jusqu’à cinq types de pièces, et la plupart des automatisations n’en utilisent que quelques-unes.

**Intégrations** sont les identifiants que ses étapes et ses agents appellent — Gmail, GitHub, une base de données SQL. Une automatisation ne stocke jamais sa propre copie d’un identifiant ; elle nomme l’intégration dont elle a besoin, et l’organisation connecte cette intégration une fois, la même connexion que partagent toutes les autres automatisations et tous les agents.

**Agents** sont les agents de chat ou de tâche que l’automatisation installe — un trieur, un relecteur de pull requests, un résumeur. Une fois installés, ce sont des agents ordinaires : mentionnables dans le chat, assignables sur un tableau de projet, modifiables dans l’éditeur d’agent.

**Un workflow** est la définition unique déclencheur-plus-étapes que l’automatisation embarque — ce qui tourne réellement sur une planification, un webhook ou un clic manuel. Toutes les automatisations n’en livrent pas une : les automatisations e-mail couvertes sur [Automatisations livrées](/fr/platform/automations/builtin) n’en ont aucune, parce que lire et répondre au courrier est une page, pas une exécution planifiée.

**Vues intégrées** sont des pages que l’automatisation enregistre dans le registre de vues partagé de la plateforme, comme la Boîte de réception — la plateforme rend la page elle-même ; l’automatisation ne fait que nommer laquelle et ce sur quoi elle porte.

**Configuration** n’est pas un fichier de réglages séparé. Une automatisation qui a besoin d’une valeur d’opérateur la lit depuis l’identifiant d’une intégration ou depuis une variable de déclencheur ou de nœud d’un workflow ; l’onglet Configuration de l’automatisation est un résumé en lecture seule des pièces ci-dessus, pas un endroit où ajouter de nouveaux réglages.

## Bundles et automatisations cachées

Un bundle regroupe plusieurs automatisations qui n’ont de sens qu’installées ensemble. **[Résoudre les issues GitHub](/fr/platform/automations/builtin)** installe quatre automatisations — un trieur, un synchroniseur, un créateur de pull requests et un relecteur de pull requests — via un seul assistant d’installation agrégé, lié au projet que tu choisis. La plupart des membres d’un bundle sont cachés : ils n’apparaissent jamais comme leur propre carte dans le catalogue, parce qu’installer l’un d’eux seul n’aurait aucun sens sans ses frères. Caché ne veut pas dire disparu — l’[Assistant d’automatisation](/fr/platform/automations/assistant) peut toujours les trouver et les expliquer ; seule la grille du catalogue les masque.

## Mis bout à bout — deux combinaisons

**Répondre aux e-mails Gmail** combine le plus petit ensemble possible : une intégration (Gmail) et une vue intégrée (Boîte de réception) — pas d’agent, pas de workflow. Connecte Gmail, et l’onglet Boîte de réception est toute l’automatisation.

**Résoudre les issues GitHub** combine toutes les pièces à la fois : une intégration (GitHub), quatre agents répartis sur ses quatre membres cachés, quatre workflows, et aucune vue intégrée — elle passe par le Tableau et le Backlog déjà existants du projet plutôt que par une page à elle. Installer le bundle branche les quatre en un seul assistant agrégé, lié au projet que tu choisis.

## Quand y recourir

| Utilise … quand                                                                  | Automatisation | Agent | Workflow |
| -------------------------------------------------------------------------------- | -------------- | ----- | -------- |
| Tu veux une fonctionnalité déjà intégrée, installée en une action                | ✓              |       |          |
| La même question revient dans le chat, sans système externe en jeu               |                | ✓     |          |
| Tu câbles toi-même une toute nouvelle intégration et un déclencheur              |                |       | ✓        |
| Tu as besoin d’approbations ou de planification entre étapes et rien ne convient |                |       | ✓        |

Une automatisation est la bonne forme quand une fonctionnalité prête à l’emploi couvre le besoin — vérifie le catalogue avant de construire les pièces toi-même. Un agent ou un workflow isolés sont la bonne forme quand le travail est vraiment nouveau et que rien de livré ne le couvre.

## Construis-en un

Une automatisation est le bundle complet dont une fonctionnalité réelle a besoin — l’intégration qu’elle appelle, les agents et le workflow qui font le travail, la vue qu’elle affiche — branchés ensemble et installés en une action ; recours à un agent ou un workflow isolés seulement quand tu construis la pièce toi-même. La lecture suivante naturelle est [Parcourir et installer des automatisations](/fr/platform/automations/catalog) — elle parcourt le catalogue, le panneau latéral et l’assistant d’installation de bout en bout.
