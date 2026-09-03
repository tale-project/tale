---
title: Outils d’agent
description: Il n’y a pas d’onglet Outils par agent dans cette version — l’assistant de chat porte un jeu fixe d’outils en lecture seule, et les agents de projet s’équipent dans leur propre dialogue.
---

Cette page décrivait l’onglet **Outils** de l’éditeur d’agent : un catalogue d’interrupteurs par outil, groupés en cartes de catégorie, avec la recherche web, **Exécuter du code** et des serveurs MCP connectés parmi eux. Cet onglet ne fait pas partie de cette version de Tale. Ce qu’un agent peut faire se décide à deux autres endroits — un jeu fixe pour l’assistant de chat, et l’équipement que tu donnes à un agent de projet quand tu le crées.

<Note>

Le catalogue d’outils par agent n’est pas disponible dans cette version. Le chat porte trois outils en lecture seule et aucun interrupteur n’en ajoute un quatrième ; les agents de projet s’équipent sur l’onglet **Agents** du projet.

</Note>

## Ce que les agents peuvent faire aujourd’hui

L’**assistant de chat** a exactement trois outils, fixés à dessein : `rag_search` cherche dans les connaissances de l’organisation, `rag_fetch` charge le contenu complet de ce qu’il a trouvé, et `web_fetch` récupère une page publique. Le chat sert aux questions et à la recherche ; il ne produit pas de fichiers et n’exécute pas de code, donc un livrable — un document, un tableur, un fichier traduit — se fabrique sur une tâche.

Un **agent de projet** s’équipe dans son dialogue sous **Skills, connectors & outils** : les skills déposent des bundles de référence dans sa sandbox, les connectors relaient un service connecté, et les outils de la plateforme le laissent lire — et, quand tu accordes un outil d’écriture, modifier — les tâches, contacts, produits, documents et connaissances de l’organisation, dans les limites de son projet. Les **Secrets** lui remettent une clé API en variable d’environnement pour un service sans connector. Il tourne dans une sandbox isolée avec un shell ; exécuter du code fait donc partie du harness, pas d’un interrupteur. [Agents de projet](/fr/platform/projects/project-agents) parcourt le dialogue.

Une **automatisation** atteint les mêmes connectors par ses nœuds et tourne sur un déclencheur plutôt qu’à la demande — [Concepts d’automatisation](/fr/platform/automations/concepts) est le modèle. Les serveurs MCP externes ne sont pas connectés dans cette version ; la seule surface MCP est l’[endpoint entrant](/fr/develop/mcp-endpoint), par lequel des clients hors de Tale le pilotent.

## L’éditeur retiré

Ceux qui connaissent le manuel précédent se souviennent de l’onglet Outils ci-dessous. Il n’est montré que pour que le changement soit reconnaissable — aucun écran de cette version ne l’affiche, et rien dessus ne peut être activé.

<Frame caption="L’onglet Outils de l’ancien éditeur d’agent — un écran que cette version ne livre pas.">

![L’onglet Outils de l’éditeur d’agent, défilé jusqu’aux cartes de catégorie, avec Connaissances à trois outils cochés sur quatre et Fichiers à sept sur sept, tandis que Conversations, Discussions, Analytique et Tâches et projets n’ont rien d’accordé.](/images/platform/agent-editor-tools.webp)

</Frame>

## Où cela se place

Les outils suivent la voie : le chat cherche, un agent de projet agit dans son projet avec l’équipement que tu lui as donné, et une automatisation agit sur un déclencheur. Lis [Agents de projet](/fr/platform/projects/project-agents) pour le dialogue d’équipement et [Connaissances d’agent](/fr/platform/agents/knowledge) pour la façon dont la recherche est cadrée dans cette version.
