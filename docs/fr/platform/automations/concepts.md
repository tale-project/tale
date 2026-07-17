---
title: Concepts d’automatisation
description: Une automatisation est le bundle installable d’intégrations, d’agents, de compétences, d’un workflow et de vues intégrées — et le workflow à l’intérieur est son moteur. Cette page nomme les pièces, la mécanique d’exécution autour d’elles, et quand recourir à une automatisation plutôt qu’à un agent isolé.
---

Une automatisation est l’unité vers laquelle Tale se tourne quand un travail a besoin de plus d’une pièce mobile assemblée à la main — une connexion d’intégration, un ou plusieurs agents, un workflow, parfois une page à elle — et que tu veux tout ça installé et branché en une seule action. Les Propriétaires, Admins et Développeurs installent les automatisations depuis le catalogue Automatisations ; une fois installée, les Éditeurs et Membres se servent de ce qu’elle a livré — un onglet Boîte de réception, une entrée de Backlog, un agent de chat — sans avoir besoin de savoir ce qu’il y a dessous. Cette page nomme les pièces qu’une automatisation empaquette, le workflow qui la fait tourner, et quand une automatisation est la bonne unité plutôt qu’un agent seul.

Tu préfères regarder d’abord ? L’épisode 5 ouvre l’automatisation de triage de bout en bout et décide une vraie carte de validation à l’écran — sous-titres compris.

<Video src="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.mp4" poster="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.webp" captions="/videos/fr/tutorials/ep5-automations/ep5-automations.fr.vtt" lang="fr" title="Épisode 5 — Automatisations & validations" caption="Épisode 5 — Automatisations & validations (2:34)">

</Video>

## Ce qu’une automatisation empaquette

Le manifeste d’une automatisation nomme jusqu’à cinq types de pièces, et la plupart des automatisations n’en utilisent que quelques-unes.

**Intégrations** sont les identifiants que ses étapes et ses agents appellent — Gmail, GitHub, une base de données SQL. Une automatisation ne stocke jamais sa propre copie d’un identifiant ; elle nomme l’intégration dont elle a besoin, et l’organisation connecte cette intégration une fois, la même connexion que partagent toutes les autres automatisations et tous les agents.

**Agents** sont les agents de chat ou de tâche que l’automatisation installe — un trieur, un relecteur de pull requests, un résumeur. Une fois installés, ce sont des agents ordinaires : mentionnables dans le chat, assignables sur un tableau de projet, modifiables dans l’éditeur d’agent.

**Un workflow** est la définition unique déclencheur-plus-étapes que l’automatisation embarque — ce qui tourne réellement sur une planification, un webhook ou un clic manuel. Toutes les automatisations n’en livrent pas une : les automatisations e-mail couvertes sur [Automatisations livrées](/fr/platform/automations/builtin) n’en ont aucune, parce que lire et répondre au courrier est une page, pas une exécution planifiée.

**Vues intégrées** sont des pages que l’automatisation enregistre dans le registre de vues partagé de la plateforme, comme la Boîte de réception — la plateforme rend la page elle-même ; l’automatisation ne fait que nommer laquelle et ce sur quoi elle porte.

**Configuration** n’est pas un fichier de réglages séparé. Une automatisation qui a besoin d’une valeur d’opérateur la lit depuis l’identifiant d’une intégration ou depuis une variable de déclencheur ou de nœud d’un workflow ; l’onglet Configuration de l’automatisation est un résumé en lecture seule des pièces ci-dessus, pas un endroit où ajouter de nouveaux réglages.

## Le workflow à l’intérieur

Il n’existe pas de surface de workflow autonome dans Tale — un workflow vit et s’exécute dans son automatisation, et l’onglet **Éditeur** de celle-ci est l’endroit où tu le rencontres. La définition est un graphe d’étapes typées : les étapes **LLM** appellent un agent ou un modèle, les étapes **Action** font du travail concret comme appeler une intégration ou créer et mettre à jour des tâches sur le tableau du projet, les étapes **Condition** aiguillent le graphe sur un oui ou un non, les étapes **Boucle** répètent sur un ensemble, et les étapes **Sandbox** exécutent du code. Chaque enregistrement fige une version que tu peux restaurer depuis **Historique**. [L’éditeur de workflow](/fr/platform/automations/editor) est le manuel d’exploitation de cette surface.

