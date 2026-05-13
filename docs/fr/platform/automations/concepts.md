---
title: Concepts des automatisations
description: Comment workflows, étapes, triggers et variables s’articulent.
---

Une automatisation est un petit programme déterministe qui démarre quand quelque chose le déclenche. Contrairement au chat — ouvert — les automatisations font exactement ce que leurs étapes disent, dans l’ordre, chaque fois. C’est ainsi qu’on met l’IA en arrière-plan des processus métier.

## Workflow

Un workflow est toute l’automatisation. Il a un nom, une description, une liste d’étapes, un ou plusieurs triggers et un ensemble de réglages (timeout, retries, variables).

## Étape

Une étape est une unité de travail. La plateforme fournit six types :

| Étape         | Couleur | Ce qu’elle fait                                                                                                  |
| ------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| **Start**     | Bleu    | point d’entrée. Définit le schéma d’entrée et quels triggers démarrent le workflow.                              |
| **Action**    | Orange  | exécute une opération — appeler une API, interroger une base, envoyer un email, mettre à jour un enregistrement. |
| **LLM**       | Violet  | envoie un prompt à un modèle IA et passe la réponse à l’étape suivante.                                          |
| **Condition** | Ambre   | vérifie une condition et route selon plusieurs branches.                                                         |
| **Loop**      | Cyan    | répète un ensemble d’étapes pour chaque élément d’une liste.                                                     |
| **Output**    | Vert    | définit la forme des données renvoyées quand le workflow finit.                                                  |

Les étapes sont connectées par des liens orientés. L’exécution suit les liens de Start à Output.

## Trigger

Un trigger dit au workflow quand tourner. Voir [Triggers](/fr/platform/automations/triggers) pour les trois types (calendrier, événement, webhook) et leur configuration.

## Variables

Les variables sont des données clé-valeur partagées, accessibles depuis chaque étape. Utile pour des clés API référencées par plusieurs étapes, des feature flags qui changent le comportement du workflow ou des constantes qu’on ne veut pas répéter dans chaque config d’étape.

Les variables vivent dans l’onglet Configuration du workflow. Toute étape peut les lire via `{{ variables.name }}`.

## Brouillon vs Actif

Les workflows, comme les agents, utilisent un modèle brouillon-et-publication. Un workflow ne peut être activé qu’après publication. Les modifications après activation créent un nouveau brouillon qui tourne à côté de la version active jusqu’à la prochaine publication.

## Runs et exécutions

Chaque déclenchement crée une **exécution**. Les exécutions vivent dans l’onglet Exécutions du workflow avec date de début, durée, statut final et détail par étape (entrées, sorties, erreurs). Voir [Journaux d’exécution](/fr/platform/automations/execution-logs).

## Suite

Prêt à en construire un ? Va à [Workflows](/fr/platform/automations/workflows).
