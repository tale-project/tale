---
title: Déléguer une tâche à un agent
description: Lance un agent, examine son résultat, demande des modifications et reprends ou annule une exécution.
---

Un agent de projet travaille sur une tâche et remet son résultat à une personne pour vérification. Assigne le travail, démarre l’exécution et garde les retours sur la tâche pour que l’agent et le relecteur partagent le même contexte. Il te faut le droit de modifier le projet, un fournisseur fonctionnel, un harness compatible et de la capacité de sandbox.

<Frame caption="Le travail des agents utilise le même tableau que le travail humain : il démarre à En cours et attend sa validation à En revue.">

![Le tableau du projet répartit les tâches entre Backlog, À faire, En cours, En revue, Terminé et Annulé.](/images/platform/projects-task-board.webp)

</Frame>

## Préparer et démarrer la tâche

1. Crée une [tâche](/fr/platform/projects/tasks) avec le résultat attendu, les critères de fin et les fichiers d’entrée.
2. Choisis un [agent de projet](/fr/platform/projects/project-agents) sous **Assigné à**.
3. Désigne dans **Relecteur** la personne qui vérifiera le résultat. À défaut, la demande revient à la personne qui a créé la tâche ou le projet.
4. Clique sur **Démarrer l'agent** ou passe la tâche à **En cours**.

L’assignation seule ne démarre pas l’exécution. Une tâche déjà assignée peut rester dans **Backlog** tant que l’équipe n’a pas décidé de la lancer. Une fois démarré, l’agent utilise la description, les commentaires et les fichiers d’entrée dans sa sandbox. La fiche d’exécution indique s’il attend ou travaille.

## Lire et accepter le résultat

L’agent publie son compte rendu dans un commentaire et joint les fichiers produits comme livrables. Il passe ensuite la tâche à **En revue**. Le relecteur reçoit une notification et, si l’envoi d’e-mails est configuré, un e-mail.

Lis le compte rendu, ouvre les livrables et compare-les aux critères de fin. Passe la tâche à **Terminé** seulement lorsque tu acceptes le travail. Tale enregistre la décision humaine ; un agent ne peut pas marquer sa propre tâche comme terminée.

**Relecteur** détermine la notification et la file de revue. Ce rôle n’empêche pas les autres membres autorisés à modifier le projet d’accepter le résultat. Changer de relecteur ne retire pas l’assignation de l’agent.

## Demander des modifications

Explique les changements attendus dans un commentaire et **mentionne l’agent assigné avec @**. Cette mention est une instruction : un agent actif peut la recevoir pendant son exécution, tandis qu’un agent inactif démarre une reprise de la conversation précédente. Le résultat revient à **En revue**.

Un commentaire sans mention conserve une note sans déclencher cette action. Le sélecteur de mentions indique si l’agent ne peut pas répondre, par exemple lorsque l’automatisation des tâches est désactivée ou suspendue.

Pour une tâche pilotée par une automation, mentionne celle qui en est responsable pour demander une nouvelle exécution. Mentionner une autre automation ne lui transfère pas la tâche et ne la démarre pas. [Automations](/fr/platform/automations/concepts) présente les workflows qui coordonnent plusieurs étapes.

## Traiter une attente ou un échec

| État ou symptôme | Action |
| --- | --- |
| Attente d’une place de sandbox | La capacité simultanée de l’organisation est atteinte. Attends une place ou demande à un admin d’examiner [Sandboxes](/fr/platform/admin/sandboxes). |
| Nouvelle tentative automatique affichée | Tale reprend après un échec récupérable. Surveille le compteur sans lancer une autre exécution. |
| L’exécution reste en échec | Lis l’erreur, corrige sa cause, puis utilise **Relancer** pour continuer la conversation. Un agent supprimé ou une limite de temps atteinte demande une intervention. |
| Réassignation refusée | Annule l’exécution active avant de choisir un autre responsable. |
| Automatisation suspendue sur une tâche | Des démarrages trop fréquents ont déclenché la protection. Examine le travail répété avant qu’un changement de statut humain lève la pause. |
| Clôture impossible | Termine d’abord les sous-tâches ouvertes. |

Un échec récupérable donne lieu à trois tentatives immédiates au maximum. Une exécution qui progresse pendant au moins quinze minutes reçoit une nouvelle réserve de tentatives. Cela aide le travail long à reprendre après une interruption, sans prouver que le résultat est correct.

## Annuler ou suspendre le travail

Utilise **Annuler l'exécution** pour arrêter l’agent actif. Déplacer une tâche d’agent hors de **En cours** peut aussi annuler son exécution : lis la confirmation avant de continuer. Une tâche ne peut pas avoir deux exécutions d’agent actives en même temps.

Un admin peut désactiver l’automatisation des tâches pour l’organisation. Cela bloque les nouveaux démarrages pendant que le travail déjà lancé se termine. Les limites et budgets de l’organisation s’appliquent toujours ; consulte [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).

## Choisir le bon responsable

Assigne une personne lorsque le travail demande un jugement humain ou un accès hors des droits de l’agent. Choisis un agent de projet pour une tâche délimitée utilisant ses fichiers et outils configurés. Une automation convient à un processus défini avec des étapes, déclencheurs ou approbations de connectors.

Pour commencer, suis [Créer ton premier agent](/fr/tutorials/editor/first-agent-end-to-end). Choisis une tâche assez petite pour en vérifier toi-même le résultat.
