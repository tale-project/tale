---
title: Ce que tu peux construire
description: Orientation pour quiconque construit des agents et des automatisations.
---

Si tu configures Tale pour ton équipe, cette section est pour toi. "Construire" veut dire mettre en place les parties de la plateforme que tout le monde utilise — les agents avec qui on discute, les automatisations qui tournent en arrière-plan, les intégrations qui connectent Tale à tes autres systèmes, et les connaissances que l'IA peut chercher.

## Les blocs de base

### Agents

Un agent est un assistant IA sur mesure. Tu choisis son system prompt, quel modèle IA il utilise, à quelles connaissances il accède, quels outils il peut appeler et comment il doit se comporter. Pense à un agent comme un rôle nommé — "Support client", "Recherche commerciale", "Revue juridique" — chacun avec ses règles.

Voir [Concepts des agents](/fr/platform/agents/concepts) pour le modèle mental, [Créer un agent](/fr/platform/agents/create) pour le pas-à-pas, et [Versions des agents](/fr/platform/agents/versions) pour itérer sur un agent en production en toute sécurité.

### Automatisations

Une automatisation est un workflow multi-étapes qui démarre sur un trigger — un calendrier, un événement, un webhook ou un lancement manuel. Chaque étape fait une chose : appeler une API, interroger une base, demander à un LLM, faire un branchement, parcourir une liste. Les automatisations gèrent le travail qui se passe sans humain dans le chat.

Voir [Concepts des automatisations](/fr/platform/automations/concepts), [Workflows](/fr/platform/automations/workflows), [Triggers](/fr/platform/automations/triggers) et [Journaux d'exécution](/fr/platform/automations/execution-logs).

### Connaissances

La base de connaissances est ce que les agents cherchent pour répondre aux questions. Tu peux téléverser des documents, pointer vers des sites web à crawler et importer des enregistrements structurés (Produits, Clients, Fournisseurs). Bien curer la base de connaissances est ce qui rend les réponses de l'IA utiles.

Voir [Données structurées](/fr/platform/knowledge/structured-data) et [Crawling de sites](/fr/platform/knowledge/crawling).

## Intégrations

Les intégrations connectent Tale aux systèmes où vivent tes vraies données — REST API, bases SQL, e-mail, Microsoft 365. Une fois configurées, les intégrations sont disponibles comme outils pour les agents et comme steps d'action dans les automatisations.

Voir [Intégrations — aperçu](/fr/platform/integrations/overview) et [Bring your own model](/fr/platform/integrations/providers).

## Permissions

Construire requiert le rôle **Editor** pour les agents et le rôle **Developer** pour les automatisations, intégrations et clés API. Voir [Membres et rôles](/fr/platform/admin/members-and-roles) pour la matrice complète.

## Construction assistée par IA

Tous les blocs peuvent aussi être créés depuis des fichiers JSON dans ton répertoire de projet. Si tu ouvres le projet dans un éditeur IA (Claude Code, Cursor, GitHub Copilot, Windsurf), l'éditeur a le contexte complet des schémas et capacités plateforme — tu décris ce que tu veux en langage naturel et l'IA génère la configuration. Voir [AI-assisted development](/fr/develop/ai-assisted-development).
