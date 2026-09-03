---
title: Construire un agent avec du savoir
description: Lier des documents à un agent ne fait pas partie de cette version — les connaissances appartiennent à toute l’organisation, indexées sous Connaissances, et l’assistant de chat comme les agents de projet les lisent depuis là.
---

Ce tutoriel liait trois documents à un agent neuf : le créer sous **Agents > Nouvel agent** avec le tool RAG activé, ouvrir son onglet **Connaissances**, choisir les documents, puis discuter avec l’agent et vérifier les citations. Aucun de ces écrans n’existe dans cette version de Tale — il n’y a ni éditeur d’agent, ni onglet **Connaissances** par agent, ni agent avec lequel ouvrir un chat. Les connaissances, elles, sont bien là ; elles appartiennent à l’organisation et non à un agent, et chaque voie lit dans ce même fonds.

<Note>

Lier des documents à un agent n’est pas disponible dans cette version. Téléverse les documents sous **Connaissances** ; l’assistant de chat les fouille quand une question le demande, et un agent de projet les lit par les outils de la plateforme dont tu l’équipes.

</Note>

## Obtenir des réponses depuis tes documents aujourd’hui

Téléverse les documents sous [Documents](/fr/platform/knowledge/documents) et attends la fin de l’indexation — un document dont l’indexation n’est pas terminée ne se retrouve pas encore. Puis interroge l’**assistant de chat** : il fouille les connaissances de l’organisation avec `rag_search` chaque fois que la question le demande, charge le passage trouvé avec `rag_fetch` et liste sous la réponse les sources qu’il a réellement lues — dérivées des résultats des outils, si bien qu’une carte de source n’affirme jamais une lecture qui n’a pas eu lieu. Quand la base de connaissances ne peut pas être fouillée du tout — aucun modèle d’embedding configuré, le fonds encore vide —, l’assistant le dit au lieu de répondre comme si rien n’existait. Impossible de le restreindre à trois documents ; il lit les connaissances de l’organisation.

Un **agent de projet** lit les documents et les entrées de connaissances par les outils de la plateforme que tu lui accordes sous **Skills, connectors & outils**, limités à son projet. Ses **Instructions** sont l’endroit où vit désormais la règle de l’ancien tutoriel — « réponds seulement à partir des documents de l’organisation, cite le titre, refuse quand rien ne correspond » —, et le résultat revient en commentaire de tâche, en **En revue**, où tu vérifies la citation avant d’accepter. [Agents de projet](/fr/platform/projects/project-agents) parcourt l’équipement ; [Construire ton premier agent](/fr/tutorials/editor/first-agent-end-to-end) en crée un de zéro.

## Où cela se place

Dans cette version, les connaissances sont une propriété de l’organisation, pas d’un agent : tu décides de ce qui est indexé, et le chat, les agents de projet et le `get_knowledge` de l’endpoint MCP lisent dans ce même fonds, chacun avec ses règles d’accès. [Connaissances d’agent](/fr/platform/agents/knowledge) est le versant conceptuel ; la [Base de connaissances](/fr/platform/knowledge/overview) est l’endroit où tu façonnes le fonds — les documents, et les sites web que tu y fais collecter.
