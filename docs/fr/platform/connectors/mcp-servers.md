---
title: Connecter un client externe avec MCP
description: Retrouve le point d’accès MCP de Tale et comprends comment un client externe peut l’utiliser.
---

Le point d’accès MCP permet à un assistant de programmation externe ou à un autre client MCP de travailler avec ton organisation dans Tale. Il peut découvrir des capacités, créer des automatisations et examiner leurs exécutions. L’accès suit les droits de la personne derrière la connexion : le titulaire de la clé API, ou la personne qui a connecté l’agent.

## Trouver le point d’accès

Ouvre **Paramètres > API > MCP**. Là où les agents peuvent se connecter, la page commence par **Connecter un agent de code** : les commandes pour Claude Code et Codex, une ligne qui indique quand ton agent s’est connecté et un premier prompt à lui donner. En dessous, elle indique l’URL du déploiement, le slug de l’organisation, les groupes d’outils et une requête à copier pour vérifier la connexion. Un agent de code se connecte lui-même dès qu’il a cette adresse ([Agents connectés](/fr/platform/admin/connected-agents) montre et termine ces connexions) ; sinon, crée une clé adaptée sous **Paramètres > API**.

<Frame caption="Les paramètres MCP connectent un agent de code et fournissent le point d’accès, le contexte de l’organisation et les outils disponibles.">

![La page MCP commence par Connect a coding agent : les onglets Claude Code, Codex et Other, les deux commandes qui ajoutent Tale et connectent l’agent, une ligne qui attend la connexion de l’agent et un premier prompt à copier. En dessous, la section MCP endpoint affiche une URL se terminant par /api/v1/mcp.](/images/platform/settings-mcp-endpoint.webp)

</Frame>

Suis [Point d’accès MCP](/fr/develop/mcp-endpoint) pour configurer le client, l’authentification et les droits. Conserve la clé dans les réglages d’identifiants du client, pas dans un prompt ou un document partagé.

## Choisir le sens de la connexion

Le point d’accès de Tale accepte les connexions de clients externes. Tale ne propose pas de formulaire pour ajouter un serveur MCP externe à l’équipement de ses propres agents de projet.

Pour un agent dans Tale qui doit utiliser un autre service, consulte le [catalogue de connectors](/fr/platform/connectors/overview). Sans connector adapté, un [agent de projet](/fr/platform/projects/project-agents) peut appeler le service depuis sa sandbox avec un secret aux droits limités. L’agent en cours d’exécution peut lire ce secret : limite donc ses droits au travail demandé.

## Vérifier l’accès avant de créer

Commence par la requête de test de la page MCP et confirme que le client liste les outils. Vérifie ensuite les droits exigés par l’outil avant une écriture. Enregistrer une automatisation et la déployer sont deux opérations distinctes. Connecter un client ne contourne ni les tests de déploiement ni les règles d’approbation.

[Clés API](/fr/platform/admin/api-keys) explique le renouvellement et la révocation. [Comprendre les automatisations](/fr/platform/automations/concepts) présente leur cycle d’enregistrement, de test et de déploiement.
