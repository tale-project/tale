---
title: Développeur
description: Développeur est la surface développeur en-app — clés API, tools personnalisés, webhooks d’agent, serveurs MCP. Les pages ici sont ce qu’une personne de rôle Développeur parcourt quand elle câble Tale à du code externe.
---

Développeur est la surface en-app pour les personnes qui câblent Tale au reste de leur pile. Elle regroupe les quatre leviers qui laissent du code externe parler à Tale et Tale parler à du code externe : clés API pour la surface REST, tools personnalisés qui étendent la portée d’un agent, webhooks d’agent pour les déclencheurs entrants, et serveurs MCP pour le pont processus-externe. Les personnes de rôle Développeur voient ce menu ; les Membres et Éditeurs ne le voient pas.

Cette vue d’ensemble nomme ce que couvre chaque page et pointe vers la référence plus profonde. Les utilisateurs de rôle Développeur atterrissent typiquement ici à leur premier jour, montent les identifiants et tools dont ils ont besoin, et reviennent quand ils étendent la pile — ajouter un nouveau serveur MCP, roter une clé, enregistrer un nouveau webhook.

## Ce que couvre Développeur

La surface Développeur s’asseoit à côté du reste des paramètres de l’org mais avec une audience plus étroite. Elle suppose que tu sais ce qu’est une API REST, à quoi ressemble un webhook, et ce que fait un serveur MCP — les pages ne réexpliquent pas les concepts sous-jacents ; elles expliquent comment Tale les expose.

La même surface dans les onglets Cloud et self-hosted ne diffère que par la forme de déploiement ; l’UI ici est identique. Les équivalents fichier-de-configuration de certaines de ces fonctionnalités (variables d’environnement, configs JSON pour tools personnalisés) vivent un onglet plus loin dans la documentation self-hosted.

## Pages dans cette section

<CardGroup cols="2">

<Card title="Clés API" icon="key" href="/fr/platform/admin/api-keys">

Câbler un script, une tâche cron, ou un service interne à l’API REST de Tale. Partagée avec Admin sous Paramètres > Clés API.

</Card>

<Card title="Serveurs MCP" icon="server" href="/fr/platform/integrations/mcp-servers">

Enregistrer un processus externe protocole MCP et choisir quels de ses tools les agents de l’org peuvent appeler.

</Card>

<Card title="Tools d’agent" icon="wrench" href="/fr/platform/agents/tools">

Étendre le toolbelt d’un agent avec un tool personnalisé que les agents de l’org peuvent appeler.

</Card>

</CardGroup>

## Où cela s’inscrit

Développeur est le pont entre Tale et le reste de la base de code que l’org fait tourner. La première lecture naturelle dépend de ce que tu viens câbler — pour sortant (quelque chose dans Tale appelle dehors) [Tools d’agent](/fr/platform/agents/tools) et [Serveurs MCP](/fr/platform/integrations/mcp-servers) ; pour entrant (quelque chose dehors appelle dans Tale) [Clés API](/fr/platform/admin/api-keys).