Les **déclencheurs** décident quand le workflow s’exécute. Trois sortes s’attachent sur l’onglet **Déclencheurs** : les **Planifications** (cron), les **Webhooks** (un POST externe) et les **Événements** (quelque chose se produit dans Tale, comme `task.created`) — et tu peux toujours lancer une exécution à la main depuis le panneau **Tester le workflow** de l’éditeur. La [référence des déclencheurs](/fr/platform/automations/triggers) couvre chaque sorte.

Les **exécutions** sont l’historique. Chaque exécution écrit un enregistrement — statut, chronologie, l’entrée reçue et un journal par étape de ce que chaque étape a consommé et produit. L’onglet **Exécutions** est la piste d’audit et la surface de débogage en un seul endroit ; [Journaux d’exécution](/fr/platform/automations/execution-logs) en lit un de bout en bout.

## Là où les humains interviennent

Les automatisations tournent sans toi, mais elles ne changent et ne démarrent qu’avec toi : les modifications que l’éditeur IA propose sur un workflow arrivent comme cartes d’approbation avant de s’appliquer, un agent qui veut exécuter un workflow a d’abord besoin de ton approbation, et une exécution qui attend une réponse se met en pause avec le statut **En attente de saisie**. [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) couvre les trois. Une boucle qui repasse par le même portail de revue — une tâche renvoyée pour une passe de plus — ouvre une nouvelle demande à chaque tour plutôt que de réutiliser la carte déjà résolue.

## Bundles et automatisations cachées

Un bundle regroupe plusieurs automatisations qui n’ont de sens qu’installées ensemble. **[Résoudre les issues GitHub](/fr/platform/automations/builtin)** installe quatre automatisations — un trieur, un synchroniseur, un créateur de pull requests et un relecteur de pull requests — via un seul assistant d’installation agrégé, lié au projet que tu choisis. La plupart des membres d’un bundle sont cachés : ils n’apparaissent jamais comme leur propre carte dans le catalogue, parce qu’installer l’un d’eux seul n’aurait aucun sens sans ses frères. Caché ne veut pas dire disparu — l’[Assistant d’automatisation](/fr/platform/automations/assistant) peut toujours les trouver et les expliquer ; seule la grille du catalogue les masque.

## Mis bout à bout — deux combinaisons

**Synchroniser les e-mails Gmail** combine le plus petit ensemble possible : une intégration (Gmail) et une vue intégrée (Boîte de réception) — pas d’agent, pas de workflow. Connecte Gmail, et l’onglet Boîte de réception est toute l’automatisation.

**Résoudre les issues GitHub** combine toutes les pièces à la fois : une intégration (GitHub), quatre agents répartis sur ses quatre membres cachés, quatre workflows, et aucune vue intégrée — elle passe par le Tableau et le Backlog déjà existants du projet plutôt que par une page à elle. Installer le bundle branche les quatre en un seul assistant agrégé, lié au projet que tu choisis.

## Quand y recourir

| Utilise … quand                                                               | Automatisation | Agent | Webhook d’agent |
| ----------------------------------------------------------------------------- | -------------- | ----- | --------------- |
| Tu veux une fonctionnalité déjà intégrée, installée en une action             | ✓              |       |                 |
| Le travail a plusieurs étapes, des branches, des planifications ou des revues | ✓              |       |                 |
| La même question revient dans le chat, sans système externe en jeu            |                | ✓     |                 |
| Une réponse d’agent par POST entrant suffit                                   |                |       | ✓               |

Vérifie le catalogue avant de construire quoi que ce soit — l’automatisation dont tu as besoin est peut-être déjà livrée. Quand rien de livré ne convient, tu construis quand même une automatisation : décris le workflow à l’[éditeur IA](/fr/platform/automations/editor) ou téléverse un paquet, plutôt que d’assembler des pièces détachées. Un [webhook d’agent](/fr/platform/agents/webhook-triggers) est la seule couture hors de ce modèle — recours-y quand une seule réponse d’agent par message entrant suffit au travail.

## Construis-en une

Une automatisation est le bundle complet dont une fonctionnalité réelle a besoin — l’intégration qu’elle appelle, les agents qui font le travail, le workflow qui l’exécute, la vue qu’elle affiche — branchés ensemble et installés en une action, avec la mécanique d’exécution du workflow (déclencheurs, exécutions, approbations) sur les onglets de l’automatisation elle-même. La lecture suivante naturelle est [Parcourir et installer des automatisations](/fr/platform/automations/catalog) — elle parcourt le catalogue, le panneau latéral et l’assistant d’installation de bout en bout ; [L’éditeur de workflow](/fr/platform/automations/editor) prend le relais pour la surface où le moteur de l’automatisation se construit et s’ajuste.
