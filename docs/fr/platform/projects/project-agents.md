---
title: Agents et modèles dans un projet
description: L’onglet Agents et modèles choisit quels agents et modèles les membres voient dans un projet — Recommandés épingle les favoris en haut, Restreints n’autorise rien d’autre.
---

L’onglet **Agents et modèles** d’un projet décide quels agents et modèles les membres rencontrent quand ils discutent dans le projet. Il ne crée pas de nouveaux agents — les agents se construisent au niveau de l’organisation sous [Agents](/fr/platform/agents/concepts) — il organise le catalogue existant pour le contexte de ce projet, pour qu’un membre qui ouvre le sélecteur voie d’abord les bons outils pour le travail.

<Frame caption="L’onglet Agents et modèles — un choix Recommandés/Restreints pour les agents, un pour les modèles.">

![L’onglet Agents et modèles d’un projet montrant deux groupes de boutons radio, Agents et Modèles, offrant chacun un mode Recommandés et un mode Restreints avec un bouton d’ajout.](/images/platform/project-agents-models.webp)

</Frame>

## Les deux modes

Les agents et les modèles s’organisent séparément, chacun avec les deux mêmes modes :

- **Recommandés** — les éléments que tu listes sont épinglés en haut du sélecteur ; tout ce que le membre pourrait normalement utiliser reste disponible en dessous. C’est le mode par défaut, et le bon pour orienter sans bloquer.
- **Restreints** — seuls les éléments que tu listes sont disponibles dans ce projet. Un membre qui choisit autre chose reçoit un refus clair : le composeur signale que l’agent ou le modèle n’est pas disponible dans ce projet et lui demande d’en choisir un autre.

L’ordre de la liste est l’ordre que voient les membres, et le premier élément est celui par défaut — glisse pour réordonner. **Ajouter un agent** et **Ajouter un modèle** étendent la liste.

<Warning>

En mode **Restreints**, une liste vide interdit le chat du projet à chaque membre — il ne reste rien à choisir. Ajoute au moins un élément avant d’enregistrer, ou rebascule sur **Recommandés**.

</Warning>

## Ce que vivent les membres

Dans le projet, le sélecteur d’agent et le sélecteur de modèle du composeur reflètent la curation — les éléments recommandés d’abord, les éléments restreints seulement. Un chat déplacé dans le projet avec un agent désormais interdit ne casse pas en silence : l’envoi est refusé avec le message d’agent non disponible, et le membre en choisit un autorisé. Hors du projet, rien ne change ; la curation se limite aux chats qui tournent dans le contexte du projet.

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

Cet onglet est la curation côté projet d’un catalogue côté organisation : construire les agents, leurs instructions et leurs connaissances est le travail de la section [Agents](/fr/platform/agents/concepts) ; décider lesquels ce projet met en avant est le tien. Pour le comportement du sélecteur dans un chat, lis [Agents dans le chat](/fr/platform/chat/agents-in-chat).
