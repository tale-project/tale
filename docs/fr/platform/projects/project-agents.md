---
title: Agents et modèles dans un projet
description: L’onglet Agents et modèles choisit quels agents et modèles les membres voient dans un projet — Recommandés épingle les favoris en haut, Restreints n’autorise rien d’autre.
---

L’onglet **Agents et modèles** d’un projet décide quels agents et modèles sont proposés au travail du projet. Il ne crée pas de nouveaux agents — les agents se construisent au niveau de l’organisation sous [Agents](/fr/platform/agents/concepts) — il organise le catalogue existant pour le contexte de ce projet, pour qu’un membre qui assigne du travail rencontre d’abord les bons outils.

<Frame caption="L’onglet Agents et modèles — un choix Recommandés/Restreints pour les agents, un pour les modèles.">

![L’onglet Agents et modèles d’un projet montrant deux groupes de boutons radio, Agents et Modèles, offrant chacun un mode Recommandés et un mode Restreints avec un bouton d’ajout.](/images/platform/project-agents-models.webp)

</Frame>

## Les deux modes

Les agents et les modèles s’organisent séparément, chacun avec les deux mêmes modes :

- **Recommandés** — les éléments que tu listes sont épinglés en haut du vivier du projet ; tout ce que le membre pourrait normalement utiliser reste disponible en dessous. C’est le mode par défaut, et le bon pour orienter sans bloquer.
- **Restreints** — seuls les éléments que tu listes sont disponibles dans ce projet ; tout le reste est refusé avec un message clair disant que ce n’est pas disponible dans ce projet.

L’ordre de la liste est l’ordre que voient les membres, et le premier élément est celui par défaut — glisse pour réordonner. **Ajouter un agent** et **Ajouter un modèle** étendent la liste.

<Warning>

En mode **Restreints**, une liste vide ne laisse rien à offrir au projet — il ne reste rien à choisir. Ajoute au moins un élément avant d’enregistrer, ou rebascule sur **Recommandés**.

</Warning>

## Ce que vivent les membres

La curation façonne le vivier du projet — les éléments recommandés d’abord, les éléments restreints masqués. Le chat, lui, fait toujours tourner l’assistant intégré ; la curation compte donc là où les agents travaillent vraiment : dans les tâches et les automatisations qui tournent dans ce projet. Hors du projet, rien ne change.

## Qui peut le modifier

La modification de l’onglet suit les rôles de l’organisation : un rôle d’éditeur ou d’admin est requis pour enregistrer, et les membres qui ne l’ont pas voient le projet en lecture seule, avec un bandeau qui les renvoie vers un éditeur du projet. Les changements passent par **Enregistrer** dans la barre d’onglets — le même bloc unifié Enregistrer/Abandonner que les onglets Général et Instructions.

## Quand recourir à chaque mode

| Choisis … quand                                             | Recommandés | Restreints |
| ----------------------------------------------------------- | ----------- | ---------- |
| Le bon agent doit être le premier choix évident             | ✓           |            |
| Les membres doivent garder l’accès au catalogue complet     | ✓           |            |
| La conformité ou les coûts exigent une liste courte et fixe |             | ✓          |
| Un modèle coûteux ne doit pas servir à ce travail           |             | ✓          |

## Où cela s’inscrit

Cet onglet est la curation côté projet d’un catalogue côté organisation : construire les agents, leurs instructions et leurs connaissances est le travail de la section [Agents](/fr/platform/agents/concepts) ; décider lesquels ce projet met en avant est le tien. Le chat, lui, ne fait tourner que l’assistant intégré — ces agents font leur travail sur les tâches et dans les automatisations du projet.
