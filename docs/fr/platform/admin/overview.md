---
title: Admin
description: Admin est le plan de configuration — membres, équipes, fournisseurs, clés API, connectors, branding, gouvernance. Les pages ici sont ce qu’un Administrateur ou Propriétaire parcourt pour monter une organisation et la faire tourner.
---

Admin est le plan de configuration de Tale. Cela couvre les personnes qui peuvent se connecter, les équipes qui les regroupent, les fournisseurs IA derrière chaque réponse, les clés API qui permettent à du code externe de parler à l’organisation, les connectors tierces que les agents traversent, et le branding que le reste de l’organisation voit. Seuls les Administrateurs et Propriétaires voient le menu Admin complet ; les Développeurs en voient un sous-ensemble, et les autres rôles ne le voient pas du tout.

Ces pages décrivent ce que fait chaque réglage et ce qu’il change au produit en cours. La plupart se lisent une fois au montage, puis se revisitent quand quelque chose change — un nouveau collègue, une clé rotée, un nouveau fournisseur. L’histoire des rôles et permissions derrière tout le menu vit dans [Membres et rôles](/fr/platform/admin/members-and-roles) ; commence par là, car chaque autre page Admin renvoie aux noms de rôles qu’elle définit.

Tu préfères regarder d’abord ? L’épisode 9 traverse toute la salle de contrôle — fournisseurs, garde-fous, audit, coûts — en trois minutes, sous-titres compris.

<Video src="/videos/fr/tutorials/ep9-governance/ep9-governance.fr.mp4" poster="/videos/fr/tutorials/ep9-governance/ep9-governance.fr.webp" captions="/videos/fr/tutorials/ep9-governance/ep9-governance.fr.vtt" lang="fr" title="Épisode 9 — Gouvernance, coûts & confiance" caption="Épisode 9 — Gouvernance, coûts & confiance (2:48)">

</Video>

## Domaines de configuration

<CardGroup cols="2">

<Card title="Membres et rôles" icon="users" href="/fr/platform/admin/members-and-roles">

Les six rôles et la matrice au niveau ressource qui dit qui peut lire, écrire, configurer et gouverner.

</Card>

<Card title="Équipes" icon="users-round" href="/fr/platform/admin/teams">

Regroupe les membres en équipes qui partagent documents, projets, skills et conversations.

</Card>

<Card title="Agents" icon="bot" href="/fr/platform/admin/agents">

Chaque agent de l’organisation, et là où un Administrateur intervient quand l’un a besoin de gouvernance.

</Card>

<Card title="Fournisseurs IA" icon="cpu" href="/fr/platform/admin/providers">

Enregistre les identifiants derrière chaque réponse et choisis quels modèles l’organisation peut appeler.

</Card>

<Card title="Connectors" icon="plug" href="/fr/platform/admin/connectors">

Enregistre et remplace les identifiants derrière Slack, Gmail, Outlook, Google Drive, GitHub, Shopify et plus.

</Card>

<Card title="Enterprise SSO" icon="shield-check" href="/fr/platform/admin/enterprise-sso">

Branche la connexion à ton fournisseur d’identité via SAML ou OIDC.

</Card>

<Card title="Clés API" icon="key" href="/fr/platform/admin/api-keys">

Émets les clés que le code externe utilise pour joindre l’API REST de Tale.

</Card>

<Card title="Branding" icon="palette" href="/fr/platform/admin/branding">

Le logo, le favicon et la couleur d’accent que le reste de l’organisation voit.

</Card>

<Card title="Authentification à deux facteurs" icon="smartphone" href="/fr/platform/admin/two-factor-authentication">

Exige un second facteur à la connexion et gère l’enrôlement dans toute l’organisation.

</Card>

<Card title="Changelog" icon="history" href="/fr/platform/admin/changelog">

Le journal in-produit de ce qui a été livré et quand.

</Card>

<Card title="Gouvernance" icon="scale" href="/fr/platform/admin/governance/audit-logs">

Journaux d’audit, politiques et limites, garde-fous, analyses, rétention et legal hold.

</Card>

</CardGroup>

## Où cela s’inscrit

Admin est la surface que suppose chaque autre onglet. Chat résout un modèle via les fournisseurs configurés ici ; les agents appellent des outils via les connectors configurées ici ; la bibliothèque de skills et l’inbox respectent les frontières d’équipe configurées ici. La lecture naturelle en premier est [Membres et rôles](/fr/platform/admin/members-and-roles) — chaque autre page Admin renvoie aux noms de rôles qu’elle définit.
