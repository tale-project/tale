---
title: Développer avec Tale
description: Connecte un autre système à Tale, automatise un processus ou contribue au code de l’application.
---

Ces guides t’aident à écrire un client, à connecter un système externe ou à modifier Tale. Commence par une requête simple qui fonctionne, puis ajoute l’authentification, le périmètre d’accès et la gestion des erreurs nécessaires à ton intégration.

## Choisir une tâche de développement

| Ton objectif | Guide |
| --- | --- |
| Écrire un script qui envoie un message et lit la réponse | [Appeler Tale depuis un script](/fr/tutorials/developer/call-tale-from-a-script) |
| Construire un client pour les projets, tâches, fichiers ou autres ressources | [Référence de l’API](/fr/develop/api-reference) |
| Connecter un client MCP | [Point d’accès MCP](/fr/develop/mcp-endpoint) |
| Déclencher une automatisation depuis un autre système | [Webhooks](/fr/develop/webhooks) |
| Accéder aux documents avec un client de système de fichiers | [API WebDAV](/fr/develop/webdav-api) |
| Développer un Connector | [Développement de Connectors](/fr/develop/connectors) |
| Modifier le code applicatif de Tale | [Configurer l’environnement de développement](/fr/develop/contributor-setup) |

## Fiabiliser la première requête

Choisis l’identifiant adapté à la surface : REST et MCP utilisent des clés API, WebDAV un mot de passe d’application et un webhook une URL secrète de déclencheur. Ces identifiants ne sont pas interchangeables.

Crée une clé API distincte pour chaque intégration. Envoie-la uniquement à l’instance prévue et ne la conserve pas dans le dépôt de code. [Effectuer ta première requête API](/fr/get-started/developers) explique les URL d’instance et le contexte d’organisation. Pour une opération longue, distingue l’acceptation de la requête de son résultat : consulte la ressource ou l’exécution et traite aussi les échecs.

Lis les [limites de requêtes](/fr/develop/rate-limits) avant d’ajouter des tentatives automatiques. En cas de problème de connexion, vérifie la [disponibilité de l’instance](/fr/develop/status-page). La référence de l’API décrit le format des erreurs et la spécification générée pour la version actuelle du code.

## Développer dans la plateforme

Pour les agents, les projets et l’éditeur d’automatisations, consulte le [guide développeur](/fr/platform/developer/overview). Le guide du [développement assisté par IA](/fr/develop/ai-assisted-development) explique comment associer les outils de création à la validation et à la revue.

<Video src="/videos/fr/tutorials/ep10-developers/ep10-developers.fr.mp4" poster="/videos/fr/tutorials/ep10-developers/ep10-developers.fr.webp" captions="/videos/fr/tutorials/ep10-developers/ep10-developers.fr.vtt" lang="fr" title="Bonus — Tale pour les développeurs" caption="Bonus — Tale pour les développeurs (2:04)">

</Video>
