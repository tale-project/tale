---
title: Concepts des agents
description: Le modèle mental à quatre boutons derrière chaque agent Tale — instructions, connaissances, outils et modèle — et quand prendre un agent plutôt qu'une automatisation.
---

Un agent est un paquet de quatre choses : des **instructions** qui régissent son comportement, des **connaissances** qui bornent ce qu'il peut lire, des **outils** qui décident ce qu'il peut faire, et un **modèle** qui détermine comment il pense. Tout le reste sur la surface des agents — versions, amorces de conversation, URLs de worker, délégation — c'est de la plomberie autour de ces quatre. Le public, c'est tout le monde qui construit ou raisonne sur les agents ; dès que tu sais énumérer les quatre pour l'agent que tu veux, la construction elle-même ne prend que quelques minutes.

Cette page est le modèle mental. La construction de bout en bout parcourt les quatre mêmes onglets dans l'ordre à [Créer un agent](/fr/platform/agents/create).

## Instructions

Les instructions sont le system prompt que le modèle voit avant chaque message dans la conversation. Elles répondent à « qui es-tu et quel est ton travail ? ». De bonnes instructions sont courtes, spécifiques et listent les règles à respecter — ce qu'est l'agent, ce qu'il peut répondre, ce qu'il doit refuser, et comment formater ses réponses.

Un exemple concret :

> Tu es l'agent support d'Acme Corp. Réponds aux questions sur nos produits, la livraison et les retours. Ne donne pas de conseils médicaux ou juridiques. Réponds toujours dans la langue de l'utilisateur. Garde tes réponses sous 200 mots.

Changer les instructions change la personnalité, le périmètre et le format de sortie de l'agent. Traite-les comme la pièce la plus porteuse — la plupart des gains de qualité viennent de la réécriture des instructions, pas du changement de modèle.

## Connaissances

Les connaissances sont le sous-ensemble de la [base de connaissances](/fr/platform/workspace/knowledge-base) que l'agent peut chercher. Par défaut, les agents peuvent chercher dans tout ce que l'organisation a téléversé ; tu resserres ce périmètre par dossier, par équipe ou par type d'entité (Documents, Produits, Clients, Fournisseurs).

Des connaissances plus étroites veulent dire des résultats de recherche plus pertinents — un agent support qui ne fouille que le dossier côté client ne se laisse pas distraire par les documents internes d'ingénierie. Plus étroit veut aussi dire moins cher, parce que moins de documents atteignent le modèle à chaque recherche.

## Outils

Les outils sont les capacités que l'agent peut invoquer pendant une conversation. Les outils intégrés incluent la recherche dans les connaissances, la recherche web, le traitement de documents et l'analyse d'image. Chaque intégration que tu as configurée (API REST, SQL, courriel) apparaît comme outil, comme chaque [serveur MCP](/fr/platform/integrations/mcp-servers) actif.

Tu actives ou désactives chaque outil par agent. Un agent de recherche en lecture seule peut avoir la recherche web activée et toutes les opérations d'écriture coupées. Un agent qui met à jour des tickets dans un système de support a l'outil d'intégration support activé et tout le reste coupé. La liste des outils sépare l'agent qui sait seulement parler de l'agent qui sait agir.

## Modèle

Chaque agent est lié à un préréglage de modèle — **Rapide**, **Standard** ou **Avancé**. Chaque préréglage pointe vers un modèle IA précis configuré dans tes [Fournisseurs IA](/fr/platform/admin/providers). Rapide est le moins cher et le plus rapide ; Avancé est le plus capable. La plupart des agents finissent sur Standard ; prends Avancé quand la qualité de raisonnement compte plus que la latence, et Rapide pour les tâches de routine à fort volume où la vitesse l'emporte sur la nuance.

## Tout mettre ensemble

Les quatre boutons se combinent en de nombreux agents depuis la même plateforme. Trois formes concrètes :

| Scénario               | Instructions                                        | Connaissances                          | Outils                                    | Modèle   |
| ---------------------- | --------------------------------------------------- | -------------------------------------- | ----------------------------------------- | -------- |
| Support amical         | Serviable, concis, refuse les questions hors sujet. | Docs du Centre d'aide uniquement.      | Recherche connaissances, lookup client.   | Standard |
| Recherche commerciale  | Creuse profond, cite les sources.                   | Tous documents + sites web + Produits. | Recherche connaissances, recherche web.   | Avancé   |
| Exploration de données | Prudent, explique les requêtes.                     | Toutes les connexions SQL.             | Intégration SQL, recherche connaissances. | Rapide   |

## Quand y recourir

Les agents sont le primitif conversationnel de Tale. Leur primitif frère est l'**automatisation** — un programme multi-étapes qui tourne sans humain dans la boucle. Les deux résolvent des problèmes différents, et la plupart des équipes finissent avec les deux.

| Utilise un agent quand …                                      | Utilise une automatisation quand …                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Un humain est dans la conversation et pose des questions.     | Un déclencheur planifié, un webhook externe ou un événement interne la déclenche.         |
| Le flux est ouvert — l'étape suivante dépend de la réponse.   | Le flux est déterministe — mêmes étapes à chaque fois, dans le même ordre.                |
| La sortie est du texte ou une petite charge utile structurée. | La sortie est un effet sur un autre système (enregistrement mis à jour, courriel envoyé). |
| La latence compte parce que quelqu'un attend.                 | La latence de fond est acceptable ; la justesse compte plus.                              |

Beaucoup de fonctionnalités mêlent les deux : un agent qui délègue un travail long à une automatisation, ou un workflow dont l'étape LLM utilise les instructions d'un agent. Choisis le primitif principal selon que l'utilisateur est dans la conversation au moment où le travail doit avoir lieu.

## En construire un

Les concepts sont posés. La page suivante traverse le flux de création de bout en bout — nommer, choisir un modèle, écrire les instructions, brancher des connaissances, activer des outils, et publier la première version. Continue là : [Créer un agent](/fr/platform/agents/create).
