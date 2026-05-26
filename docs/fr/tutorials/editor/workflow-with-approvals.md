---
title: Construire un workflow avec approbation
description: Câble un workflow à trois étapes où une approbation humaine s'intercale entre le brouillon et l'envoi, puis lance-le de bout en bout et inspecte la piste d'audit.
---

Un workflow avec approbation est la forme vers laquelle tu te tournes quand le travail comporte un brouillon, une décision et une action — et que tu veux un humain entre le brouillon et l'action. La porte d'approbation met le run en pause jusqu'à ce que quelqu'un clique « Approuver » ; l'étape suivante ne se déclenche qu'avec le feu vert. Ce parcours construit un workflow de résumé quotidien avec une porte d'approbation sur une organisation neuve.

Il te faut un rôle Éditeur et un agent qui produit un brouillon (le premier agent utile de [Construire ton premier agent](/fr/tutorials/editor/first-agent-end-to-end) suffit). Le côté conceptuel vit dans [Concepts d'automatisation](/fr/platform/automations/concepts) et [Concepts d'approbation](/fr/platform/approvals/concepts) ; ce parcours est le mécanisme de bout en bout.

## Avant de commencer

Confirme trois choses. Ton rôle est au moins Éditeur — l'édition de workflow est verrouillée à Éditeur et au-dessus. Tu as un agent rédacteur de brouillon prêt ; sans lui, l'Étape 2 du workflow n'a rien à invoquer. Tu fais partie du pool d'approbateurs que tu assignes à l'Étape 3, ou tu as une collègue prête à approuver pour que le run avance réellement.

## Étape 1 — Créer la coquille du workflow

Le premier geste est la définition du workflow — le conteneur ordonné dans lequel vivent les étapes. Ouvre **Automatisations > Nouveau workflow** et règle :

- **Nom** — `Daily inbox summary`
- **Déclencheur** — **Manuel** pour l'instant ; tu pourras le remplacer par un schedule une fois que le run marche
- **Entrées** — laisser vide

Enregistre comme brouillon. La coquille existe mais n'a pas d'étapes ; la lancer maintenant reviendrait immédiatement.

## Étape 2 — Ajouter l'étape de brouillon

L'étape de brouillon est l'invocation de l'agent. Clique **Ajouter une étape > Appeler un agent** et configure :

- **Agent** — l'agent rédacteur de brouillon que tu as prêt
- **Prompt** — `Summarise yesterday's unread customer messages into a paragraph and propose a single team-wide reply.`
- **Variable de sortie** — `draft`

Enregistre. Le workflow a maintenant une étape ; un run produit une variable `draft` mais n'en fait rien.

## Étape 3 — Ajouter la porte d'approbation

La porte d'approbation est la couture entre le brouillon de l'agent et l'action. Clique **Ajouter une étape > Porte d'approbation** et configure :

- **Titre** — `Review daily summary`
- **Corps** — `{{ draft }}` pour que l'approbateur voie le texte complet dans la carte
- **Pool d'approbateurs** — une équipe ou une liste explicite d'utilisateurs dont tu fais partie
- **Timeout** — 30 minutes, escalade en échec

Enregistre. Le workflow met maintenant en pause sur cette étape et attend une décision ; refuser met fin au run.

## Étape 4 — Ajouter l'étape d'action et lancer

L'étape d'action ne se déclenche que quand la porte se résout en Approuver. Clique **Ajouter une étape > Envoyer un courriel** (ou n'importe quelle action que ton organisation a câblée) et configure :

- **À** — ta propre adresse pour ce parcours
- **Objet** — `Daily inbox summary`
- **Corps** — `{{ draft }}`

Enregistre et **Publie** le workflow. Clique **Lancer**. L'étape de brouillon se déclenche ; la porte d'approbation apparaît comme carte dans ton inbox ; clique **Approuver** ; l'étape de courriel se déclenche ; le run se termine. La vue d'exécution affiche trois lignes — brouillon, décision de porte, courriel — avec horodatages et l'acteur sur la porte.

## Où ça s'utilise

Trois étapes avec une porte, c'est le plus petit workflow-avec-approbation utile : l'agent rédige, l'humain décide, le système agit. La même forme passe à l'échelle — échange Manuel contre un déclencheur schedule, ajoute une deuxième porte avant une étape destructive, branche sur la décision au lieu d'échouer sur le refus.

Pour la machine à états de la porte et les règles de routage, voir [Approbations dans les workflows](/fr/platform/automations/approvals-in-workflows). Pour les quatre pièces dont chaque workflow est fait, voir [Concepts d'automatisation](/fr/platform/automations/concepts).
