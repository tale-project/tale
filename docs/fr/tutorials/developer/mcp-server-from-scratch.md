---
title: Monter un serveur MCP depuis zéro
description: Enregistrer ton propre serveur MCP pour que les agents l’appellent ne fait pas partie de cette version — Tale est lui-même le serveur MCP, alors branche ton client sur l’endpoint entrant.
---

Ce tutoriel expliquait comment héberger un serveur Model Context Protocol et l’enregistrer dans les paramètres pour que les agents de l’organisation appellent ses outils. Cette direction n’existe pas dans cette version de Tale : il n’y a ni panneau de serveurs MCP, ni formulaire d’enregistrement, et une capacité qui mènerait à un outil MCP externe est refusée à l’exécution avec une raison lisible. Ce qui est livré, c’est la direction inverse — Tale est lui-même un serveur MCP auquel tes outils se connectent.

<Note>

Les serveurs MCP sortants ne sont pas disponibles dans cette version. L’ancienne adresse **Paramètres > Serveurs MCP** redirige vers **Paramètres > Connectors**, qui liste les connectors livrés par Tale et rien de spécifique à MCP.

</Note>

## Connecte plutôt ton client à Tale

Tale expose un endpoint MCP par déploiement, sous `/api/v1/mcp`, authentifié par une clé API d’organisation. Vingt-deux outils se tiennent derrière : écrire et déployer des automatisations, les exécuter et lire leurs exécutions, chercher et invoquer ce que l’organisation sait faire. **Paramètres > API > MCP** affiche l’URL de l’endpoint de ton déploiement, l’inventaire des outils dans ces trois groupes et, sous **Essaie**, une requête à copier dans un terminal :

```bash
curl -X POST https://your-host.example.com/api/v1/mcp \
  -H 'Authorization: Bearer <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Les détails du protocole, la table complète des outils et ce que la clé de chaque rôle peut faire sont sur [Endpoint MCP](/fr/develop/mcp-endpoint) ; la création de la clé, sur [Clés API](/fr/platform/admin/api-keys).

## Atteindre ton propre code depuis Tale aujourd’hui

Emballer ton propre service pour qu’un agent l’utilise prend l’une de trois formes dans cette version. Un [connector](/fr/platform/connectors/overview) est le pont spécifique à un éditeur que Tale livre — prends-le quand il en existe un pour le système visé. Une [automatisation](/fr/platform/automations/catalog) appelle des actions de connector et exécute ton propre JavaScript dans des nœuds `transform`, sur un planning ou un webhook ; tu la téléverses comme un paquet. Un [agent de projet](/fr/platform/projects/project-agents) porte des **Secrets** — une clé API qu’il reçoit en variable d’environnement — et appelle ainsi, depuis sa sandbox, un service qui n’a pas de connector.

## Où cela se place

La surface MCP de cette version pointe vers l’intérieur : des clients externes pilotent Tale, pas l’inverse. Quand tu veux qu’un modèle hors de Tale écrive des automatisations ou cherche dans les connaissances de l’organisation, connecte-le à l’endpoint ; quand tu veux qu’un agent dans Tale atteigne ton code, passe par un connector, une automatisation ou les secrets d’un agent de projet. [Endpoint MCP](/fr/develop/mcp-endpoint) est la référence du premier chemin ; l’[aperçu des connectors](/fr/platform/connectors/overview) ouvre le second.
