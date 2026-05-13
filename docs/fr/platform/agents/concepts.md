---
title: Concepts des agents
description: Le modèle mental derrière les agents Tale — instructions, connaissances, outils et modèles.
---

Un agent est un paquet de quatre choses : des **instructions** (comment il se comporte), des **connaissances** (ce qu’il peut lire), des **outils** (ce qu’il peut faire) et un **modèle** (comment il pense). Tout le reste — versions, webhooks, démarreurs de conversation — c’est de la plomberie autour de ces quatre.

## Instructions

Les instructions sont le system prompt que le modèle voit avant chaque message dans la conversation. Elles répondent à « qui es-tu et quel est ton job ? ». De bonnes instructions sont courtes, spécifiques et listent les règles à respecter.

Exemple :

> Tu es l’agent support d’Acme Corp. Réponds aux questions sur nos produits, la livraison et les retours. Ne donne pas de conseils médicaux ou juridiques. Réponds toujours dans la langue de l’utilisateur. Garde tes réponses sous 200 mots.

Changer les instructions change la personnalité, le périmètre et le format de sortie de l’agent.

## Connaissances

Les connaissances sont le sous-ensemble de la [base de connaissances](/fr/platform/workspace/knowledge-base) que l’agent peut chercher. Par défaut, les agents peuvent chercher dans tout ce que l’organisation a téléversé. Tu peux restreindre par dossier, équipe ou type d’entité (Documents, Produits, Clients, Fournisseurs).

Des connaissances plus étroites donnent des résultats plus pertinents — un agent support qui ne cherche que dans le dossier "Help Center" ne se laisse pas distraire par les docs internes d’ingénierie.

## Outils

Les outils sont des capacités que l’agent peut invoquer pendant une conversation. Les outils intégrés incluent la recherche dans les connaissances, la recherche web, le traitement de documents et l’analyse d’image. Les intégrations que tu as configurées (REST API, SQL, email) apparaissent aussi comme outils.

Tu peux activer ou désactiver chaque outil par agent. Un agent de recherche en lecture seule peut avoir la recherche web activée mais toutes les opérations d’écriture désactivées. Un agent billing n’a peut-être que l’intégration billing disponible.

## Modèle

Chaque agent est lié à un préréglage de modèle — **Rapide**, **Standard** ou **Avancé**. Chaque préréglage pointe vers un modèle IA précis configuré dans tes [fournisseurs](/fr/platform/admin/providers). **Rapide** est le moins cher et le plus rapide ; **Avancé** est le plus capable.

## Tout ensemble

Ces quatre boutons permettent de créer beaucoup d’agents depuis la même plateforme :

| Scénario               | Instructions                            | Connaissances                     | Outils                     | Modèle   |
| ---------------------- | --------------------------------------- | --------------------------------- | -------------------------- | -------- |
| Support amical         | serviable, concis, refuse hors-sujet    | uniquement docs du Help Center    | recherche, lookup client   | Standard |
| Recherche commerciale  | fouille en profondeur, cite les sources | tous documents + sites + Produits | recherche, recherche web   | Avancé   |
| Exploration de données | prudent, explique les requêtes          | toutes connexions SQL             | intégration SQL, recherche | Rapide   |

## Suite

Prêt à en construire un ? Va à [Créer un agent](/fr/platform/agents/create).
