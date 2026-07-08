---
title: Assistant d’automatisation
description: L’agent de chat épinglé à une automatisation — ce qu’il modifie directement, ce qu’il rédige pour que tu l’appliques, et comment il retrouve les automatisations existantes avant d’en construire une nouvelle.
---

L’**Assistant d’automatisation** est l’agent de chat épinglé à l’automatisation que tu as ouverte — clique sur **Assistant** sur la page d’une automatisation, et il répond avec déjà en contexte les agents, le workflow, les compétences, les intégrations et la configuration de cette automatisation. Les Admins et Développeurs s’en servent pour comprendre une automatisation qu’ils ne connaissent pas, en étendre une plutôt que la dupliquer, ou se faire aider à construire les pièces que la page de l’automatisation ne modifie pas directement. C’est le même agent assistant qu’embarque l’[éditeur de workflow](/fr/platform/workflows/workflows), donc une conversation démarrée depuis l’une des deux surfaces se lit familièrement depuis l’autre.

## Ce qu’il modifie directement

Les workflows sont la seule pièce à laquelle l’assistant a un accès outil complet : il lit la définition courante, modifie les étapes, sauvegarde une nouvelle version et la fait tourner — exactement comme si tu étais passé par l’éditeur toi-même. Les agents viennent juste après : il lit le roster et peut en installer, activer ou désactiver un, mais les instructions, le modèle et le reste de la configuration d’un agent restent à modifier par toi dans l’éditeur d’agent ; l’assistant rédige le JSON exact et tu le colles.

## Ce qu’il rédige à ta place

Les compétences, intégrations, vues intégrées et la configuration de l’automatisation n’ont aucun outil d’édition : l’assistant écrit la définition selon la compétence d’écriture ou d’intégration correspondante et te dit exactement où l’appliquer — Paramètres > Intégrations pour un identifiant, la page de l’automatisation elle-même pour une vue ou sa configuration. Installer et configurer fonctionnent pareil : il parcourt la checklist de préparation — connecter ce qui est requis, remplir la configuration, activer les agents et le workflow — plutôt que de faire la connexion lui-même.

## Trouver ce qui existe déjà

Avant de construire quoi que ce soit, l’assistant cherche une automatisation ou un bundle à étendre plutôt qu’à dupliquer — la même règle de réutilisation d’abord que toute compétence d’écriture impose. Sa recherche atteint des automatisations que le catalogue lui-même cache : les membres cachés d’un bundle (voir [Concepts d’automatisation](/fr/platform/automations/concepts)) restent visibles pour l’assistant, qui peut donc te pointer vers, disons, l’agent PR Creator enfoui dans Résoudre les issues GitHub plutôt que d’en proposer un nouveau.

## Où cela s’inscrit

L’Assistant d’automatisation est le chemin le plus rapide vers une automatisation que tu n’as pas construite toi-même — demande-lui ce que fait quelque chose avant d’y toucher à la main. [Concepts d’automatisation](/fr/platform/automations/concepts) est le vocabulaire qu’il présuppose ; [Parcourir et installer des automatisations](/fr/platform/automations/catalog) est l’endroit où agir sur ce qu’il te dit si l’automatisation n’est pas encore installée.
