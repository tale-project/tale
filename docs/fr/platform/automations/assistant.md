---
title: Assistant d’automatisation
description: Un agent de chat rattaché à une automatisation ne fait pas partie de cette version — tu modifies une automatisation sur sa propre page, et un modèle en rédige une par l’endpoint MCP.
---

Cette page décrivait l’**Assistant d’automatisation** : un agent de chat rattaché à une seule automatisation, avec son document, ses agents, ses compétences et ses connectors en contexte, capable de modifier des nœuds, d’enregistrer des versions et de lancer des simulations à ta place. Il n’existe pas dans cette version de Tale. Le chat n’a aucun agent rattaché à quoi que ce soit — l’assistant de chat porte trois outils de récupération en lecture seule et ne peut ni lire ni modifier une automatisation — et le canvas n’a pas de panneau d’assistant. Ce qui reste, ce sont les deux voies par lesquelles une automatisation se construit et se comprend vraiment : sa propre page, et l’endpoint MCP.

<Note>

L’Assistant d’automatisation n’est pas disponible dans cette version. Il n’y a aucun agent de chat lié à une automatisation ni aucun éditeur d’agent auquel il remettrait du JSON ; le versant agent d’une automatisation est son nœud **agent**, modifié dans le panneau comme n’importe quel autre nœud.

</Note>

## Comprendre et modifier une automatisation aujourd’hui

Ouvre l’automatisation depuis **Automatisations**. Son canvas montre le graphe entier d’un coup — le déclencheur, les nœuds et les arêtes entre eux — et sélectionner un nœud ouvre sa configuration dans le panneau latéral ; c’est là que tu modifies, que tu enregistres une version avec **Enregistrer** et une note, que tu la lances contre des simulations avec **Essai**, et que tu la promeus avec **Mettre cette version en service** quand elle est juste. [L’éditeur de workflow](/fr/platform/automations/editor) est le manuel d’exploitation de cette page, y compris le gate de mise en service que forment les propres tests d’une automatisation. Les pièces que l’ancien assistant rédigeait pour toi se modifient là où elles vivent : un identifiant sous **Paramètres > Connectors** ([Identifiants d’connector](/fr/platform/admin/connectors)), un déclencheur sur la page de l’automatisation elle-même ([Déclencheurs d’automatisation](/fr/platform/automations/triggers)).

## Laisser un modèle en rédiger une

La voie faite pour les modèles est l’[endpoint MCP](/fr/develop/mcp-endpoint) : pointe dessus un agent de code, un IDE ou ta propre boucle avec une clé API de l’organisation, et il tient les outils de rédaction que l’assistant portait autrefois — `get_docs` pour la grammaire, `validate_automation`, `save_automation`, `run_automation` contre les mocks, `test_automation` et `deploy_automation` — plus `list_automations` et `search_capabilities` pour trouver ce qui existe déjà avant de construire un doublon. Enregistrer par l’endpoint ajoute une version exactement comme la page le fait, et rien ne passe en service tant que quelque chose ne le met pas en service. Ce qu’une clé peut enregistrer et mettre en service suit le rôle de son détenteur : un droit de développeur, comme sur la page.

## Où cela s’inscrit

Dans cette version, une automatisation se lit et se modifie à deux endroits — sa page pour les personnes, l’endpoint MCP pour les modèles — et aucun des deux n’est un chat. [Concepts d’automatisation](/fr/platform/automations/concepts) est le vocabulaire que les deux présupposent ; [Ajouter des automatisations à ton organisation](/fr/platform/automations/catalog) est l’endroit d’où viennent les packs livrés, les brouillons et les téléversements.
