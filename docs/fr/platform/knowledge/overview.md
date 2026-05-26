---
title: Connaissance
description: Connaissance est la zone où vivent les documents et données structurées de l'org pour que les agents puissent les citer. Les Éditeurs la curent ; les agents récupèrent dessus à la réponse. Cette vue d'ensemble nomme les deux moitiés et pointe vers les pages par zone.
---

Connaissance est la zone où vivent les données de l'org pour que les agents puissent les lire. Elle a deux moitiés : **Documents** — fichiers non structurés passés par la pipeline d'indexation pour que les agents puissent récupérer les chunks pertinents à la réponse — et **Données structurées** — tables typées de clients, produits, fournisseurs et sites web que les agents lisent comme enregistrements, pas comme prose. Les Éditeurs curent les deux moitiés ; les agents voient les morceaux auxquels ils sont liés.

La zone Connaissance est l'endroit où atteint chaque agent qui a besoin d'ancrer ses réponses dans la réalité de l'org. La vue d'ensemble nomme les moitiés et les pages par zone ; le modèle au niveau concept de comment un agent utilise la connaissance à laquelle il est lié vit sous [Connaissance d'agent](/fr/platform/agents/knowledge).

## Les deux moitiés

**Documents** est la moitié non structurée. Lâche un PDF, un fichier Markdown, une présentation, un tableur, un fichier de code ; la pipeline d'indexation extrait le texte, le découpe, embed les chunks, et les range pour que les tools tagués RAG récupèrent les morceaux pertinents à la réponse. Le contenu n'a pas à coller à un schéma ; la pipeline lit ce que le fichier donne.

**Données structurées** est la moitié typée. Clients, Produits, Fournisseurs et Sites web sont des tables de premier rang avec champs nommés, validation et relations explicites. Un agent lit un enregistrement structuré comme il lit un objet JSON — champ par champ — et peut citer l'enregistrement directement. Va vers les données structurées quand le contenu a la même forme sur plusieurs lignes (chaque client a un nom, un courriel, un palier) ; va vers les documents quand le contenu est prose sans forme fixe.

Les deux moitiés partagent les mêmes leviers de visibilité et cadrage équipe. Un enregistrement client cadré équipe est invisible aux membres hors de l'équipe au même titre qu'un document cadré équipe.

## Comment les agents atteignent

Un agent ne voit pas toute la base de connaissances par défaut. L'onglet **Connaissance** de l'agent est l'endroit où tu lies des documents spécifiques, des listes de clients, des catalogues produits ou des crawls de sites web à l'agent. Les ressources liées sont visibles pendant la récupération ; les non liées ne le sont pas. C'est intentionnel — ça garde la frontière de confiance visible et empêche un agent de tirer quelque chose que l'org n'avait pas l'intention de lui montrer.

La récupération elle-même arrive à la réponse et est pilotée par la famille de tools taguée RAG sur l'agent. Un document lié est récupéré par la même mécanique peu importe d'où il vient — un téléversement direct, une sync OneDrive, un pull Confluence, un crawl de site web. Le champ source de chaque élément indexé pointe la citation vers l'original.

## Pages dans cette section

**[Documents](/fr/platform/knowledge/documents)** — Les Éditeurs lisent ceci quand ils téléversent des fichiers, regardent la pipeline d'indexation, et gèrent le cycle de vie par document.

**[Données structurées](/fr/platform/knowledge/structured-data)** — Les Éditeurs lisent ceci quand ils maintiennent des tables typées — clients, produits, fournisseurs, sites web — que les agents lisent comme enregistrements.

## Où cela s'inscrit

Connaissance est la couche de données dans laquelle les agents ancrent leurs réponses ; sans elle, les agents ne savent que ce que le modèle sait déjà. La lecture suivante naturelle dépend du contenu que tu amènes — pour les fichiers [Documents](/fr/platform/knowledge/documents) ; pour les enregistrements typés [Données structurées](/fr/platform/knowledge/structured-data) ; pour comment un agent se lie et récupère, [Connaissance d'agent](/fr/platform/agents/knowledge).
