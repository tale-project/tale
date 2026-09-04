---
title: Développeur
description: Développeur est la surface développeur en-app — clés API pour l’API REST, l’endpoint MCP et les identifiants de connector avec lesquels une personne de rôle Développeur branche Tale à du code externe.
---

Développeur est la surface en-app pour les personnes qui branchent Tale au reste de leur pile. Elle regroupe les leviers qui laissent du code externe parler à Tale et Tale atteindre l’extérieur : les clés API pour la surface REST, l’endpoint MCP auquel les clients MCP se connectent, et les identifiants de connector derrière ce que les agents et les automatisations peuvent appeler. Les personnes de rôle Développeur voient ces paramètres ; les Membres et les Éditeurs ne les voient pas.

Cette vue d’ensemble nomme ce que couvre chaque page et pointe vers la référence plus complète. Qui a le rôle Développeur atterrit en général ici le premier jour, crée les identifiants nécessaires et revient quand la pile grandit — faire tourner une clé, pointer un nouveau client MCP vers l’endpoint, connecter un service de plus.

## Ce que couvre Développeur

La surface Développeur se tient à côté du reste des paramètres de l’organisation, mais pour un public plus étroit. Elle suppose que tu sais ce qu’est une API REST, à quoi ressemble un webhook et ce que fait un client MCP — les pages ne réexpliquent pas les concepts ; elles montrent comment Tale les expose. Deux leviers de la version précédente ne font pas partie de celle-ci : enregistrer des serveurs MCP externes et définir des outils personnalisés. Ton propre code atteint un agent par les **Secrets** d’un agent de projet ou les nœuds d’une automatisation — [Serveurs MCP](/fr/platform/connectors/mcp-servers) dit ce qui a remplacé le premier ; [Agents de projet](/fr/platform/projects/project-agents) parcourt la boîte de dialogue où vit désormais le second.

La même surface ne diffère entre les onglets Cloud et Auto-hébergé que par la forme du déploiement ; l’interface est identique. Le versant fichiers de configuration — variables d’environnement et fichiers de fournisseurs — vit un onglet plus loin, dans la documentation Auto-hébergé.

## Pages de cette section

<CardGroup cols="2">

<Card title="Clés API" icon="key" href="/fr/platform/admin/api-keys">

Brancher un script, une tâche cron ou un service interne à l’API REST de Tale. Partagée avec Admin sous **Paramètres > API > REST**.

</Card>

<Card title="Endpoint MCP" icon="network" href="/fr/develop/mcp-endpoint">

Pointer un client MCP vers Tale — l’URL de l’endpoint, l’inventaire des outils et une requête à copier se trouvent sous **Paramètres > API > MCP**.

</Card>

<Card title="Identifiants de connector" icon="plug" href="/fr/platform/admin/connectors">

Ajouter, désigner par défaut, désactiver et reconnecter les identifiants avec lesquels les connectors livrés agissent — ce que les agents et les automatisations atteignent hors de Tale.

</Card>

</CardGroup>

## Où cela s’inscrit

Développeur est le pont entre Tale et le reste de la base de code que l’organisation fait tourner. La première lecture dépend de ce que tu viens brancher — pour l’entrant (quelque chose dehors appelle Tale) [Clés API](/fr/platform/admin/api-keys) et l’[endpoint MCP](/fr/develop/mcp-endpoint) ; pour le sortant (quelque chose dans Tale atteint l’extérieur) [Identifiants de connector](/fr/platform/admin/connectors) et les [Secrets](/fr/platform/projects/project-agents) d’un agent de projet.
