---
title: Connaissances d’agent
description: Il n’y a pas d’onglet Connaissances par agent dans cette version — les connaissances se gèrent à l’échelle de l’organisation et se lisent par les outils de recherche de l’assistant de chat et les outils de plateforme d’un agent de projet.
---

Cette page décrivait un onglet **Connaissances** de l’éditeur d’agent avec un seul réglage — quel corpus la recherche d’un agent a le droit de lire. Cet onglet ne fait pas partie de cette version de Tale. Les connaissances elles-mêmes sont bien là : les documents et les sites explorés de l’organisation sont indexés sous **Connaissances**, l’assistant de chat les cherche dès qu’une question le demande, et un agent de projet les lit par ses outils de plateforme.

<Note>

La portée de connaissances par agent n’est pas disponible comme réglage dans cette version. Le format de fichier des personas porte encore un champ `knowledge`, mais aucun écran ne le règle et le chat n’exécute pas de personas.

</Note>

## Où les connaissances se décident aujourd’hui

Les sources sont à l’échelle de l’organisation. Téléverse et range des fichiers sous [Documents](/fr/platform/knowledge/documents), ajoute des sites à explorer sous [Exploration de sites web](/fr/platform/knowledge/crawling), et lis la [Base de connaissances](/fr/platform/knowledge/overview) pour le fonctionnement de l’indexation. Tout ce qui est indexé appartient à ton organisation ; rien de ce qu’un agent récupère ne franchit jamais la frontière vers le matériel d’un autre client.

L’**assistant de chat** atteint ce matériel par `rag_search` et `rag_fetch` — il cherche quand la question le demande, charge le passage trouvé en entier et répond à partir de lui. Un document dont l’indexation n’est pas finie n’est pas encore trouvable ; un assistant qui semble ignorer une source évidente attend en général l’index. Quand la base de connaissances ne peut pas être cherchée du tout — pas de modèle d’embedding configuré, corpus encore vide — l’assistant en est informé dans le résultat de l’outil et te le dit, au lieu de répondre comme si rien n’existait.

Un **agent de projet** lit les documents et les connaissances par les outils de plateforme dont tu l’équipes, dans les limites de son projet : il ne voit jamais le tableau ni les fichiers d’un autre projet. [Agents de projet](/fr/platform/projects/project-agents) couvre l’équipement ; l’[endpoint MCP](/fr/develop/mcp-endpoint) donne à un client hors de Tale la même recherche par `get_knowledge`.

## Où cela se place

Les connaissances sont, dans cette version, une propriété de l’organisation et non d’un agent : tu décides ce qui est indexé, et chaque voie — le chat, les agents de projet, l’endpoint MCP — lit dans ce seul fonds avec ses propres règles d’accès. La [Base de connaissances](/fr/platform/knowledge/overview) est l’endroit où le façonner ; [Outils d’agent](/fr/platform/agents/tools) couvre le reste de ce qu’un agent peut faire.
