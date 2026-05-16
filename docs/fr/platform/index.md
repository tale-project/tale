---
title: Aperçu de la plateforme
description: Documentation produit de Tale — fonctionnalités, rôles et administration de l'organisation. S'applique de manière identique en Cloud et en auto-hébergé.
---

Platform rassemble toute la documentation produit de Tale. Tu y trouves chaque fonctionnalité visible par l'utilisateur — chat, base de connaissances, agents, automatisations, intégrations — ainsi que les guides par rôle orientés tâches et l'ensemble des paramètres au niveau de l'organisation (membres, rôles, équipes, image de marque, gouvernance, fournisseurs d'IA, analytique). Tout ce qui est ici s'applique à l'identique, que tu utilises l'édition [Cloud](/fr/cloud) managée ou une instance [auto-hébergée](/fr/self-hosted).

Seuls les sujets propres à une édition vivent ailleurs : facturation Cloud, résidence et SSO hébergé sont dans Cloud ; installation, configuration d'environnement, observabilité et notes de version sont dans auto-hébergé. Si une page décrit ce que tu vois dans l'interface, elle est dans cette section.

## Par fonctionnalité

- **[Chat](/fr/platform/chat/basics)** — la surface conversationnelle. Pièces jointes, agents dans le chat, Mode Arène pour comparer deux modèles côte à côte.
- **[Espace de travail](/fr/platform/workspace/knowledge-base)** — base de connaissances, conversations, approbations, canevas, bibliothèque de prompts, comparaison de documents.
- **[Agents](/fr/platform/agents/concepts)** — assistants IA personnalisés : ce qu'ils sont, comment en créer un, comment les versions fonctionnent.
- **[Automatisations](/fr/platform/automations/concepts)** — workflows multi-étapes, déclencheurs, journaux d'exécution.
- **[Connaissances](/fr/platform/knowledge/structured-data)** — données structurées et crawling de sites web.
- **[Intégrations](/fr/platform/integrations/overview)** — relier Tale aux fournisseurs d'IA, aux sources de données et aux outils tiers.

## Par rôle

Tale comprend six rôles. Quatre d'entre eux disposent ici d'un guide orienté tâches ; Propriétaire correspond à Admin plus quelques actions de cycle de vie ; Désactivé n'a pas d'accès au produit.

- **[Membre](/fr/platform/member/overview)** — lecture seule : utiliser le chat, parcourir les connaissances, consulter les conversations et les approbations.
- **[Éditeur](/fr/platform/editor/overview)** — Membre plus gestion de contenu et décisions d'approbation.
- **[Développeur](/fr/platform/developer/overview)** — Éditeur plus agents, automatisations, intégrations et clés API.
- **[Admin](/fr/platform/admin/overview)** — Développeur plus paramètres d'organisation.

## Administration de l'organisation

Les paramètres organisationnels s'appliquent aussi bien en Cloud qu'en auto-hébergé, sauf mention contraire. Référence canonique :

- [Membres et rôles](/fr/platform/admin/members-and-roles) — la matrice de permissions à six rôles.
- [Équipes](/fr/platform/admin/teams) — cloisonner l'accès aux connaissances et au chat.
- [Fournisseurs d'IA](/fr/platform/admin/providers) — configurer OpenAI, Anthropic, Google et des modèles auto-hébergés.
- [Image de marque](/fr/platform/admin/branding) — logos, couleurs, nom du produit.
- [Gouvernance](/fr/platform/admin/governance) — règles de contenu et de politique.
- [Analyses d'utilisation](/fr/platform/admin/usage-analytics) — activité par utilisateur et à l'échelle de l'organisation.

Pour la configuration de l'authentification (mot de passe, SSO, en-têtes de confiance), voir [Authentification auto-hébergée](/fr/self-hosted/admin/authentication) — la configuration est spécifique à l'auto-hébergement ; en Cloud, c'est l'interface d'administration hébergée qui s'en occupe.

## Où ça s'inscrit

Platform est la seule source de vérité sur ce que Tale fait, et la surface reste la même peu importe où tourne l'instance. Tout ce qui requiert un fichier de configuration, une variable d'environnement ou une commande CLI vit un onglet plus loin sous [auto-hébergé](/fr/self-hosted/overview) ; tout ce qui n'existe que pour les clients managés — facturation, SSO hébergé, domaines personnalisés — vit sous [Cloud](/fr/cloud). Si tu as atterri ici depuis un résultat de recherche et n'es pas sûr du rôle avec lequel lire, commence par [Membres et rôles](/fr/platform/admin/members-and-roles) — toute autre question d'administration se lit différemment une fois que cette page a répondu à qui peut faire quoi.
