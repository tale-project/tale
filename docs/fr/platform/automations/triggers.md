---
title: Déclencheurs de workflow
description: Les quatre façons dont un workflow peut démarrer — manuel, planification, webhook, événement — ce que chacun porte dans l'exécution, et comment basculer entre eux sans reconstruire le workflow.
---

Un déclencheur est ce qui démarre un workflow. Tale livre quatre types de déclencheurs : manuel (un bouton), planification (cron), webhook (un POST externe) et événement (quelque chose arrive dans Tale). Chaque workflow a au moins un déclencheur ; certains en ont plusieurs. Cette page est la référence pour ce que chaque déclencheur porte dans l'exécution, comment le configurer, et comment choisir entre eux quand plus d'un fonctionnerait.

Le modèle mental des workflows, étapes, exécutions et approbations vit sur [Concepts d'automatisation](/fr/platform/automations/concepts). Les déclencheurs sont la couche de démarrage au-dessus de ce modèle ; le reste du workflow n'a pas besoin de savoir quel déclencheur l'a lancé, mais les entrées que reçoit la première étape viennent du déclencheur que Tale vient de tirer.

## Où vivent les déclencheurs

Ouvre le workflow et bascule sur l'onglet **Déclencheurs**. L'onglet liste les déclencheurs actuels du workflow et te laisse en ajouter des nouveaux. Un workflow sans déclencheur ne tourne que depuis le bouton **Exécuter maintenant** dans l'éditeur — utile pour tester, jamais pour la production.

Un workflow peut porter plusieurs déclencheurs du même type ou de types différents. Un workflow de rapport quotidien pourrait avoir un déclencheur de planification qui se déclenche chaque matin de semaine plus un déclencheur manuel pour qu'un humain le tire en ad-hoc ; les deux alimentent la même première étape.

## Les quatre types de déclencheurs

**Manuel** est un bouton. Les Membres et Éditeurs ayant accès au workflow le voient sous **Automatisations > Exécutions manuelles** ; cliquer le bouton ouvre le formulaire d'entrée (un champ par entrée déclarée) et démarre l'exécution. Va vers manuel quand le workflow est occasionnel et qu'un humain sait quand il doit tourner.

**Planification** est cron. Le déclencheur se déclenche sur un motif horaire récurrent — chaque jour de semaine à 08:00, le premier de chaque mois, toutes les 15 minutes. Le déclencheur de planification ne porte pas de charge utile propre ; la première étape ne voit que les entrées déclarées du workflow (typiquement valorisées par défaut sur le déclencheur). Va vers planification quand le workflow se répète sur une horloge.

**Webhook** est un POST externe. Tale forge une URL unique pour le déclencheur ; tout système qui POST à cette URL déclenche l'exécution. Le déclencheur webhook porte le corps JSON de la requête comme entrée de la première étape. Va vers webhook quand un système externe signale qu'il faut faire du travail — une notification d'un fournisseur, la fin d'une tâche CI, une soumission de formulaire.

**Événement** est un signal interne. Tale émet des événements quand des choses changent dans le produit — un document est téléversé, un agent termine une réponse, une approbation est résolue, un client est créé. Le déclencheur événement s'abonne à un de ces événements et porte la charge utile de l'événement comme entrée de la première étape. Va vers événement quand le rôle du workflow est de réagir à quelque chose que Tale vient de faire lui-même.

## Un déclencheur de planification mis en pratique

Pour faire tourner un workflow chaque jour de semaine à 08:00, ajoute un déclencheur Planification et choisis `Chaque jour de semaine à 08:00` depuis le picker (le picker accepte les expressions cron pour les formes que le builder visuel ne peut pas exprimer). La ligne d'aperçu du déclencheur montre les trois prochaines heures de déclenchement — utile pour vérifier le cron avant d'enregistrer.

Les planifications respectent le fuseau horaire de l'org. Le fuseau configuré est celui dans lequel sont interprétées les heures du picker ; faire tourner `08:00` en `Europe/Zurich` veut dire 08:00 local, pas 08:00 UTC. L'historique d'exécution enregistre l'heure murale de démarrage, le fuseau, et l'ID du déclencheur.

## Un déclencheur webhook mis en pratique

Pour accepter un POST externe, ajoute un déclencheur Webhook. Tale forge une URL de la forme `https://<ton-hôte-tale>/api/automations/triggers/<id>`, génère un secret de signature, et montre les deux dans la ligne du déclencheur. Configure le système appelant pour POST du JSON à l'URL avec le secret dans l'en-tête `X-Tale-Signature` ; le déclencheur vérifie la signature avant de déclencher l'exécution. Une requête avec une mauvaise signature renvoie `401` et ne déclenche pas.

Le schéma de charge utile du déclencheur webhook est déclaré sur le déclencheur — Tale valide le JSON entrant contre le schéma avant de déclencher. Une charge utile qui échoue à la validation renvoie `400` avec l'erreur de validation dans le corps et l'exécution ne démarre pas.

## Un déclencheur événement mis en pratique

Pour faire tourner un workflow dès qu'un événement `automation.approval.resolved` atterrit, ajoute un déclencheur Événement et choisis le type d'événement depuis le dropdown. Le schéma de charge utile du déclencheur est fixé par le type d'événement — Tale montre le schéma dans la ligne du déclencheur. Les déclencheurs événement peuvent filtrer par champs de la charge utile : ne se déclencher que si l'approbation a été approuvée (pas rejetée), ne se déclencher que pour des approbations dans une équipe spécifique, et ainsi de suite.

La surface événement est ouverte ; la liste des événements disponibles grandit avec Tale. L'ensemble actuel couvre les moments évidents du cycle de vie (téléversement de document, réponse d'agent finie, approbation résolue, identifiants d'intégration rotés, membre ajouté).

## Choisir le bon déclencheur

| Utilise … quand                                              | Manuel | Planification | Webhook | Événement |
| ------------------------------------------------------------ | ------ | ------------- | ------- | --------- |
| Un humain sait quand le travail doit tourner                 | ✓      |               |         |           |
| Le travail se répète sur une horloge                         |        | ✓             |         |           |
| Un système externe signale le travail                        |        |               | ✓       |           |
| Quelque chose que Tale a fait est la raison de tourner       |        |               |         | ✓         |
| Tu veux les deux — récurrent plus exécutions humaines ad-hoc | ✓      | ✓             |         |           |

Un workflow peut porter plus d'un déclencheur ; la colonne de type n'a pas à être une seule ligne.

## Désactiver et retirer un déclencheur

Chaque déclencheur a un commutateur activé au niveau de la ligne. Désactiver un déclencheur stoppe son déclenchement sans le retirer — l'historique d'exécution reste intact, et le réactiver restaure le déclenchement immédiatement. Va vers désactiver quand tu veux mettre un workflow en pause temporairement ; va vers supprimer quand tu es sûr que le déclencheur est retiré.

## Où cela s'inscrit

Les déclencheurs sont la couche de démarrage du modèle d'automatisation ; les étapes qui les suivent sont le vrai travail. La lecture suivante naturelle est [Concepts d'automatisation](/fr/platform/automations/concepts) pour le modèle workflow-étape-exécution dans lequel le déclencheur s'écoule, et [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows) pour le gate qui met l'exécution en pause entre étapes.
