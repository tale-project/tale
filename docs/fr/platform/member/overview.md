---
title: Pour commencer en tant que Membre
description: Se connecter, discuter, parcourir la base de connaissances et lire les conversations et approbations partagées — l’orientation jour 1 pour les Membres.
---

Bienvenue dans Tale. En tant que **Membre**, tu as un accès en lecture seule à l’espace de travail de ton organisation : tu peux discuter avec des modèles IA et des agents, parcourir la base de connaissances et lire les conversations et approbations partagées avec toi. Les Éditeurs et Développeurs de ton organisation créent le contenu ; les Membres le consomment.

Si tu dois aussi installer ou faire tourner une instance Tale toi-même, va voir [Démarrage rapide local](/fr/self-hosted/install/quickstart) ou [Déploiement en production](/fr/self-hosted/install/linux-server).

## Se connecter

Rien à installer — Tale tourne entièrement dans le navigateur. Ton Admin te fait entrer via l’une des trois méthodes, selon la configuration de ton organisation.

- **E-mail et mot de passe.** Ton Admin crée ton compte depuis **Paramètres → Membres** avec un mot de passe initial et te le transmet. Tu seras obligé·e de le changer à la première connexion.
- **SSO (Microsoft Entra).** Connecte-toi avec ton compte Microsoft existant ; ton compte Tale est provisionné automatiquement à la première connexion.
- **Reverse proxy (trusted headers).** Si Tale est derrière Authelia, Authentik, oauth2-proxy ou similaire, le proxy t’authentifie et ton compte est provisionné automatiquement à la première requête.

Si tu n’arrives pas à te connecter, demande à ton Admin quelle méthode est activée. (Admins : voir [Authentification](/fr/self-hosted/admin/authentication) pour la configuration côté instance.)

## Ce que tu peux faire

### Chat

Lance une conversation depuis l’écran d’accueil. Choisis un modèle, écris un message, et réponds. La saisie du chat prend aussi en charge :

- Joindre des fichiers (images, PDF, documents) — voir [pièces jointes](/fr/platform/chat/attachments).
- Mentionner un agent créé par un Éditeur ou un Développeur — voir [agents dans le chat](/fr/platform/chat/agents-in-chat).
- Comparer deux modèles côte à côte avec le [Mode Arène](/fr/platform/chat/arena-mode).

Référence complète : [bases du chat](/fr/platform/chat/basics).

### Parcourir la base de connaissances

La base de connaissances contient les documents uploadés ou crawlés par ton organisation. Cherche-la, ouvre des documents et référence-les depuis le chat. En tant que Membre, tu ne peux ni uploader ni supprimer — c’est le rôle des Éditeurs. Voir [base de connaissances](/fr/platform/workspace/knowledge-base).

### Lire les conversations et approbations

- **[Conversations](/fr/platform/workspace/conversations)** — threads de chat partagés par tes collègues.
- **[Approbations](/fr/platform/workspace/approvals)** — sorties d’automatisations en attente de revue humaine. Les Membres peuvent lire ; seuls les Éditeurs et au-dessus décident.

## Personnaliser ton compte

Nom affiché, langue, thème et préférences de notification se règlent depuis le menu de l’avatar. Détails : [préférences](/fr/platform/member/preferences).

## Aller plus loin ?

Les Membres sont en lecture seule. Pour créer des agents, modifier du savoir ou exécuter des automatisations, demande à ton Admin une montée de rôle. La matrice complète des rôles est sur [Membres et rôles](/fr/platform/admin/members-and-roles).
