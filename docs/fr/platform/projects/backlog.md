---
title: Backlog du projet
description: Le Backlog est le statut d’entrée du tableau pour le travail auquel personne ne s’est encore engagé — comment une tâche y atterrit et comment tu la fais avancer avec les mêmes contrôles que dans toute autre colonne.
---

Une tâche au statut **Backlog** est du travail proposé auquel personne ne s’est encore engagé. Elle vit dans la colonne la plus à gauche du tableau et la section du haut de la liste, avec la même carte, la même fiche de détail, le même sélecteur de statut et le même sélecteur d’affectation que tout autre statut — il n’y a pas de contrôles réservés au backlog. Rien de livré ne remplit la colonne tout seul dans cette version : [Trier les issues GitHub](/fr/platform/automations/builtin) évalue les issues et renvoie un rapport, et aucune automatisation ne synchronise d’issues en tâches. Le Backlog se remplit quand une personne ou un agent dépose une proposition.

## Comment une tâche atterrit dans le Backlog

Crée une tâche et choisis **Backlog** dans le sélecteur de statut du formulaire de création — il propose **À faire** par défaut. Un agent peut aussi en déposer une : un agent de projet équipé de l’outil de création de tâches ne peut créer que dans **Backlog** ou **À faire**, nulle part ailleurs, si bien qu’une proposition faite par un agent n’atterrit jamais dans une colonne de travail ni dans une colonne terminale. La même règle vaut pour une automatisation qui tourne avec les outils de tâches d’un projet.

## Faire avancer le travail

Glisse la carte vers une autre colonne, ouvre la fiche de détail et choisis un nouveau statut, ou affecte un responsable — les mêmes chemins que pour **À faire** ou **En cours**. L’affectation est permise tant qu’une tâche est dans le Backlog ; tu peux donc confier une proposition à une personne ou à un agent de projet avant qu’elle bouge. Affecter un agent de projet et cliquer sur **Démarrer l'agent** le met au travail, et [Automatisation des tâches](/fr/platform/projects/task-automation) couvre ce qui se passe ensuite. Écarte une proposition comme tu fermes toute autre tâche : passe son statut à **Annulé**.

## Où cela se place

Le Backlog est la colonne d’entrée entre une proposition — la tienne, celle d’un collègue ou celle d’un agent — et l’équipe qui s’y engage. [Automatisation des tâches](/fr/platform/projects/task-automation) est la lecture suivante pour la boucle dans laquelle une tâche entre une fois affectée ; [Automatisations livrées](/fr/platform/automations/builtin) explique pourquoi le paquet GitHub livré rapporte au lieu de créer des tâches.
