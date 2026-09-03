---
title: Construire un outil personnalisé
description: Un panneau d’outils personnalisés dans les paramètres ne fait pas partie de cette version — cette page montre les trois endroits où ton propre code atteint un agent aujourd’hui.
---

Ce tutoriel définissait un outil dans un panneau **Paramètres > Outils personnalisés**, le câblait à un endpoint HTTPS et l’activait pour un agent. Rien de tout cela n’existe dans cette version de Tale : pas de registre d’outils personnalisés, pas d’interrupteur d’outil par agent, et les outils de l’assistant de chat sont fixes. Ce que tu peux faire, c’est poser ton code là où les agents regardent déjà — une action de connector, un nœud d’automatisation, ou un secret qu’un agent de projet utilise pour appeler ton API.

<Note>

Les outils personnalisés ne sont pas disponibles dans cette version. L’assistant de chat porte exactement trois outils en lecture seule — `rag_search`, `rag_fetch` et `web_fetch` — et aucun écran n’en ajoute un quatrième.

</Note>

## Où ton code atteint un agent

Choisis selon qui doit l’exécuter. Un **agent de projet** travaille les tâches du tableau dans sa propre sandbox ; équipe-le sur l’onglet **Agents** du projet, sous **Skills, connectors & outils**, et ajoute un **Secret** — une clé API livrée en variable d’environnement — quand le service qu’il doit appeler n’a pas de connector. L’agent lit la documentation de l’éditeur et appelle l’API lui-même. [Agents de projet](/fr/platform/projects/project-agents) parcourt le dialogue.

Une **automatisation** tourne sans personne dans la boucle. Ses nœuds appellent des actions de connector et exécutent ton propre JavaScript dans des nœuds `transform`, sur un planning ou un webhook ; écris-la sur le canvas ou [téléverse-la comme un paquet](/fr/platform/automations/catalog). [Concepts d’automatisation](/fr/platform/automations/concepts) est le modèle en dessous.

Un **connector** est le pont livré, spécifique à un éditeur — GitHub, Gmail, Outlook, Slack et les autres. Prends-le en premier quand il en existe un pour ta cible ; l’[aperçu des connectors](/fr/platform/connectors/overview) liste ce qui est livré et ce dont chacun a besoin.

## Où cela se place

La couture entre un agent et ton domaine est passée d’un registre d’outils par organisation aux endroits où le travail tourne déjà : l’équipement et les secrets d’un agent de projet, les nœuds d’une automatisation, et les connectors livrés. Un modèle hors de Tale qui doit piloter tout cela passe par l’[endpoint MCP](/fr/develop/mcp-endpoint) ; l’équivalent REST est la [référence API](/fr/develop/api-reference).
