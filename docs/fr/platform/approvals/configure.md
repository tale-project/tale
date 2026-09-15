---
title: Décider quelles actions demandent une approbation
description: Comprends les règles par défaut, demande une modification de politique et distingue les approbations des autres revues.
---

La politique d’approbation détermine quelles écritures de connectors doivent attendre une personne pendant une exécution réelle. Examine les actions externes avant le déploiement, surtout lorsqu’un workflow envoie des messages ou modifie un autre système. [Comprendre les approbations](/fr/platform/approvals/concepts) explique la carte de décision.

## Comprendre le comportement par défaut

Les lectures ne demandent pas d’approbation d’opération. Par défaut, une écriture vers un système externe attend une décision : envoi d’e-mail, message Slack, création d’issue GitHub ou écriture WebDAV, par exemple. Les opérations internes, comme modifier une tâche ou enregistrer un document dans Tale, ne demandent pas cette approbation par défaut.

Une opération autorisée reste soumise aux droits d’accès applicables. L’absence de carte ne prouve donc pas qu’elle est en lecture seule. Il peut s’agir d’une écriture interne ou explicitement approuvée automatiquement par l’organisation.

## Demander une modification de politique

La page des connectors n’a pas d’interrupteur d’approbation pour chaque action. La politique de l’organisation peut exiger ou supprimer l’approbation pour un connector ou une action précise. La règle d’une action a priorité sur celle de son connector.

Demande au responsable du déploiement d’appliquer la [configuration des approbations](/fr/self-hosted/configuration/approvals). Précise l’opération, le motif du contrôle ou de l’exécution automatique, et le workflow concerné. Les admins Cloud coordonnent également cette modification avec le responsable de leur déploiement.

Une opération qui attend déjà une approbation conserve sa demande après la modification. Approuve ou refuse explicitement cette carte ; assouplir la politique ne la libère pas.

## Vérifier un workflow avant le déploiement

1. Examine chaque nœud de connector et identifie s’il lit ou écrit.
2. Confirme les écritures que la politique effective approuve automatiquement.
3. Lance un test pour contrôler les entrées et sorties avec des mocks.
4. Pendant une exécution réelle maîtrisée, examine l’opération et ses entrées exactes sur chaque carte en attente avant de décider.

Un test simulé ne prouve pas qu’une approbation apparaîtra en conditions réelles. Les mocks ne modifient pas les systèmes externes et ne demandent pas d’approbation.

## Distinguer les autres décisions humaines

| Décision | Règles correspondantes |
| --- | --- |
| Accepter le résultat d’une tâche d’agent | [Automatiser les tâches](/fr/platform/projects/task-automation). Une personne passe le résultat de En revue à Terminé. |
| Approuver une version de document maîtrisé | [Documents](/fr/platform/knowledge/documents). Le relecteur désigné décide sur la version figée. |
| Autoriser une demande d’effacement | [Demandes des personnes concernées](/fr/platform/admin/governance/data-subject-requests). Un second Admin donne l’approbation requise. |
| Répondre à la question d’un nœud agent | [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows). L’exécution a besoin d’une information pour continuer. |

Ces décisions suivent leurs propres règles. La politique d’approbation des connectors ne les désactive pas. Le chat utilise des outils de consultation en lecture seule et ne crée pas de carte d’approbation d’opération.
