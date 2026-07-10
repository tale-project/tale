---
title: Backlog du projet
description: Le backlog est un statut du tableau pour le travail proposé — les automatisations y synchronisent les issues, et tu déplaces les tâches avec les mêmes contrôles de glisser, de statut et d’affectation que pour toute autre colonne.
---

Une tâche au statut **`backlog`** est du travail proposé auquel personne ne s’est encore engagé — le plus souvent synchronisé par une automatisation comme [Trier les issues GitHub](/fr/platform/automations/builtin). Elle vit dans la **colonne la plus à gauche** du Tableau et la **section du haut** de la Liste, avec la même carte, la même fiche de détail, le même sélecteur de statut et le même sélecteur d’affectation que tout autre statut. [Automatisation des tâches](/fr/platform/projects/task-automation) couvre ce qui se passe une fois qu’une tâche atteint **À faire** et entre dans la boucle d’affectation.

## Une tâche synchronisée

Trier les issues GitHub propose une tâche par issue ouverte exploitable, rattachée à l’issue pour qu’une synchronisation ultérieure ne la crée jamais en double : le titre est `#<numéro> <titre>` — par exemple `#482 Bouton de connexion mal aligné sur Safari` —, la description s’ouvre sur l’URL GitHub de l’issue elle-même, et ses étiquettes reflètent celles de l’issue sur GitHub. Une tâche que tu crées depuis le tableau avec le statut par défaut démarre à **À faire** ; choisis **Backlog** dans le formulaire de création pour déposer toi-même une proposition.

## Faire avancer le travail

Il n’y a pas de boutons réservés au backlog. Glisse une carte vers une autre colonne, ouvre la fiche de détail et choisis un nouveau statut, ou affecte un responsable — les mêmes chemins que pour **À faire** ou **En cours**. L’auto-affectation et les suggestions d’affectation par agent ne tournent qu’à **À faire**, pas tant que la tâche reste en **Backlog**. Si tu passes une proposition directement à **En cours** ou si tu l’affectes à la main, tu prends la responsabilité toi-même.

Écarte une proposition comme toute autre tâche : passe le statut à **Annulé** dans le sélecteur. Une annulation humaine tient — une synchronisation GitHub ultérieure ne ressuscite pas une proposition que tu as rejetée tant que l’issue reste ouverte sur GitHub. Quand une tâche était **Terminée** sur le tableau et que quelqu’un rouvre l’issue sur GitHub, la synchronisation la remet en **Backlog**.

## Où cela s’inscrit

Le backlog est la colonne d’entrée entre une automatisation qui propose du travail et ton équipe qui s’y engage. La lecture suivante naturelle est [Automatisation des tâches](/fr/platform/projects/task-automation) pour ce qui se passe à **À faire**, ou [Automatisations livrées](/fr/platform/automations/builtin) pour ce qui propose des tâches en premier lieu.
