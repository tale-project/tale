---
title: Admin
description: Admin est le plan de configuration — membres, équipes, fournisseurs, clés API, intégrations, branding, gouvernance. Les pages ici sont ce qu'un Administrateur ou Propriétaire parcourt pour monter une organisation et la faire tourner.
---

Admin est le plan de configuration de Tale. Cela couvre les personnes qui peuvent se connecter, les équipes qui les regroupent, les fournisseurs IA derrière chaque réponse, les clés API qui permettent à du code externe de parler à l'organisation, les intégrations tierces que les agents traversent, et le branding que le reste de l'organisation voit. Seuls les Administrateurs et Propriétaires voient le menu Admin complet ; les Développeurs en voient un sous-ensemble, et les autres rôles ne le voient pas du tout.

Ces pages décrivent ce que fait chaque réglage et ce qu'il change au produit en cours. La plupart se lisent une fois au montage, puis se revisitent quand quelque chose change — un nouveau collègue, une clé rotée, un nouveau fournisseur, une nouvelle intégration. L'histoire des rôles et permissions derrière le menu vit dans [Membres et rôles](/fr/platform/admin/members-and-roles) ; les pages indexées ci-dessous présupposent cette histoire et partent par fonctionnalité.

## Pages dans cette section

**[Membres et rôles](/fr/platform/admin/members-and-roles)** — Les Administrateurs et Propriétaires lisent ceci quand ils invitent des personnes ou scopent l'accès par rôle.

**[Agents](/fr/platform/admin/agents)** — Les Administrateurs et Propriétaires lisent ceci pour voir chaque agent de l'organisation et intervenir quand l'un d'eux a besoin de gouvernance.

**[Clés API](/fr/platform/admin/api-keys)** — Les Administrateurs et Développeurs lisent ceci quand ils branchent du code externe ou un service interne à l'API REST de Tale.

**[Intégrations](/fr/platform/admin/integrations)** — Les Administrateurs lisent ceci quand ils installent ou rotent les identifiants derrière Slack, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily et MCP.

**[Fournisseurs](/fr/platform/admin/providers)** — Les Administrateurs lisent ceci quand ils branchent OpenAI, Anthropic, Azure ou un Ollama local et choisissent quels modèles l'organisation peut utiliser.

**[Équipes](/fr/platform/admin/teams)** — Les Administrateurs lisent ceci pour regrouper les membres en équipes qui se partagent agents, prompts et intégrations.

## Où cela s'inscrit

Admin est la surface que chaque autre onglet présuppose. Chat résout un modèle à travers les fournisseurs configurés ici ; les agents appellent des tools à travers les intégrations configurées ici ; la bibliothèque de prompts et l'inbox respectent les frontières d'équipe configurées ici. La première lecture naturelle est [Membres et rôles](/fr/platform/admin/members-and-roles) — chaque autre page Admin référence les noms de rôles qui y sont définis.
