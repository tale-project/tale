---
title: Confier du travail à un worker
description: Le worker spawn_agent et sa carte de job ne font pas partie de cette version — confie le travail à un agent de projet par une tâche du tableau, ou à une automatisation par son nœud agent.
---

Ce tutoriel faisait tourner un job de recherche à travers un **worker** : tu demandais à l’assistant un travail ouvert et citable, il appelait `spawn_agent`, et une carte de job sous son tour montrait la progression, le résultat et la transcription du worker. Ce tool n’existe pas dans cette version de Tale — l’assistant de chat porte trois outils de recherche en lecture seule et ne peut rien lancer, il n’y a donc aucune carte de job à lire. Confier du travail à un agent reste le geste de tous les jours ; il passe désormais par le tableau du projet, où la passation a un responsable et un relecteur.

<Note>

La délégation à un worker depuis le chat n’est pas disponible dans cette version. Le chat répond aux questions et cherche ; le travail qui produit quelque chose est une tâche assignée à un agent de projet.

</Note>

## Confier du travail aujourd’hui

Le vrai parcours est court, et chaque étape se voit sur le tableau :

1. **Doter le projet.** Ouvre l’onglet **Agents** du projet et vérifie qu’un agent existe — [Agents de projet](/fr/platform/projects/project-agents) parcourt la boîte de dialogue, et [Construire ton premier agent](/fr/tutorials/editor/first-agent-end-to-end) en crée un de zéro.
2. **Écrire la demande comme une tâche.** Crée une tâche et mets la consigne dans sa description — pour l’exemple de recherche, la question, les sources que tu acceptes et la forme de réponse que tu attends. Joins des fichiers d’entrée à la tâche quand le travail en a besoin.
3. **Assigner et démarrer.** Assigne la tâche à l’agent et clique sur **Démarrer l'agent**. La carte passe en _En cours_ et l’agent travaille dans sa propre sandbox avec la description, les commentaires et les fichiers d’entrée pour contexte.
4. **Relire.** Le rapport arrive en commentaire de la tâche, les fichiers produits en livrables, et la tâche se gare en **En revue** — le **Relecteur** de la tâche reçoit une cloche et un e-mail. Déplace la carte vers _Terminé_ pour accepter ; pour renvoyer le travail, @-mentionne l’agent dans un commentaire avec ton retour, et une exécution de reprise continue là où la précédente s’est arrêtée.

[Automatisation des tâches](/fr/platform/projects/task-automation) décrit cette boucle de bout en bout, y compris ce qui se passe quand une exécution échoue.

## Sans personne dans la boucle

Quand la passation doit se faire toute seule, une **automatisation** s’en charge : son nœud agent exécute un tour de harness comme une étape d’un workflow — sur un planning, un webhook ou un événement — à côté des actions de connector et des nœuds de code qui l’entourent. [Concepts d’automatisation](/fr/platform/automations/concepts) explique les pièces ; [Automatisations livrées](/fr/platform/automations/builtin) montre les paquets livrés.

## Où cela se place

La délégation, dans cette version, est explicite et relisible : une tâche nomme l’agent et le relecteur, une automatisation nomme son déclencheur et ses nœuds, et rien n’est lancé derrière une réponse de chat. Prends une tâche quand une personne doit relire le résultat ; prends une automatisation quand le travail a des étapes fixes et doit tourner tout seul. Le versant conceptuel est [Workers d’agent](/fr/platform/agents/delegation).
