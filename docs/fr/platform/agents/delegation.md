---
title: Workers d’agent
description: Le tool de worker spawn_agent ne fait pas partie de cette version — le travail passe à un agent de projet par une tâche du tableau et à une automatisation par son nœud agent.
---

Cette page expliquait les workers : un tool `spawn_agent` avec lequel l’agent de ton chat composait un sous-agent éphémère, le faisait tourner et repliait le résultat dans sa réponse sous une carte de job. Ce tool n’existe pas dans cette version de Tale — l’assistant de chat n’a aucun moyen de lancer quoi que ce soit, et il n’y a pas de carte de job. Confier du travail à un agent reste le geste central ; il passe par les tâches et les automatisations.

<Note>

La délégation à un worker depuis le chat n’est pas disponible dans cette version. Le chat répond aux questions et cherche ; le travail qui produit quelque chose est une tâche assignée à un agent de projet.

</Note>

## Confier du travail aujourd’hui

Assigne une tâche du tableau à un **agent de projet** et clique sur **Démarrer l'agent**. L’agent travaille dans une sandbox isolée avec la description, les commentaires et les fichiers d’entrée de la tâche pour contexte, poste son rapport en commentaire de la tâche, attache les fichiers produits comme livrables et gare la tâche en **En revue** — un agent ne termine jamais le travail, une personne le fait. Oriente une exécution en cours ou lance la suivante en @-mentionnant l’agent dans un commentaire de la tâche ; il lit ton commentaire d’abord et reprend là où l’exécution précédente s’est arrêtée. [Automatisation des tâches](/fr/platform/projects/task-automation) est la boucle de bout en bout, [Agents de projet](/fr/platform/projects/project-agents) l’équipe depuis laquelle tu assignes.

Quand la passation doit se faire sans personne, une **automatisation** s’en charge : son nœud agent exécute un tour de harness comme une étape d’un workflow, sur un planning, un webhook ou un événement, à côté des actions de connector et des nœuds de code qui l’entourent. [Concepts d’automatisation](/fr/platform/automations/concepts) explique les pièces ; [Automatisations livrées](/fr/platform/automations/builtin) montre les paquets livrés.

## Où cela se place

La délégation, dans cette version, est explicite et relisible : une tâche nomme l’agent et le relecteur, une automatisation nomme son déclencheur et ses nœuds, et rien n’est lancé derrière une réponse. Prends une tâche quand une personne doit relire le résultat ; prends une automatisation quand le travail a des étapes fixes et doit tourner tout seul.
