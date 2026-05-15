---
title: Concepts des agents
description: Le modèle mental derrière les agents Tale — instructions, connaissances, outils et modèles.
---

Un agent est un paquet de quatre choses : des **instructions** (comment il se comporte), des **connaissances** (ce qu'il peut lire), des **outils** (ce qu'il peut faire) et un **modèle** (comment il pense). Tout le reste — versions, webhooks, démarreurs de conversation — c'est de la plomberie autour de ces quatre. Dès que tu peux énumérer les quatre pour l'agent que tu veux, la construction elle-même ne prend que quelques minutes.

## Instructions

Les instructions sont le system prompt que le modèle voit avant chaque message dans la conversation. Elles répondent à « qui es-tu et quel est ton travail ? ». De bonnes instructions sont courtes, spécifiques et listent les règles à respecter.

Exemple :

> Tu es l'agent support d'Acme Corp. Réponds aux questions sur nos produits, la livraison et les retours. Ne donne pas de conseils médicaux ou juridiques. Réponds toujours dans la langue de l'utilisateur. Garde tes réponses sous 200 mots.

Changer les instructions change la personnalité, le périmètre et le format de sortie de l'agent. Traite-les comme la pièce la plus porteuse — la plupart des gains de qualité viennent de la réécriture des instructions, pas du changement de modèle.

## Connaissances

Les connaissances sont le sous-ensemble de la [base de connaissances](/fr/platform/workspace/knowledge-base) que l'agent peut chercher. Par défaut, les agents peuvent chercher dans tout ce que l'organisation a téléversé. Tu restreins par dossier, équipe ou type d'entité (Documents, Produits, Clients, Fournisseurs).

Des connaissances plus étroites donnent des résultats plus pertinents — un agent support qui ne cherche que dans le dossier orienté client ne se laisse pas distraire par les docs internes d'ingénierie. Plus étroit veut aussi dire moins cher, puisque moins de documents atteignent le modèle.

## Outils

Les outils sont des capacités que l'agent peut invoquer pendant une conversation. Les outils intégrés incluent la recherche dans les connaissances, la recherche web, le traitement de documents et l'analyse d'image. Les intégrations que tu as configurées (API REST, SQL, courriel) apparaissent aussi comme outils.

Tu actives ou désactives chaque outil par agent. Un agent de recherche en lecture seule peut avoir la recherche web activée mais toutes les opérations d'écriture désactivées. Un agent qui met à jour des tickets dans un outil de support a l'outil d'intégration activé et rien d'autre. La liste des outils sépare l'agent qui sait seulement parler de celui qui sait agir.

## Modèle

Chaque agent est lié à un préréglage de modèle — **Rapide**, **Standard** ou **Avancé**. Chaque préréglage pointe vers un modèle IA précis configuré dans tes [Fournisseurs IA](/fr/platform/admin/providers). **Rapide** est le moins cher et le plus rapide ; **Avancé** est le plus capable. La plupart des agents finissent sur Standard ; tu prends Avancé quand la qualité de raisonnement compte plus que la latence, et Rapide pour les tâches de routine à fort volume où la vitesse l'emporte sur la nuance.

## Tout ensemble

Ces quatre boutons permettent de créer beaucoup d'agents depuis la même plateforme :

| Scénario               | Instructions                            | Connaissances                     | Outils                     | Modèle   |
| ---------------------- | --------------------------------------- | --------------------------------- | -------------------------- | -------- |
| Support amical         | serviable, concis, refuse hors-sujet    | docs du Centre d'aide uniquement  | recherche, lookup client   | Standard |
| Recherche commerciale  | fouille en profondeur, cite les sources | tous documents + sites + Produits | recherche, recherche web   | Avancé   |
| Exploration de données | prudent, explique les requêtes          | toutes connexions SQL             | intégration SQL, recherche | Rapide   |

## Quand y recourir

Les agents sont le primitif conversationnel de Tale. Leur primitif frère est l'**automatisation** — un programme multi-étapes qui tourne sans humain dans la boucle. Les deux résolvent des problèmes différents, et la plupart des équipes finissent avec les deux.

| Utilise un agent quand …                                     | Utilise une automatisation quand …                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| un humain est dans la conversation et pose des questions     | un déclencheur planifié, un webhook externe ou un événement interne la déclenche         |
| le flux est ouvert — l'étape suivante dépend de la réponse   | le flux est déterministe — mêmes étapes à chaque fois, dans le même ordre                |
| la sortie est du texte ou une petite charge utile structurée | la sortie est un effet sur un autre système (enregistrement mis à jour, courriel envoyé) |
| la latence compte parce que quelqu'un attend                 | la latence de fond est acceptable ; la justesse compte plus                              |

Beaucoup de fonctionnalités mêlent les deux : un agent qui délègue un travail long à une automatisation, ou un workflow dont l'étape LLM utilise les instructions d'un agent. Choisis le primitif principal selon que l'utilisateur est dans la conversation au moment où le travail doit avoir lieu.

## En construire un

Les concepts sont posés. La page suivante traverse le flux de création de bout en bout — nommer, choisir un modèle, écrire les instructions, brancher des connaissances, activer des outils et publier la première version. Continue ici : [Créer un agent](/fr/platform/agents/create).
