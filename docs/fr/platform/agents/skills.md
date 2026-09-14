---
title: Équiper les agents avec des skills
description: Choisis des bundles de skills pour les agents de projet et les nœuds d’automatisation, vérifie leur accès et contrôle leur utilisation.
---

Équipe un agent avec un skill lorsqu’il a besoin d’une procédure réutilisable ou de références provenant de la [bibliothèque de skills](/fr/platform/workspace/skills) de l’organisation. La bibliothèque conserve le bundle ; l’équipement de l’agent détermine les bundles disponibles pendant ses exécutions.

## Choisir un skill adapté à la tâche

Un skill utile explique quand l’utiliser, comment procéder et à quoi ressemble un bon résultat. Par exemple, équipe l’agent chargé des notes de version avec le skill correspondant. Fournis-lui quelques changements, puis vérifie que sa réponse respecte le format attendu.

Le bundle contient `SKILL.md` et peut inclure des références, des ressources ou des scripts. L’import ne lance pas ces fichiers. Une fois le skill équipé, ses instructions peuvent toutefois guider un agent de programmation disposant d’un shell ou d’autres outils, y compris pour exécuter un script du bundle. Vérifie tout le contenu avant utilisation : un skill ne constitue pas une limite de permission supplémentaire.

## Équiper un agent de projet

Ouvre l’[agent de projet](/fr/platform/projects/project-agents) et sélectionne les skills nécessaires dans son équipement. La liste dépend de l’accès du projet, même si tu peux personnellement lire davantage de skills :

| Accès du projet | Skills disponibles |
| --- | --- |
| Projet ouvert à toute l’organisation | Skills de l’organisation |
| Projet partagé avec des équipes | Skills de l’organisation et skills d’équipe partagés avec au moins une équipe du projet |

Les anciens skills privés ne peuvent pas équiper un agent de projet. La même règle d’accès est vérifiée au démarrage d’une tâche : sélectionner un skill ne donne pas au projet un accès permanent à celui-ci.

## Utiliser des skills dans une automatisation

Les nœuds agent d’une automatisation déclarent les skills dont ils ont besoin. Une exécution liée à un projet utilise l’accès de ce projet. Une exécution au niveau de l’organisation peut seulement utiliser les skills de l’organisation. Ton appartenance personnelle à d’autres équipes n’élargit pas ces accès.

Lors de la préparation de la sandbox, Tale met les bundles équipés à disposition sous forme de fichiers et indique à l’agent les chemins de leurs instructions `SKILL.md`. Les fichiers complémentaires se trouvent à côté. Limite l’équipement aux besoins de la tâche et précise quelle procédure utiliser. La disponibilité d’un skill ne prouve pas à elle seule que le résultat suit ses instructions.

## Vérifier les skills manquants ou modifiés

Si un skill requis manque ou n’est plus partagé avec le périmètre de l’exécution, sa mise à disposition échoue en indiquant son nom. Vérifie son slug, sa visibilité, les équipes du projet et une éventuelle suppression ou un remplacement. Rétablis l’accès prévu ou retire l’équipement obsolète avant de réessayer.

Les modifications d’un bundle partagé s’appliquent à ses prochaines mises à disposition. Vérifie les remplacements et teste l’agent avec une entrée connue après un changement important. Ne suppose pas qu’un skill de même nom dans le dépôt remplace le bundle équipé.

## Choisir entre skills et instructions de l’agent

| Utilise un skill lorsque… | Utilise les instructions de l’agent lorsque… |
| --- | --- |
| plusieurs agents partagent la même procédure. | elles définissent le rôle ou le ton de cet agent. |
| la procédure nécessite des fichiers de référence ou des scripts. | il s’agit d’une règle courte et stable pour cet agent. |
| la procédure doit être maintenue à un seul endroit. | elles expliquent comment cet agent doit utiliser ses skills. |

Le [guide de la bibliothèque de skills](/fr/platform/workspace/skills) explique comment créer, importer, modifier et partager un bundle.
