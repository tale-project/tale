---
title: Gérer les tâches d’un projet
description: Crée une tâche, désigne son responsable, suis sa progression et examine le résultat au même endroit.
---

Une tâche regroupe le but d’un travail, son responsable, son statut, ses fichiers et les échanges autour du résultat. Utilise le tableau du projet pour le travail confié à une personne comme pour celui délégué à un agent. Tu dois pouvoir modifier le projet pour changer ses tâches.

<Frame caption="Le tableau classe les tâches par statut. Passe à Liste pour retrouver les mêmes tâches sous forme de lignes.">

![Le tableau du projet Website relaunch affiche des cartes dans Backlog, À faire, En cours, En revue, Terminé et Annulé.](/images/platform/projects-task-board.webp)

</Frame>

## Créer une tâche avec un résultat précis

1. Ouvre **Tâches** dans le projet, puis clique sur **Créer une tâche**.
2. Donne au **Titre** le nom du résultat attendu, par exemple « Vérifier le brief de lancement ».
3. Explique dans **Description** ce qui est demandé et comment le résultat sera vérifié. Ajoute les fichiers nécessaires en pièces jointes.
4. Choisis au besoin **Statut**, **Priorité** et **Assigné à**. Une nouvelle tâche commence à **À faire**. Utilise **Backlog** pour une proposition qui n’a pas encore été retenue.
5. Clique sur **Créer une tâche**, puis ouvre la carte pour compléter ses détails.

Tale attribue un identifiant à partir de la clé du projet, par exemple `WEB-1`. Utilise-le pour désigner le travail sans confondre des tâches aux titres proches.

<Tip>

Une description utile précise les éléments de départ, le résultat attendu et un critère de fin. Par exemple : « Compare la date de revue du brief joint avec les notes de réunion. Signale toute différence dans un commentaire en citant les deux fichiers. »

</Tip>

<Frame caption="Les détails réunissent description, pièces jointes, sous-tâches et commentaires à côté du responsable et du statut.">

![La tâche Sign off the launch checklist affiche sa description, ses pièces jointes, sous-tâches, commentaires, statut, responsable, relecteur, dates, étiquettes et dépendances.](/images/platform/project-task-detail.webp)

</Frame>

## Désigner un responsable et un relecteur

**Assigné à** indique qui fait le travail : une personne, un agent du projet ou une automatisation disponible dans ce projet. **Relecteur** désigne la personne à prévenir lorsque le résultat d’un agent attend une revue. Seuls les membres qui peuvent modifier le projet peuvent être relecteurs.

Assigner un agent et lancer son exécution sont deux choix distincts. Après l’assignation, clique sur **Démarrer l'agent** ou passe la tâche à **En cours**. Lis [Automatiser les tâches](/fr/platform/projects/task-automation) avant de lancer un travail qui utilise des services connectés ou produit des fichiers.

Le relecteur reçoit la demande de revue, sans être le seul autorisé à décider. Un autre membre disposant du droit de modification peut aussi accepter le résultat.

## Montrer la progression avec les statuts

Modifie **Statut** dans les détails de la tâche ou déplace sa carte vers une autre colonne du tableau. Le sélecteur de statut offre une alternative au glisser-déposer utilisable au clavier.

| Statut | Signification |
| --- | --- |
| **Backlog** | Travail proposé, mais pas encore retenu. |
| **À faire** | Travail prêt à démarrer. |
| **En cours** | Travail commencé. Pour une tâche assignée à un agent, passer à ce statut lance son exécution. |
| **En revue** | Résultat en attente d’une vérification humaine. |
| **Terminé** | Une personne a accepté le travail accompli. |
| **Annulé** | Travail abandonné. |

Pour une tâche d’agent, changer de statut peut démarrer ou annuler une exécution. Lis l’indication de l’action avant de déplacer la carte. Un agent remet son résultat à **En revue** ; il ne peut pas le marquer lui-même **Terminé**.

## Garder les décisions avec le travail

Ouvre la tâche pour ajouter une description, des pièces jointes, des dates, des étiquettes, des sous-tâches ou des commentaires. Consigne dans les commentaires les questions, décisions et retours qu’un futur relecteur devra comprendre.

Saisis `@` dans un commentaire pour ouvrir le sélecteur de mentions. Mentionner l’agent assigné constitue une instruction : cela peut guider une exécution en cours ou en démarrer une autre si l’agent est inactif. Un commentaire sans mention conserve l’échange sans demander cette action à l’agent.

Utilise **Sous-tâches** pour séparer des résultats vérifiables indépendamment. Une tâche parente ne peut pas être clôturée tant que ses sous-tâches restent ouvertes. **Dépendances** indique ce qui bloque la tâche et ce qu’elle bloque. Les dépendances circulaires sont refusées.

## Vérifier le résultat avant de clôturer

Pour une tâche humaine, compare le travail au critère de fin décrit dans la tâche. Pour un agent, lis son compte rendu dans les commentaires et examine les fichiers produits. Une exécution terminée indique que l’agent a cessé de travailler ; le résultat attend encore son acceptation par une personne.

Passe la tâche à **Terminé** lorsqu’elle répond au besoin. Si l’agent doit reprendre son travail, explique précisément la modification attendue dans un commentaire et mentionne-le. [Automatiser les tâches](/fr/platform/projects/task-automation) détaille les reprises, nouvelles tentatives et annulations.

## Retrouver le travail à suivre

Réduis le tableau avec les filtres ou passe à la liste pour parcourir les tâches ligne par ligne. Garde les propositions dans le [Backlog](/fr/platform/projects/backlog) jusqu’à leur démarrage. Utilise des étiquettes pour les distinctions qui ne demandent pas un nouveau statut.

Si une modification est refusée, vérifie l’état de la tâche avant de réessayer : une exécution active empêche de réassigner l’agent, des sous-tâches ouvertes empêchent la clôture, et l’accès au projet détermine tes droits de modification.
