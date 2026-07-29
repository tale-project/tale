---
title: Workers d'agent
description: Un agent peut lancer un worker ciblé pour une tâche via le tool spawn_agent. Cette page donne le modèle mental — quand lancer un worker, comment les capacités restent bornées et ce que montre la carte de job.
---

Tu lances un worker quand une tâche mérite son propre contexte ciblé : recherche ouverte, extraction en masse, rédaction d'un long document. L'agent avec qui tu discutes compose un **worker** à la demande — un nom, des instructions de tâche, une méthode de travail optionnelle et une sélection d'outils — le fait tourner et replie le résultat dans sa réponse. Les workers sont éphémères : ils existent pour un seul job, et leur exécution apparaît comme une **carte de job** dans le chat.

Cette page te donne le modèle mental pour savoir quand un worker est la bonne forme et comment la plateforme le maintient borné. Le parcours de bout en bout vit dans [Confier du travail à un worker](/fr/tutorials/editor/delegate-between-agents).

## Comment tourne un job

Quand l'agent appelle **spawn_agent**, Tale résout les capacités du worker, démarre une conversation enfant fraîche et fait tourner le worker en mode non interactif : il ne voit que la tâche envoyée par l'agent (pas tout l'historique du chat), suit sa progression sur une checklist visible en direct, et son dernier message revient à l'agent comme résultat. Le chat affiche une carte de job avec le nom du worker, la progression en direct, le statut final et une transcription dépliable de tout ce qu'il a fait.

Les workers ne te parlent jamais. Si un worker a besoin d'une information que seul un humain peut donner, il le dit dans son résultat et l'agent te pose la question — les questions viennent toujours de l'agent avec qui tu parles réellement.

## Les capacités sont toujours un sous-ensemble

Un worker ne peut détenir au plus que ce que détient l'agent qui le lance. Trois couches décident de la sélection effective :

- **La configuration de l'org** — les outils, skills et connectors de l'agent, tels que configurés par tes admins. Rien à gérer par worker.
- **La sélection par job** — l'agent choisit le plus petit ensemble dans ses propres capacités pour cette tâche (moins d'outils = un worker plus ciblé).
- **Les exceptions de plateforme** — quelques outils ne se transmettent jamais, au premier rang l'outil de question à l'utilisateur : les questions d'un worker passent par l'agent, pour qu'une réponse ne parte jamais dans le vide. Les workers ne peuvent pas non plus lancer de workers. Une exception va dans l'autre sens : chaque worker peut toujours lister et lire les fichiers du thread (téléversements, sorties générées) — écrire des fichiers ou exécuter du code reste une sélection explicite.

Tout ce qui sort de ces bornes est silencieusement ignoré et signalé — la carte de job montre ce qui a été retranché, et l'agent s'adapte (en te disant par exemple qu'une connector doit être connectée).

## Méthodes de travail

Pour du travail ouvert, l'agent peut accorder un **skill de méthodologie** comme méthode de travail du worker — `web-research` est fourni : planification en direct sur la checklist, budgets de recherche par question et un livrable cité. Les méthodologies sont des skills ; tes admins les gouvernent comme n'importe quel autre skill.

## Limites et dépense

Un worker tourne dans le tour qui l'a lancé et ne peut pas lui survivre ; quand le plafond est atteint, le job se termine avec sa progression partielle encore visible sur la carte. Ce plafond appartient à l'hôte qui exécute le tour, pas à l'agent, qui ne porte aucun délai propre. La consommation de tokens remonte à l'agent qui a lancé le job, et les limites de dépense s'appliquent à l'organisation dans son ensemble plutôt que par agent : le coût d'un job atterrit donc avec le reste de l'usage de l'organisation. Les admins plafonnent le nombre de jobs qui tournent en même temps via **Gouvernance → agent_jobs** (10 par défaut).

## Quand y recourir

| Prends … quand                                           | Worker | Agent seul | Workflow |
| -------------------------------------------------------- | ------ | ---------- | -------- |
| Une sous-tâche profite d'un contexte isolé et ciblé      | ✓      |            |          |
| L'agent peut bien répondre directement                   |        | ✓          |          |
| Le travail a des étapes fixes avec des validations entre |        |            | ✓        |

Le coût d'un worker est une exécution de plus ; le gain, un contexte propre avec exactement les bonnes capacités pour la sous-tâche — et une carte de job qui montre ce qui s'est passé. Quand les étapes sont fixes et que tu veux des validations ou de la planification entre elles, un workflow est la bonne forme.
