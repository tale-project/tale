---
title: Assistant d’automatisation
description: L’agent de chat épinglé à une automatisation — ce qu’il modifie directement, ce qu’il rédige pour que tu l’appliques, et comment il retrouve les automatisations existantes avant d’en construire une nouvelle.
---

L’**Assistant d’automatisation** est l’agent de chat rattaché à une seule automatisation, et il répond avec déjà en contexte son document, ses agents, ses compétences et ses intégrations. Les Admins et Développeurs s’en servent pour comprendre une automatisation qu’ils n’ont pas construite, en étendre une plutôt que la dupliquer, ou se faire aider à rédiger les pièces que la page de l’automatisation ne modifie pas. Demande-lui ce que fait quelque chose avant d’y toucher à la main : il lit le document entier d’un coup plutôt qu’un nœud à la fois.

## Ce qu’il modifie directement

Le document de l’automatisation est la seule pièce à laquelle l’assistant a un accès outil complet : il lit la version courante, modifie des nœuds, valide le résultat, enregistre une nouvelle version et la lance contre des simulations — les mêmes gestes que tu ferais à la main, dans le même ordre. Il travaille sous les mêmes règles que toi : un enregistrement ajoute une version au lieu d’en modifier une, et la version en service le reste jusqu’à ce que quelqu’un en mette une autre en service. Les agents viennent juste après : il lit le roster et peut en installer, activer ou désactiver un, mais les instructions, le modèle et le reste de la configuration d’un agent restent à modifier par toi dans l’éditeur d’agent, l’assistant rédigeant le JSON exact que tu colles.

## Ce qu’il rédige à ta place

Les compétences, les intégrations et les vues intégrées n’ont aucun outil d’édition : l’assistant écrit la définition selon la compétence d’écriture correspondante et te dit exactement où l’appliquer — Paramètres > Intégrations pour un identifiant, la page de l’automatisation elle-même pour une vue. Installer et configurer fonctionnent pareil : il parcourt la checklist de préparation en nommant ce qui reste à connecter et ce qui reste à activer, plutôt que de faire la connexion lui-même.

La même frontière vaut pour les déclencheurs. L’assistant peut te dire quelle planification, quel webhook, quel événement ou quel déclencheur par clé d’API porte une automatisation et ce que chacun enverrait dans une exécution, et il peut te rédiger celui que tu veux — mais la décision d’exposer une automatisation au monde extérieur reste humaine. [Déclencheurs de workflow](/fr/platform/automations/triggers) couvre ce que fait chaque sorte.

## Trouver ce qui existe déjà

Avant de construire quoi que ce soit, l’assistant cherche une automatisation ou un bundle à étendre plutôt qu’à dupliquer — la même règle de réutilisation d’abord que toute compétence d’écriture impose. Sa recherche atteint des automatisations que le catalogue lui-même cache : les membres cachés d’un bundle (voir [Concepts d’automatisation](/fr/platform/automations/concepts)) restent visibles pour l’assistant, qui peut donc te pointer vers, disons, l’agent PR Creator enfoui dans Résoudre les issues GitHub plutôt que d’en proposer un nouveau.

## Où cela s’inscrit

L’Assistant d’automatisation est le chemin le plus rapide vers une automatisation que tu n’as pas construite toi-même — demande-lui ce que fait quelque chose avant d’y toucher à la main. [Concepts d’automatisation](/fr/platform/automations/concepts) est le vocabulaire qu’il présuppose ; [Parcourir et installer des automatisations](/fr/platform/automations/catalog) est l’endroit où agir sur ce qu’il te dit si l’automatisation n’est pas encore installée.
