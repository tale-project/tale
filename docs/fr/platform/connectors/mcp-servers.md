---
title: Serveurs MCP
description: Enregistrer des serveurs MCP externes pour que les agents les appellent ne fait pas partie de cette version.
---

Cette page décrivait un formulaire **Ajouter un serveur MCP** : un transport, une méthode d’authentification, une liste d’agents autorisés et une table d’outils découverts avec un drapeau d’approbation par outil. Rien de tout cela n’existe dans cette version de Tale. Il n’y a ni panneau de serveurs MCP, ni formulaire d’enregistrement, ni trousse d’agent qu’un serveur externe pourrait rejoindre — une capacité qui mènerait à un outil MCP externe est refusée à l’exécution avec une raison lisible. Ce qui est livré, c’est la direction inverse : Tale est lui-même un serveur MCP auquel des clients extérieurs se connectent.

<Note>

Les serveurs MCP sortants ne sont pas disponibles dans cette version. L’ancienne adresse **Paramètres > Serveurs MCP** redirige vers **Paramètres > Connectors**, qui liste les connectors livrés par Tale et rien de spécifique à MCP.

</Note>

## La surface MCP qui est livrée

Tale expose un endpoint MCP par déploiement, sous `/api/v1/mcp`, authentifié par une clé API d’organisation. Vingt-deux outils se tiennent derrière, en trois groupes — écrire et déployer des automatisations, les exécuter et lire leurs exécutions, chercher et invoquer ce que l’organisation sait faire. **Paramètres > API > MCP** affiche l’URL de l’endpoint de ton déploiement, l’inventaire dans ces trois groupes et, sous **Essaie**, une requête `tools/list` à copier. [Endpoint MCP](/fr/develop/mcp-endpoint) est la référence — protocole, table des outils et ce que la clé de chaque rôle peut faire ; [Clés API](/fr/platform/admin/api-keys) couvre la création de la clé.

<Frame caption="Paramètres > API > MCP — l’URL de l’endpoint à donner à ton client, l’inventaire des outils dans ses trois groupes et une requête pour essayer la clé.">

![La page MCP sous Paramètres > API, avec la ligne Endpoint MCP dont l’URL se termine par /api/v1/mcp et son bouton de copie, trois lignes qui listent les noms d’outils par groupe — Écriture, Gestion des exécutions & déclencheurs, Skills & connaissances — et une ligne Essaie qui contient une requête curl appelant tools/list avec une clé API en bearer.](/images/platform/settings-mcp-endpoint.webp)

</Frame>

## Atteindre ton propre code depuis un agent aujourd’hui

Emballer ton propre service pour qu’un agent l’utilise prend l’une de trois formes dans cette version. Un [connector](/fr/platform/connectors/overview) est le pont spécifique à un éditeur que Tale livre — prends-le quand il en existe un pour le système visé. Une [automatisation](/fr/platform/automations/catalog) appelle des actions de connector et exécute ton propre JavaScript dans des nœuds `transform`, sur un planning ou un webhook ; tu la téléverses comme un paquet. Un [agent de projet](/fr/platform/projects/project-agents) porte des **Secrets** — une clé API qu’il reçoit en variable d’environnement — et appelle ainsi, depuis sa sandbox, un service qui n’a pas de connector.

## Où cela se place

La surface MCP de cette version pointe vers l’intérieur : des clients externes pilotent Tale, pas l’inverse. Quand un modèle hors de Tale doit écrire des automatisations ou chercher dans les connaissances de l’organisation, connecte-le à l’[endpoint MCP](/fr/develop/mcp-endpoint) ; quand un agent dans Tale doit atteindre ton code, passe par un connector, une automatisation ou les secrets d’un agent de projet — l’[aperçu des connectors](/fr/platform/connectors/overview) ouvre ce chemin.
