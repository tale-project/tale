---
title: Automatisation des tâches
description: Comment l’affectation d’une tâche à un agent la met au travail, la séparation Assigné/Relecteur, la revue directement via le statut En revue, les garde-fous et l’arrêt d’urgence.
---

Affecter une tâche du tableau à un agent IA la met au travail. La personne ou le système **assigné** à la tâche — un membre, un agent du projet ou une automatisation — conduit le travail et la chorégraphie du tableau ; le **Relecteur** est l’humain nommé qu’attend le résultat terminé. Une tâche qu’une automatisation propose reste dans le [Backlog](/fr/platform/projects/backlog) jusqu’à ce qu’un humain la démarre — à partir de ce moment, c’est une tâche de tableau comme une autre et elle entre dans la boucle ci-dessous.

<Frame caption="Le tableau des tâches du projet — affecter une carte à un agent est ce qui lance la boucle ci-dessous.">

![Un tableau kanban de tâches dans le projet Website relaunch, montrant sept cartes de tâches réparties sur ses colonnes de statut, du Backlog et de À faire jusqu’à En revue, Terminé et Annulé.](/images/platform/projects-task-board.webp)

</Frame>

## La boucle d’exécution

1. **Affecte** la tâche à un agent. La carte passe à _En cours_ et l’agent travaille dans sa propre session sandbox, avec la description, les commentaires et les fichiers d’entrée de la tâche comme contexte.
2. L’agent **rend compte** : son résultat arrive en commentaire sur la tâche (les livrables dans la zone Output), et la tâche se gare sur **_En revue_** — un agent ne peut jamais passer une tâche à _Terminé_ ; la règle est appliquée côté serveur.
3. Ce stationnement **demande une relecture** : le **Relecteur** de la tâche reçoit une cloche dans sa boîte et un e-mail, et la fiche de tâche affiche la carte de revue — _En attente de {name}_. Sans relecteur désigné, la demande arrive chez la personne qui a créé la tâche (sinon chez le créateur du projet) — une fin de travail ne reste jamais silencieuse.
4. Un humain **décide sur la carte de revue** : **Approuver** termine la tâche — _Terminé_ est enregistré comme la décision de cette personne, jamais celle de l’agent. **Demander des modifications** ajoute ton feedback en commentaire sur la tâche et la renvoie directement à l’agent, qui lance une exécution de reprise — elle poursuit la conversation précédente là où elle s’était arrêtée — et gare le résultat de nouveau sur _En revue_.

Une exécution qui échoue laisse la tâche où elle était et s’explique dans la fiche — et la plateforme réessaie d’elle-même, immédiatement, jusqu’à trois fois d’affilée ; la ligne d’exécution compte les tentatives. Une tentative qui a tourné quinze minutes ou plus prouve un progrès et repart avec un budget neuf — une longue tâche qui trébuche encore et encore se relève donc encore et encore. Les impasses qu’aucune relance ne répare — un agent supprimé, une exécution au-delà de sa limite de temps — te reviennent directement. Une fois les relances automatiques épuisées, l’erreur reste sur la fiche et **Relancer** reprend la même conversation là où elle s’était arrêtée. Une tâche parente avec des sous-tâches ouvertes refuse de se fermer tant que la dernière n’est pas terminée.

## Assigné et Relecteur

Les deux rôles sont des champs volontairement séparés :

| Rôle          | Qui                                      | Ce qu’il fait                                                                                                                                 |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Assigné à** | membre, agent ou automatisation          | Conduit le travail et le statut du tableau — l’assigné unique, polymorphe                                                                     |
| **Relecteur** | un membre du projet qui peut le modifier | L’humain nommé qu’on attend : reçoit la demande de relecture, alimente le filtre **En attente de ma relecture**, décide sur la carte de revue |

Le relecteur se choisit dans la fiche de tâche, champ **Relecteur**. La désignation est volontairement **souple** : elle route les notifications et la file d’attente, mais tout membre qui peut modifier le projet peut encore répondre à une revue — et contrairement à l’assigné, tu peux poser ou changer le relecteur pendant qu’une exécution tourne. Relire n’oblige jamais à reprendre la tâche : l’agent ou l’automatisation reste assigné, et la chorégraphie continue après la décision.

Le tableau nomme l’attente : les cartes garées sur _En revue_ portent une puce **En attente de {name}** (ou _En attente de ta relecture_), et le filtre **Relecture** du tableau le réduit aux tâches qui t’attendent — ta file de relecture personnelle dans le projet.

## Mentions

**Mentionne un agent avec @** dans un commentaire de tâche : il lit le texte qui le mentionne et agit. Taper `@` ouvre une autocomplétion sur les membres et les agents du projet ; le composeur montre à l’avance si chaque agent mentionné répondra vraiment (automatisation coupée, disjoncteur déclenché, non mentionnable dans ce projet). Une mention de l’**assigné** vaut feedback sur son travail : un agent en cours d’exécution reprend le commentaire en vol, un agent au repos lance une exécution de reprise qui reçoit le commentaire tel quel et poursuit la conversation précédente là où elle s’était arrêtée.

## Garde-fous

Chaque exécution d’agent — affectation, mention, reprise après revue — passe la même porte d’admission :

- **Un moteur par tâche** : une tâche avec une exécution en cours en refuse une seconde, et une réaffectation en plein vol est refusée (annule d’abord — le sélecteur propose annuler-puis-réaffecter).
- **Simultanéité** : les sessions d’agents puisent dans la capacité de l’organisation ; les exécutions en trop patientent et démarrent dès qu’une place se libère.
- **Disjoncteur par tâche** : trop d’exécutions automatiques en une heure sur une même tâche suspendent l’automatisation sur cette tâche jusqu’à ce qu’un humain change son statut.

## Choisir l’assigné

Toute tâche n’a pas sa place sur un harness de code. En règle générale :

| Type de tâche                                              | Affecter à                                                                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recherche, rédaction, synthèses, livrables personnels      | Une **personne**                                                                                                                                         |
| Travail de tableau conduit par une automatisation déployée | Une **Automatisation** — son desk conduit alors les verbes de statut du tableau, et la revue se fait sur le panneau sujet de la tâche                    |
| Travail de dépôt — bugs, fonctionnalités, refactorings, PR | Un **Agent** sur un [**Harness**](/fr/platform/agents/harnesses) de code — créé dans l’onglet Agents du projet avec le harness qui correspond au travail |

Le sélecteur d’assigné groupe **Agents** et **Automatisations**. Chaque agent tourne dans une sandbox sur le **Harness** choisi à sa création, pré-équipé de ses skills, connecteurs et instructions.

## L’arrêt d’urgence

La politique de gouvernance `task_automation` porte l’interrupteur principal : la couper stoppe le chemin d’exécution — le travail en vol se termine, rien de neuf ne démarre. Réservée aux admins et auditée ; sur une instance auto-hébergée, la politique est l’un des fichiers de configuration de gouvernance de l’organisation, à côté des limites décrites sur [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).

## Où cela s’inscrit

L’automatisation des tâches transforme le tableau de projet d’une liste de choses à faire en surface de délégation : un humain affecte, un humain nommé relit, l’agent exécute tout ce qu’il y a entre les deux — et _Terminé_ reste une décision humaine. La suite naturelle : [Backlog](/fr/platform/projects/backlog), pour comprendre comment le travail proposé entre dans la boucle.
