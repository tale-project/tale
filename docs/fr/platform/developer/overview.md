---
title: Ce que tu peux construire
description: Orientation pour les personnes qui construisent agents et automatisations.
---

Cette section est pour les personnes qui mettent en place les parties de la plateforme que le reste de l'équipe utilise — les agents avec qui les autres discutent, les automatisations qui tournent en arrière-plan, les intégrations qui connectent Tale aux autres systèmes, et les connaissances dans lesquelles ces agents et automatisations s'ancrent. Si tu as un siège **Développeur** (ou un siège **Éditeur** pour le travail sur les agents), les pages ci-dessous sont ta référence.

« Construire » dans Tale, c'est surtout de la composition plutôt que du code. Tu décides ce qu'un agent doit savoir, ce qu'il peut faire et comment il doit se comporter — Tale s'occupe des appels modèles, de la mémoire de conversation, de l'orchestration des outils et de l'historique des runs. Le modèle mental ci-dessous est le petit ensemble de pièces que tu composes.

## Les blocs de base

### Agents

Un agent est un assistant IA sur mesure. Tu choisis son system prompt, quel modèle IA il utilise, à quelles connaissances il accède, quels outils il peut appeler et comment il doit se comporter. Pense à un agent comme à un rôle nommé — `Support client`, `Recherche commerciale`, `Revue juridique` — chacun avec ses règles, disponible dans le chat, dans les automatisations et via l'API.

Voir [Concepts des agents](/fr/platform/agents/concepts) pour le modèle mental, [Créer un agent](/fr/platform/agents/create) pour le pas-à-pas, et [Versions des agents](/fr/platform/agents/versions) pour itérer sur un agent en production en toute sécurité.

### Automatisations

Une automatisation est un workflow multi-étapes qui démarre sur un trigger — un calendrier, un événement, un webhook ou un lancement manuel. Chaque étape fait une chose : appeler une API, interroger une base, demander à un LLM, faire un branchement, parcourir une liste. Les automatisations gèrent le travail qui doit se passer sans humain dans le chat — imports nocturnes, fan-out de webhooks entrants, résumés programmés.

Voir [Concepts des automatisations](/fr/platform/automations/concepts) pour le modèle mental, [Workflows](/fr/platform/automations/workflows) pour l'éditeur, [Triggers](/fr/platform/automations/triggers) pour les démarrages et [Journaux d'exécution](/fr/platform/automations/execution-logs) pour déboguer les runs.

### Connaissances

La base de connaissances est ce que les agents cherchent pour répondre aux questions. Tu téléverses des documents, tu pointes vers des sites web à crawler et tu importes des enregistrements structurés — Produits, Clients, Fournisseurs. Bien la curer, c'est ce qui transforme un agent qui hallucine en un agent qui cite.

Voir [Données structurées](/fr/platform/knowledge/structured-data) et [Crawling de sites](/fr/platform/knowledge/crawling).

### Intégrations

Les intégrations connectent Tale aux systèmes où vivent tes vraies données — API REST, bases SQL, fournisseurs de courriel, Microsoft 365. Une fois configurées, les intégrations sont disponibles comme outils pour les agents et comme étapes d'action dans les automatisations. La différence entre un agent qui donne des conseils génériques et un agent qui met à jour un ticket dans ton outil de support, c'est une intégration.

Voir [Intégrations — aperçu](/fr/platform/integrations/overview) et [Fournisseurs IA](/fr/platform/admin/providers).

## Permissions

Construire requiert le rôle **Éditeur** pour les agents et le rôle **Développeur** pour les automatisations, intégrations et clés API. La matrice complète vit à [Membres et rôles](/fr/platform/admin/members-and-roles) ; si un tutoriel échoue sur un bouton manquant, le rôle est la première chose à vérifier.

## Construction assistée par IA

Tous les blocs ci-dessus peuvent aussi être créés depuis des fichiers JSON dans ton répertoire de projet. Si tu ouvres le projet dans un éditeur IA (Claude Code, Cursor, GitHub Copilot, Windsurf), l'éditeur a le contexte complet des schémas et capacités plateforme — décris ce que tu veux en langage naturel et l'éditeur génère la configuration. Pour des workflows complexes ou des flottes d'agents, c'est généralement plus rapide que l'interface. Voir [AI-assisted development](/fr/develop/ai-assisted-development).

## Où ça s'inscrit

Le rôle Développeur est le siège construire-et-intégrer. La même personne qui construit les agents que tes Éditeurs entretiennent câble aussi les intégrations que les agents appellent, les automatisations qui tournent en arrière-plan, et les clés API qui permettent à des systèmes externes d'appeler Tale. Pour la matrice de permissions canonique, voir [Membres et rôles](/fr/platform/admin/members-and-roles) ; pour le travail cross-système (appeler Tale depuis un script, recevoir des webhooks), la section [Develop](/fr/develop/api-reference) est un onglet plus loin.
