---
title: Déclencheurs de workflow
description: Les trois façons dont un workflow démarre tout seul — Planifications, Webhooks et Événements — ce que chacune transporte dans l’exécution, et comment en mettre une en pause sans la supprimer.
---

Un déclencheur est ce qui démarre un workflow sans qu’un humain clique quoi que ce soit. L’onglet **Déclencheurs** d’un workflow porte trois sections — **Planifications**, **Webhooks** et **Événements** — et un workflow peut tenir plusieurs déclencheurs de n’importe quel mélange ; tous alimentent la même première étape. Un workflow sans déclencheur s’exécute toujours à la main depuis le panneau **Tester le workflow** de l’éditeur — utile pendant la construction, jamais pour la production.

<Frame caption="L’onglet Déclencheurs avec la section Événements dépliée — un déclencheur d’événement, sa bascule Actif et son heure de dernier déclenchement.">

![L’onglet Déclencheurs d’une automatisation montrant les sections Planifications et Webhooks repliées et une section Événements dépliée avec une ligne de déclencheur task.created.](/images/platform/automation-triggers.webp)

</Frame>

## Planifications

Clique sur **Ajouter une planification** pour exécuter le workflow sur une horloge. Le formulaire prend une expression cron standard à 5 champs, avec des préréglages de **Toutes les 5 minutes** à **Tous les mois** — ou décris le rythme en langage courant et clique sur **Générer** pour laisser l’IA écrire le cron à ta place. Les **Variables du workflow** sont l’entrée que chaque exécution planifiée reçoit, préremplie depuis le schéma d’entrée du workflow. La ligne montre l’heure de **Dernier déclenchement** de la planification et qui l’a créée.

## Webhooks

Clique sur **Ajouter un webhook** et Tale frappe une URL unique ; tout système qui y envoie un POST JSON lance l’exécution, avec le corps de la requête comme entrée de l’exécution.

<Warning>

Sauvegarde l’URL du webhook au moment où elle s’affiche — le token dans l’URL fait office d’identifiant d’authentification. Quiconque détient l’URL peut lancer le workflow, donc traite-la comme un secret et supprime le webhook pour la révoquer.

</Warning>

## Événements

Clique sur **Ajouter un déclencheur d'événement** et choisis un type d’événement dans la liste déroulante — des choses qui se produisent dans Tale, comme `task.created`, `conversation.message_received`, `customer.updated` ou `workflow.completed`. Des filtres optionnels resserrent quand le déclencheur se lance, et le payload de l’événement devient l’entrée de l’exécution. Va vers un déclencheur d’événement quand le travail du workflow est de réagir à quelque chose que Tale vient de faire.

<Note>

Un workflow qui appartient à une [automatisation](/fr/platform/automations/concepts) ne s’exécute que depuis son automatisation — il ne peut pas s’abonner lui-même aux événements.

</Note>

## Choisir le bon déclencheur

| Utilise … quand                                    | Planification | Webhook | Événement |
| -------------------------------------------------- | ------------- | ------- | --------- |
| Le travail revient sur une horloge                 | ✓             |         |           |
| Un système externe signale le travail              |               | ✓       |           |
| Quelque chose que Tale a fait est la raison d’agir |               |         | ✓         |

Un workflow peut en porter plus d’un — une planification quotidienne plus un webhook pour des coups d’envoi externes ad hoc forment une paire courante.

## Mettre en pause et supprimer

Chaque ligne de déclencheur a une bascule **Actif**. La couper arrête les lancements sans perdre la ligne ni l’historique d’exécution ; la remettre reprend immédiatement. Supprimer la ligne est définitif — pour les webhooks cela tue aussi l’URL, donc tout système qui y envoie encore des POST cesse de fonctionner.

## Où cela s’inscrit

Les déclencheurs sont la couche du coup d’envoi ; les étapes derrière eux sont le travail réel. Va sur [Concepts d’automatisation](/fr/platform/automations/concepts) pour le modèle qu’un déclencheur alimente, et sur [Journaux d’exécution](/fr/platform/automations/execution-logs) pour voir ce que chaque exécution lancée a enregistré — y compris quel déclencheur l’a démarrée.
