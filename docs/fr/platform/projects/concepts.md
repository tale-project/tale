---
title: Concepts de projet
description: Un projet est un espace partagé qui regroupe fichiers, instructions, conversations et agents liés au projet. Cette page donne le modèle mental pour choisir un projet plutôt qu'une conversation isolée.
---

Un projet est l'unité vers laquelle Tale se tourne quand un bloc de travail a besoin des mêmes fichiers, des mêmes instructions et des mêmes agents sur de nombreuses conversations. C'est un espace partagé qui regroupe quatre choses — fichiers, instructions, conversations et agents liés au projet —, des choses qui te suivent entre conversations pour que tu ne recolles pas le contexte à chaque fois.

Cette page te donne le modèle mental pour décider quand passer à un projet. Lis-la avant d'en démarrer un ; reviens-y quand tu te demandes si tu dois continuer à alimenter une conversation isolée ou promouvoir le contexte dans un projet.

## Les quatre pièces

**Fichiers** sont le jeu de travail du projet — les documents, tableurs et images sur lesquels tu reviens. Les fichiers sont attachés au niveau du projet et visibles depuis chaque conversation à l'intérieur, sans le coût d'un nouveau téléversement ou d'une nouvelle récupération.

**Instructions** sont le system prompt au niveau du projet — la voix et les contraintes qui s'appliquent à chaque conversation. Elles composent avec les instructions propres de l'agent : les instructions du projet encadrent le travail, celles de l'agent encadrent la réponse.

**Conversations** sont les fils. Chaque conversation dans le projet voit les fichiers et instructions du projet. Les conversations restent privées au projet ; elles n'apparaissent pas dans l'historique chat de l'organisation.

**Agents liés au projet** sont des agents portés sur le projet. Ils éclipsent les agents de l'organisation portant le même nom — quand les deux existent, la version projet l'emporte à l'intérieur du projet. Utilise des agents projet pour un comportement qui surprendrait des lecteurs hors du projet.

## Modèle de partage

Un projet appartient à son créateur par défaut ; le créateur peut ajouter des membres. Les membres voient les fichiers et conversations du projet, mais pas les conversations antérieures à leur adhésion à moins qu'elles soient explicitement partagées. Retirer un membre lui retire l'accès à la requête suivante ; les transcriptions qu'il a téléchargées restent sur son appareil.

## Mis bout à bout — un projet de compte commercial

Un projet de compte commercial regroupe les artefacts sur lesquels un commercial revient pour un client :

- Fichiers : le contrat du client, les brouillons d'offre, les notes d'appel.
- Instructions : « Tu travailles sur le compte Acme. Réfère les notes d'appel par date ; cite le contrat par numéro de section. »
- Conversations : une par étape du deal — qualification, préparation de démo, offre, négociation.
- Agents projet : un agent de synthèse de deal qui connaît la voix Acme, plus les agents par défaut de l'organisation.

Chaque conversation dans le projet voit les mêmes fichiers et instructions ; le commercial ouvre une nouvelle conversation par étape du deal et le contexte suit.

## Quand y recourir

| Utilise … quand                                               | Projet | Conversation isolée |
| ------------------------------------------------------------- | ------ | ------------------- |
| Les mêmes fichiers s'appliquent à de nombreuses conversations | ✓      |                     |
| Les mêmes instructions s'appliquent partout                   | ✓      |                     |
| Plusieurs personnes travaillent sur le même bloc              | ✓      |                     |
| La conversation est en un seul tir                            |        | ✓                   |

Les conversations isolées sont la bonne forme quand tu explores une réponse une fois. Les projets sont la bonne forme quand le même ensemble de contexte suit le travail sur de nombreuses sessions.

## Construis-en un

Les projets sont la couture entre agents et conversations : les fichiers, instructions, conversations et agents qui voyagent ensemble. La lecture suivante naturelle est [Utiliser les projets](/fr/tutorials/member/use-projects) — elle parcourt les quatre pièces sur un projet neuf, de la création à la première réponse qui cite les fichiers du projet.
