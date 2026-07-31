---
title: Automatisation des tâches
description: Le pack task-ops par défaut — comment l’affectation d’une tâche à un agent la met au travail, la revue directement via le statut En revue, les garde-fous (budgets, simultanéité, disjoncteurs) et l’arrêt d’urgence.
---

Affecter une tâche du tableau à un agent IA la met au travail. Le **pack task-ops** — onze workflows en fichiers, provisionnés pour chaque organisation — couvre tout le cycle de vie : triage, exécution, revue, escalade, tenue des SLA et nettoyage. Chaque workflow est un simple fichier JSON que ton organisation possède : ajuste les seuils, édite les prompts ou désactive des déclencheurs individuels sur le workflow lui-même. Une tâche qu’une automatisation propose reste dans le [Backlog](/fr/platform/projects/backlog) jusqu’à ce qu’un humain la Démarre — à partir de ce moment, c’est une tâche de tableau comme une autre et elle entre dans la boucle ci-dessous.

<Frame caption="Le tableau des tâches du projet — affecter une carte à un agent est ce qui lance la boucle ci-dessous.">

![Un tableau kanban de tâches dans le projet Website relaunch, montrant sept cartes de tâches réparties sur ses colonnes de statut, du Backlog et de À faire jusqu’à En revue, Terminé et Annulé.](/images/platform/projects-task-board.webp)

</Frame>

## La boucle d’exécution

1. **Affecte** une tâche à un agent (ou laisse le _triage des non-affectées_ noter et router automatiquement les nouvelles tâches — les correspondances très sûres s’affectent seules, les autres reçoivent un commentaire de suggestion).
2. L’agent **accuse réception** (la tâche passe à _En cours_), travaille dans son propre fil de tâche avec les outils de tâches et publie son résultat en commentaire.
3. La tâche se gare en **_En revue_** — les agents ne peuvent jamais poser _Terminé_ ; la règle est appliquée côté serveur, quelle que soit la configuration des workflows.
4. Un humain **passe en revue depuis la colonne _En revue_** — la fiche de tâche réunit tout le nécessaire : le rapport de l'agent, la transcription en direct derrière chaque badge d'activité et les commentaires. Glissez la tâche vers _Terminé_ pour la clore, ou renvoyez un retour en @-mentionnant l'assigné : un agent en cours d'exécution intègre le commentaire en plein travail, un agent inactif lance une reprise et regare la tâche en _En revue_. Aucune carte d'approbation n'interrompt le flux — et aucune automatisation ne pose jamais _Terminé_.

Les échecs ramènent la tâche à _À faire_ avec un commentaire d’explication. Quand une tâche racine décomposée a des sous-tâches, la tâche parente attend la fermeture de la dernière sous-tâche, puis remonte en _En revue_.

## Mentions, dépendances, échéances

- **@-mentionne un agent** dans un commentaire ou dans la description d’une tâche et il lit le texte qui le mentionne, puis agit. Taper `@` ouvre une autocomplétion sur les membres et les agents du projet ; le chat prévisualise si chaque agent mentionné répondra vraiment (automatisation coupée, budget épuisé, agent en pause). Modifier une description ou un commentaire ne déclenche que les mentions nouvellement ajoutées, et ce que l’automatisation écrit elle-même ne déclenche jamais personne. Une mention ne déplace jamais le tableau — à une exception près : si l’agent mentionné est l’**assigné** de la tâche, la mention vaut reprise de son travail assigné et suit la chorégraphie d’assignation — _En cours_ pendant que l’exécution admise travaille, _En revue_ en cas de succès, et retour dans _À faire_ avec un commentaire explicatif en cas d’échec.
- Quand un **bloqueur se ferme**, les tâches dépendantes reçoivent une note listant les bloqueurs restants ; le travail d’agent totalement débloqué redémarre seul, le travail humain reçoit une notification en boîte de réception.
- Les **échéances** actionnent une échelle SLA : un avertissement 24 heures avant, une relance en cas de retard, puis une escalade humaine vers le créateur du projet et les admins de l’org — répétée une fois de plus si la tâche reste en retard. Chaque niveau ne tire qu’une fois ; repousser l’échéance réarme l’échelle.

## Garde-fous

Chaque exécution d’agent — affectation, mention, révision, escalade, externe — passe le même portail d’admission :

- **Budgets** (par agent, mensuels) : au seuil d’alerte, l’agent reçoit une consigne d’économie et les admins sont notifiés une fois ; au seuil de pause, les nouvelles exécutions sont refusées. Réinitialisation au changement de mois.
- **Plafonds de simultanéité** (par agent et pour toute l’organisation) : les exécutions en trop font la file et démarrent seules quand une place se libère.
- **Disjoncteur par tâche** : au-delà du nombre configuré d’exécutions par heure sur une même tâche, l’automatisation de cette tâche se met en pause jusqu’à ce qu’un humain change son statut.

Les plafonds à l’échelle de l’organisation (simultanéité des exécutions, exécutions par tâche et par heure) sont des valeurs fixes de la plateforme ; le budget et le parallélisme par agent vivent dans la configuration de l’agent.

## Choisir le bon assigné

Toutes les tâches ne sont pas faites pour un harness de code. La règle simple :

| Forme de la tâche                                     | Assigner                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recherche, rédaction, synthèses, livrables personnels | Une **personne** — désactive le tri des tâches non assignées sur les projets personnels pour que les agents ne s’en emparent pas tout seuls         |
| Travail de tableau piloté par un workflow déployé     | Une **Automation** — son workflow pilote alors les verbes de statut du tableau                                                                      |
| Travail de dépôt — bugs, fonctionnalités, PRs         | Un **Agent** sur un [**Harness**](/fr/platform/agents/harnesses) de code — crée-le dans l’onglet Agents du projet avec le harness adapté au travail |

Le sélecteur d’assigné groupe les **Agents** et les **Automations**. Chaque agent tourne dans une sandbox sur le **Harness** choisi à sa création, pré-équipé de ses skills, connectors et instructions.

## L’arrêt d’urgence

La politique de gouvernance `task_automation` porte l’interrupteur principal : la couper arrête le chemin d’exécution — le travail en vol se termine, rien de neuf ne démarre. Elle est réservée aux admins et auditée ; sur une instance auto-hébergée, la politique est l’un des fichiers de configuration de gouvernance de l’org, aux côtés des limites couvertes sur [Politiques et limites](/fr/platform/admin/governance/policies-and-limits).

## Où cela s’inscrit

L’automatisation des tâches est ce qui transforme le tableau du projet d’une liste de choses à faire en une surface de délégation : un humain affecte et clôture, le pack fait tourner tout ce qu’il y a entre les deux, et _Terminé_ reste une décision humaine. La lecture suivante naturelle est [Backlog du projet](/fr/platform/projects/backlog) pour la façon dont le travail proposé entre dans la boucle, et [L’éditeur de workflow](/fr/platform/automations/editor) pour ajuster les workflows du pack lui-même.
