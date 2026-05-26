---
title: Connaissances d'agent
description: Lier des documents, clients, produits, fournisseurs et sites web à un agent pour qu'il puisse les citer — et la différence entre connaissances liées à l'agent et l'onglet Knowledge.
---

Les connaissances liées à un agent sont ce que l'agent peut atteindre au moment de la réponse. Sans liaison, l'agent est générique ; avec une liaison, il peut répondre à des questions sur des documents, clients ou sites web précis et citer d'où vient la réponse. Cette page couvre le mécanisme de liaison dans l'onglet **Knowledge** de l'agent.

Les sources de connaissances elles-mêmes vivent dans la section [Knowledge](/fr/platform/knowledge/overview) — Documents, Clients, Produits, Fournisseurs, Sites web. Lier est l'acte de donner à un agent l'accès à un sous-ensemble de ces sources ; sans liaison, il ne peut pas les voir.

## Une liaison déroulée

Ouvre un agent et clique **Knowledge**. Clique **Agent knowledge** et choisis trois documents dans la bibliothèque de l'organisation. Enregistre. Ouvre un chat avec l'agent et pose une question à laquelle les documents répondent. La réponse arrive en streaming avec des citations — survoler affiche le titre du document, cliquer ouvre le document. La récupération a fait tourner l'outil RAG uniquement sur les documents liés ; rien d'autre dans la bibliothèque n'était joignable.

## Types de sources

Cinq types de sources sont liables : **Documents** (PDF, DOCX, etc. téléversés dans la base de connaissances), **Clients** (enregistrements clients structurés), **Produits** (enregistrements produits structurés), **Fournisseurs** (enregistrements fournisseurs structurés), **Sites web** (contenus de sites crawlés). Chacun se lie de la même façon — choisir depuis une liste. La récupération de l'agent les traite différemment sous le capot : documents et sites web sont chunked et embedded ; les enregistrements structurés sont interrogés champ par champ.

## Portée

Les connaissances liées à un agent sont par-agent, pas par-chat. Chaque chat qui utilise l'agent a les mêmes liaisons. Pour limiter les connaissances à un seul chat, attache le fichier en ligne (voir [Pièces jointes](/fr/platform/chat/attachments)). Pour limiter les connaissances à un Projet, lie-les à un [agent de Projet](/fr/platform/projects/project-agents) à la place.

## Où ça s'inscrit

Les connaissances d'agent sont la réponse à « cet agent devrait savoir ces trucs précis ». La section Knowledge plus large est l'endroit où vivent les sources ; la liaison est ce qui branche un agent dans un sous-ensemble. La lecture suivante est [Aperçu de Knowledge](/fr/platform/knowledge/overview) pour le côté source, ou [Agent avec connaissances](/fr/tutorials/editor/agent-with-knowledge) pour la construction bout en bout sur une instance neuve.
