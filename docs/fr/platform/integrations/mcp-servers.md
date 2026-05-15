---
title: Serveurs MCP
description: Connecte des serveurs Model Context Protocol externes à Tale pour que leurs outils et ressources apparaissent comme des outils d'agent.
---

Un serveur Model Context Protocol (MCP) est un processus externe qui expose un ensemble d'outils, de ressources et de prompts via un petit RPC standardisé. Tale enregistre un serveur MCP une fois et rend ensuite ses outils disponibles à chaque agent de l'organisation qui s'y branche. Là où une [intégration](/fr/platform/integrations/overview) Tale enveloppe la surface REST ou SQL d'un fournisseur dans un manifeste écrit par Tale, un serveur MCP laisse un tiers publier son propre catalogue d'outils — et Tale le consomme sans écrire de connecteur.

Cette page est la référence de l'écran **Paramètres > Serveurs MCP** et du schéma sous-jacent. Le public visé : Admins et Développeurs qui connectent un serveur MCP à une organisation. Les Membres et Éditeurs ne voient pas cette surface ; ils voient apparaître de nouveaux outils sur leurs agents.

## Un exemple complet

Le chemin le plus court vers une intégration MCP qui marche est d'enregistrer un serveur Streamable HTTP public avec auth par clé API. Pour enregistrer le serveur `example-tools` à `https://mcp.example.com`, ouvre **Paramètres > Serveurs MCP**, clique sur **Ajouter un serveur MCP** et remplis :

```json
{
  "name": "example-tools",
  "displayName": "Example Tools",
  "transportType": "streamable_http",
  "url": "https://mcp.example.com/mcp",
  "authType": "api_key"
}
```

Après l'enregistrement, Tale demande la clé API, la stocke chiffrée et fait passer le serveur en état `discovering`. Le RPC de découverte renvoie la liste d'outils du serveur en quelques secondes ; le statut bascule sur `active` et chaque outil découvert est désormais activable sur les agents à **Agents > [agent] > Outils**.

## Types de transport

Tale supporte trois transports MCP. Choisis selon l'endroit où tourne le serveur et comment Tale l'atteint.

| Transport         | Quand le choisir                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `streamable_http` | Le serveur est un service HTTP public qui parle le transport MCP Streamable HTTP. Le défaut pour les serveurs MCP hébergés.                                                                       |
| `sse`             | Le serveur est un service HTTP qui parle l'ancien transport Server-Sent Events. Encore supporté pour la compatibilité avec d'anciens serveurs.                                                    |
| `stdio`           | Le serveur est un processus local que Tale lance via une commande (`command` + `args`). Valide uniquement sur les instances auto-hébergées où le processus peut tourner à côté du conteneur Tale. |

`streamable_http` et `sse` ont tous deux besoin d'une `url` ; `stdio` a besoin de `command`, d'`args` optionnel et d'une `env` optionnelle pour les variables d'environnement passées au processus lancé.

## Authentification

Trois types d'auth couvrent les formes courantes :

| Type d'auth | Ce que Tale stocke                                                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none`      | Rien. Le serveur est ouvert ou sans auth (typique pour les transports `stdio` qui tournent en local).                                                                                                           |
| `api_key`   | Une clé API unique (`apiKeyEncrypted`), passée à chaque requête selon la convention du serveur.                                                                                                                 |
| `oauth2`    | Une config client OAuth 2.0 (`tokenUrl`, `authorizationUrl` optionnel, `clientId`, `clientSecretEncrypted`, `scopes`, `grantType`) plus les tokens d'accès/refresh que Tale obtient après l'achèvement du flux. |

OAuth2 supporte deux types de grant : `client_credentials` pour serveur-à-serveur, et `authorization_code` pour les flux où un admin autorise Tale à agir au nom d'un compte. Ce dernier déclenche une redirection vers `authorizationUrl` quand l'intégration est connectée ; Tale stocke les tokens d'accès et de refresh et rafraîchit le token d'accès automatiquement quand il expire.

Tous les secrets — `apiKeyEncrypted`, `clientSecretEncrypted`, `accessTokenEncrypted`, `refreshTokenEncrypted` — sont stockés chiffrés au repos, restreints à l'organisation.

## États de statut

Chaque entrée serveur MCP porte un champ `status` qui reflète la santé de la connexion.

| Statut        | Signification                                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `discovering` | État initial après enregistrement. Tale appelle le RPC `tools/list` du serveur pour peupler `discoveredTools`.                   |
| `active`      | Découverte réussie et serveur joignable. Les outils sont activables sur les agents.                                              |
| `inactive`    | L'admin a désactivé le serveur manuellement. La liste d'outils découverts est préservée ; la réactivation saute la redécouverte. |
| `error`       | La dernière tentative de connexion a échoué. La raison est dans `lastError` ; corrige les identifiants ou l'URL et re-teste.     |

## Outils découverts

Quand la découverte se termine, le catalogue d'outils du serveur atterrit dans le tableau `discoveredTools`. Chaque outil a un `name`, une `description` optionnelle, un `inputSchema` optionnel (JSON Schema pour les paramètres) et un flag `requiresApproval` optionnel.

`requiresApproval: true` fait que chaque invocation de cet outil génère une carte d'approbation dans le chat — le même flux qu'une opération `write` sur une intégration native Tale. Utilise-le pour les outils qui touchent les systèmes de facturation, envoient des messages au nom de quelqu'un ou modifient des données de production. La doctrine complète sur les approbations vit à [Approbations](/fr/platform/workspace/approvals).

La liste découverte est ce parmi quoi les propriétaires d'agents choisissent quand ils activent des outils MCP à **Agents > [agent] > Outils > Serveurs MCP**. Activer un serveur MCP sur un agent accorde l'accès à tous les outils de ce serveur ; la granularité au niveau outil par outil vit dans la config d'outils de l'agent, pas dans l'enregistrement du serveur MCP.

## Où ça s'inscrit

Les serveurs MCP sont le chemin « apporte ton propre catalogue d'outils » ; les [intégrations](/fr/platform/integrations/overview) sont le chemin « emballons un fournisseur qu'on connaît ». Ils coexistent — un agent peut utiliser les deux — et tous deux apparaissent dans le même sélecteur d'outils d'agent. Va vers MCP quand le serveur existe déjà (un tiers en publie un pour son produit), et vers un connecteur quand tu contrôles le wrapper et veux la sémantique lecture/écriture de Tale, le tableau d'opérations et le guide de configuration du connecteur.

Pour activer les outils d'un serveur MCP sur un agent spécifique, ouvre l'agent et suis la [section Outils](/fr/platform/agents/create) du flux de construction d'agent. Pour vérifier quels agents ont quels outils MCP activés, le [Journal d'audit](/fr/platform/admin/governance) enregistre chaque changement d'activation/désactivation avec l'acteur et l'horodatage.
