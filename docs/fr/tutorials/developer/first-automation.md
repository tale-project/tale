---
title: "Ta première automatisation : un récapitulatif quotidien des tâches"
description: Crée une automatisation à partir du modèle Récapitulatif quotidien des tâches, exécute-la une fois à la main et retrouve le récapitulatif dans tes notifications.
---

Dans ce tutoriel, tu crées une automatisation à partir d’un modèle d’automatisation, tu l’exécutes une fois et tu lis ce qu’elle a envoyé. Le **Récapitulatif quotidien des tâches** liste les tâches créées dans un projet la veille et les envoie chaque matin à un membre ; tu le configures pour l’un de tes projets et te l’envoies à toi-même.

Il te faut le rôle Propriétaire, Admin ou Développeur, et un projet que tu peux ouvrir dans lequel au moins une tâche a été créée au cours des dernières 24 heures. S’il n’en a pas, ajoute-en une sur son board.

## Créer l’automatisation

1. Ouvre **Automatisations** et choisis **Créer une automatisation** › **À partir d’un modèle**.
2. Choisis **Récapitulatif quotidien des tâches**.
3. Sous **Projet**, choisis ton projet. Sous **Envoyer à**, choisis-toi.
4. Laisse **Quand** sur chaque jour à 09:00 dans ton fuseau horaire, et laisse **Démarrer maintenant** coché.
5. Choisis **Créer l’automatisation**.

L’automatisation s’ouvre dans l’éditeur. Sa version 1 est en service et son horaire est activé.

<Frame caption="Daily task digest est l’un des modèles de la galerie.">

![La boîte de dialogue Choose a starter avec un champ de recherche et six modèles, dont Daily task digest, qui envoie chaque matin à un membre les tâches créées la veille dans un projet.](/images/platform/automation-starter-gallery.webp)

</Frame>

## L’exécuter une fois maintenant

Tu n’as pas besoin d’attendre 09:00. Dans l’en-tête de l’éditeur, choisis **Exécuter en réel**, puis confirme avec **Exécuter en réel**. L’exécution liste les tâches du projet des dernières 24 heures et t’envoie le récapitulatif.

Ouvre **Exécutions** pour la suivre. Quand l’exécution indique **Réussie**, choisis-la, puis son étape **Tasks** : **Returned** liste les tâches qu’elle a lues.

<Frame caption="L’exécution, avec son étape Tasks sélectionnée : les tâches lues, la plus récente d’abord.">

![La page d’une exécution réussie en direct de Daily task digest avec l’étape Tasks sélectionnée, une étape Tasks · List tasks ; sous Returned figure une liste de 7 tâches.](/images/platform/automation-task-list-run.webp)

</Frame>

## Lire le récapitulatif

Ouvre tes notifications. Le récapitulatif arrive sous le titre **Nouvelles tâches** : une ligne par tâche avec son numéro, son titre et la personne assignée, puis la ligne **Envoyé par l’automatisation** suivie de son nom. Choisis-le pour ouvrir les tâches du projet.

Un jour sans nouvelle tâche n’envoie rien, et l’exécution réussit quand même.

## Pour aller plus loin

- Change quand elle s’exécute dans l’onglet **Général**, sous **Déclencheur**.
- Vois ce que font les autres modèles dans [Partir d’un modèle](/fr/platform/automations/starters).
- Modifie ses étapes dans l’[éditeur](/fr/platform/automations/editor) ; [Ajouter des tâches depuis une automatisation](/fr/platform/automations/add-tasks) explique l’étape `task.list` qu’elle utilise.
