---
title: Développeur
description: Le siège construction-et-intégration — agents, automatisations, intégrations, serveurs MCP et clés API. L'atterrissage orienté tâches du Développeur pour le quotidien.
---

Un **Développeur** dans Tale est le siège construction-et-intégration. Tu câbles les parties de la plateforme que tout le monde utilise : les agents pour lesquels tes Éditeurs curent du savoir, les automatisations qui tournent en arrière-plan, les intégrations qui connectent Tale à d'autres systèmes, et les clés API qui laissent scripts et webhooks appeler Tale depuis l'extérieur. Tout ce qu'un Éditeur peut faire, tu peux le faire ; en plus, tu crées et publies des automatisations, configures intégrations et serveurs MCP et gères les clés API. Tu ne changes pas les paramètres de l'organisation — image de marque, gouvernance, fournisseurs, rôles des membres — c'est le territoire de l'Admin.

Construire dans Tale, c'est surtout de la composition plutôt que du code. Tu décides ce qu'un agent doit savoir, ce qu'il peut faire et comment il doit se comporter ; Tale gère les appels au modèle, la mémoire de conversation, l'orchestration des tools et l'historique d'exécution. Le modèle mental ci-dessous est le petit ensemble de pièces que tu composes. La matrice canonique de permissions vit sous [Membres et rôles](/fr/platform/admin/members-and-roles) — lis-la quand un tutoriel cale sur un bouton manquant.

## Une journée de Développeur

Une journée typique de Développeur commence dans **Automatisations** pour regarder les exécutions de la nuit — vert, c'est ennuyeux ; rouge, c'est la première chose à trier depuis les logs d'exécution. À partir de là, le travail se sépare en deux : l'équipe Éditeur a besoin qu'un agent soit mis à jour avec un nouveau filtre de connaissances et un nouveau tool, et un webhook entrant du système de support a besoin d'un nouveau pas d'automatisation. L'édit d'agent est un seul écran à changer dans **Agents** et une publication ; le nouveau pas est ajouté dans l'éditeur de workflow, testé en marche à blanc et expédié derrière un flag de fonctionnalité. En fin d'après-midi, un Admin demande une rotation de clé API ; tu crées la clé de remplacement, tu la bascules sur l'appelant externe et tu révoques l'ancienne.

Les pages ci-dessous sont rangées dans l'ordre que la journée demande — d'abord les agents parce que la question est en général « l'agent fait-il la bonne chose ? », puis les automatisations parce que la question devient « et quand personne ne regarde ? », puis le savoir et les intégrations parce que ce sont les entrées des deux.

## Pages dans cette section

- **[Concepts d'agents](/fr/platform/agents/concepts)** — les quatre pièces dont chaque agent est fait (instructions, connaissances, tools, modèle) et les arbitrages que chaque pièce nomme.
- **[Créer un agent](/fr/platform/agents/create)** — pas à pas, d'un `Agents > Nouveau` vide à un agent publié que le reste de l'équipe peut choisir dans le chat.
- **[Versions d'agent](/fr/platform/agents/versions)** — comment itérer sur un agent en production sans casser les conversations et automatisations qui l'utilisent déjà.
- **[Concepts d'automatisation](/fr/platform/automations/concepts)** — le modèle mental : workflow, pas, déclencheur, exécution, branchement, boucle. À lire une fois, à revoir ensuite.
- **[Workflows](/fr/platform/automations/workflows)** — l'éditeur visuel où les pas sont ajoutés, câblés et testés en marche à blanc.
- **[Déclencheurs](/fr/platform/automations/triggers)** — planifications, webhooks, événements, exécutions manuelles ; comment une automatisation démarre.
- **[Logs d'exécution](/fr/platform/automations/execution-logs)** — entrées, sorties, décisions de branchement et erreurs par exécution ; le débogueur que tu sors quand une automatisation a pris le mauvais chemin.
- **[Données structurées](/fr/platform/knowledge/structured-data)** — produits, clients, fournisseurs ; les lignes contre lesquelles les agents groundent quand une réponse demande plus qu'un document.
- **[Crawling de site](/fr/platform/knowledge/crawling)** — pointer Tale sur un site, planifier les re-crawls, regarder l'indexeur remplir la base de connaissances.
- **[Aperçu des intégrations](/fr/platform/integrations/overview)** — REST, SQL, courriel, Microsoft 365 ; les systèmes où vivent les vraies données.
- **[Fournisseurs IA](/fr/platform/admin/providers)** — propriété de l'Admin, lié ici parce que la sélection de modèle de chaque agent tire de ce catalogue.

## Construction assistée par IA

Chaque brique ci-dessus peut aussi être rédigée à partir de fichiers JSON dans ton répertoire de projet. Si tu ouvres le projet dans un éditeur conscient de l'IA (Claude Code, Cursor, GitHub Copilot, Windsurf), l'éditeur a tout le contexte sur les schémas et les capacités de la plateforme — décris en langage normal ce que tu veux, et l'éditeur génère la configuration. Pour les workflows complexes ou les flottes d'agents, c'est souvent plus rapide que l'interface. Voir [Développement assisté par IA](/fr/develop/ai-assisted-development) pour la configuration.

## Où cela s'insère

Le rôle Développeur est le siège construction-et-intégration. La même personne qui construit les agents que les Éditeurs curent câble aussi les intégrations que les agents appellent, les automatisations qui tournent en arrière-plan et les clés API qui laissent des systèmes externes appeler Tale. Pour la matrice canonique de permissions, voir [Membres et rôles](/fr/platform/admin/members-and-roles) ; pour le travail inter-systèmes (appeler Tale depuis un script, recevoir des webhooks), la section [Développer](/fr/develop/api-reference) est un onglet plus loin.
