---
title: Concepts des automatisations
description: Comment workflows, étapes, triggers et variables s'articulent.
---

Une automatisation est un petit programme déterministe qui démarre quand quelque chose le déclenche. Contrairement au chat — ouvert — les automatisations font exactement ce que leurs étapes disent, dans l'ordre, à chaque fois. C'est ainsi qu'on met l'IA en arrière-plan d'un processus métier : imports nocturnes, fan-out de webhooks entrants, résumés programmés, tout ce qui doit se passer sans humain dans le chat.

Les pièces ci-dessous — workflow, étape, trigger, variable — sont le petit vocabulaire que le reste de cette section présuppose. Lis-les une fois et l'éditeur, la config des triggers et les journaux d'exécution deviennent navigables par eux-mêmes.

## Workflow

Un workflow est toute l'automatisation. Il a un nom, une description, une liste d'étapes, un ou plusieurs triggers et un petit ensemble de réglages (timeout, retries, variables). Un workflow est une unité exécutable ; tu le publies, le versionnes et l'observes comme une seule pièce.

## Étape

Une étape est une unité de travail. La plateforme fournit six types, chacun codé en couleur dans l'éditeur pour que l'intention d'un workflow se lise d'un coup d'œil :

| Étape         | Couleur | Ce qu'elle fait                                                                                                     |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| **Start**     | Bleu    | point d'entrée. Définit le schéma d'entrée et quels triggers démarrent le workflow.                                 |
| **Action**    | Orange  | exécute une opération — appeler une API, interroger une base, envoyer un courriel, mettre à jour un enregistrement. |
| **LLM**       | Violet  | envoie un prompt à un modèle IA et passe la réponse à l'étape suivante.                                             |
| **Condition** | Ambre   | vérifie une condition et route selon plusieurs branches.                                                            |
| **Loop**      | Cyan    | répète un ensemble d'étapes pour chaque élément d'une liste.                                                        |
| **Output**    | Vert    | définit la forme des données renvoyées quand le workflow finit.                                                     |

Les étapes sont connectées par des liens orientés. L'exécution suit les liens de Start à Output ; les branches d'une Condition sont parcourues indépendamment ; les Loops répètent leur bloc interne par élément de liste.

## Trigger

Un trigger dit au workflow quand tourner. La plateforme en supporte trois : un calendrier (style cron), un événement (quelque chose s'est passé dans Tale) et un webhook (un système externe nous a appelés). Un workflow peut avoir plusieurs triggers — le même fan-out tourne sur calendrier nocturne _et_ dès qu'un webhook arrive. Voir [Triggers](/fr/platform/automations/triggers) pour les détails de chaque type et la syntaxe de configuration.

## Variables

Les variables sont des données clé-valeur partagées, accessibles depuis chaque étape. Utile pour des clés API référencées par plusieurs étapes, des feature flags qui changent le comportement du workflow et des constantes qu'on ne veut pas répéter dans chaque config d'étape. Les variables vivent dans l'onglet Configuration du workflow et toute étape peut les lire via `{{ variables.name }}`.

## Brouillon vs Actif

Les workflows, comme les agents, utilisent un modèle brouillon-et-publication. Un workflow ne peut être activé qu'après publication. Les modifications après activation créent un nouveau brouillon qui tourne à côté de la version active jusqu'à la prochaine publication — tu peux donc retravailler une étape sans interrompre l'automatisation active.

## Runs et exécutions

Chaque déclenchement crée une **exécution**. Les exécutions vivent dans l'onglet Exécutions du workflow avec date de début, durée, statut final et détail par étape (entrées, sorties, erreurs). Le journal d'exécution est l'endroit où tu débogues les échecs : chaque étape enregistre son entrée, sa sortie et toute erreur levée, donc un `400 Bad Request` d'une API tierce est à un clic du payload exact qui l'a produit. Voir [Journaux d'exécution](/fr/platform/automations/execution-logs).

## En construire un

Le vocabulaire ci-dessus est tout le modèle. La page suivante est l'éditeur qui le transforme en workflow exécutable : [Workflows](/fr/platform/automations/workflows).
