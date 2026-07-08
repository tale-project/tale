---
title: Concepts d'agent
description: Un agent est la combinaison à quatre boutons d'instructions, de connaissances, d'outils et d'un modèle. Cette page te donne le modèle mental que le reste de la section agents présuppose.
---

Un agent est l'unité vers laquelle Tale se tourne quand la même question revient sans cesse. Il est la combinaison à quatre boutons d'instructions, de connaissances, d'outils et d'un modèle — les quatre choses sur lesquelles tu agis pour faire varier son comportement. Les Éditeurs et les Développeurs les construisent ; les Membres et les autres rôles les exécutent.

Cette page te donne le modèle mental que le reste de la section présuppose. Lis-la une fois avant de construire ton premier agent ; reviens-y quand tu ne sais plus si un comportement à changer se trouve dans les instructions, les connaissances, les outils ou le modèle.

## Les quatre boutons

**Instructions** sont le system prompt — la prose qui encadre chaque réponse. Garde-les courtes, opiniâtres et concrètes ; de longues instructions se diluent dans de longues conversations. Précise la voix, les contraintes et les cas de refus.

**Connaissances** est ce que l'agent peut consulter. Lie des documents, clients, produits, fournisseurs ou sites web depuis la base de connaissances ; l'agent va chercher des chunks à la réponse et les cite. Les connaissances non liées sont invisibles pour l'agent — il n'y a pas de tirage implicite sur toute la bibliothèque de l'organisation.

**Outils** est ce que l'agent peut faire au-delà de répondre par du texte. Des familles d'outils intégrées couvrent web, fichiers, RAG sur les connaissances, exécution de code, délégation à des sous-agents, appel de workflow, serveurs MCP et entrée humaine. Active-les par agent — chaque outil que tu accordes élargit la frontière de confiance, donc garde la liste courte.

**Modèle** est le LLM derrière chaque réponse. Choisis le primaire, fixe un fallback, et Tale résout à la requête. Changer le modèle ne ré-entraîne rien — les trois autres boutons sont la « mémoire » du modèle pour le travail.

## Les compétences comme bundle

Une compétence empaquette des instructions et (optionnellement) un script sandbox dans un bundle réutilisable que tu attaches à un agent. Va vers une compétence quand le même motif apparaît sur plusieurs agents — une voix d'écriture, un calcul, une tâche en plusieurs étapes. Les compétences composent avec les quatre boutons : un agent avec trois compétences possède les instructions de chacune en plus des siennes.

La page de concept sur les compétences détaille l'arbitrage entre compétences et instructions inline : voir [Compétences](/fr/platform/agents/skills).

## Mis bout à bout — un agent de tri de support

Un premier agent utile est l'agent de tri de support : il lit la conversation entrante, décide de répondre directement, d'escalader à un humain ou de passer la main à un spécialiste. Les quatre boutons :

- Instructions : un paragraphe de voix + trois cas de refus explicites.
- Connaissances : la documentation produit et le dossier FAQ ; pas le code source.
- Outils : RAG, recherche web, et l'outil sous-agent pour l'escalade. Pas d'exécution de code.
- Modèle : un modèle capable en primaire, un plus petit en fallback quand le primaire est rate-limité.

La conversation se déroule alors : message utilisateur → instructions encadrent la réponse → la récupération de connaissances trouve trois chunks pertinents → les outils répondent ou délèguent → la réponse arrive avec ses citations.

## Quand y recourir

Un seul agent est la bonne forme quand la conversation reste dans un domaine et une voix. Va vers un [workflow](/fr/platform/workflows/concepts) quand le travail est multi-étapes et que tu veux des approbations ou de la planification entre les étapes ; va vers un chat brut (sans agent) quand tu explores une réponse toi-même et que les valeurs par défaut du modèle suffisent.

| Utilise … quand                                       | Agent | Chat brut | Workflow |
| ----------------------------------------------------- | ----- | --------- | -------- |
| La même question revient                              | ✓     |           |          |
| La voix ou les contraintes comptent                   | ✓     |           |          |
| Tu as besoin d'approbations ou de planification entre |       |           | ✓        |
| Tu explores une réponse une seule fois                |       | ✓         |          |

## Construis-en un

Les quatre boutons sont ce dont chaque agent Tale est fait : change-en un et tu as changé le comportement, change-en trois et tu as fait un nouveau produit. La lecture suivante naturelle est [Construis ton premier agent](/fr/tutorials/editor/first-agent-end-to-end) — elle parcourt les quatre boutons sur une instance neuve.
