---
title: Créer un agent
description: Le dialogue de création et l’éditeur d’agent ne font pas partie de cette version — les agents que tu crées dans l’interface sont des agents de projet, et les personas de chat sont des fichiers de configuration.
---

Cette page parcourait un éditeur d’agent onglet par onglet : un dialogue de création, **Général**, **Instructions**, **Outils**, **Skills**, **Connaissances** et un bouton **Historique**. Cet éditeur ne fait pas partie de cette version de Tale, pas plus qu’un sélecteur d’agent dans le composer du chat. Deux choses sont réelles, et cette page t’y mène : les agents de projet, que tu crées bel et bien dans l’interface, et les personas d’agent, qui sont des fichiers de configuration.

<Note>

L’éditeur d’agent n’est pas disponible dans cette version. Il n’y a pas d’entrée agents dans la barre latérale ni de dialogue de création pour les personas de chat.

</Note>

## Crée plutôt un agent de projet

Les agents que tu crées dans l’interface appartiennent à un projet et travaillent les tâches de son tableau. Ouvre l’onglet **Agents** du projet, clique sur **Nouvel agent**, renseigne son **Nom**, choisis son **Harness** — le harness de code sur lequel il tourne — et son **Modèle**, équipe-le sous **Skills, connectors & outils**, ajoute des **Secrets** s’il doit appeler un service sans connector, écris ses **Instructions** et clique sur **Créer l'agent**. Assigne-lui une tâche et clique sur **Démarrer l'agent** pour le mettre au travail. [Agents de projet](/fr/platform/projects/project-agents) parcourt chaque champ ; [Harnesses](/fr/platform/agents/harnesses) explique les runtimes parmi lesquels tu choisis.

## Les personas restent de la configuration

Une persona — un nom, des instructions, une liste d’autorisation d’outils et une de skills, une portée de connaissances et une visibilité privée ou partagée — existe dans cette version comme fichier YAML dans la configuration de l’organisation, livrée avec `coding-agent`. Aucun écran n’en crée ni n’en modifie, et le chat n’en propose aucune à choisir : l’assistant de chat répond avec un jeu fixe d’outils de recherche. [Concepts d’agent](/fr/platform/agents/concepts) explique ce qu’une persona porte, [Agents (vue Admin)](/fr/platform/admin/agents) qui peut en modifier une et comment, et [Développement assisté par IA](/fr/develop/ai-assisted-development) où vivent les fichiers.

## Où cela se place

Créer un agent, dans cette version, c’est doter un projet d’une équipe : un agent nommé sur un harness, équipé pour le travail, démarré depuis une tâche et relu par une personne. Parcours [Agents de projet](/fr/platform/projects/project-agents) pour en construire un, et [Automatisation des tâches](/fr/platform/projects/task-automation) pour voir ce qui se passe une fois qu’il est assigné.
