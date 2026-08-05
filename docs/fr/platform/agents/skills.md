---
title: Les skills sur les agents
description: Comment un skill de la bibliothèque atteint un agent — équiper les agents d'un projet, quelle visibilité compte, et comment un bundle arrive dans une session sandbox.
---

Un agent n'atteint un skill que s'il est équipé — et l'équipement se choisit dans la [bibliothèque de skills](/fr/platform/workspace/skills) de l'organisation. Cette page parle des surfaces qui y puisent : les agents d'un projet et les nœuds agent d'une automatisation. Une seule règle décide de ce qu'elles peuvent choisir : **c'est la visibilité du projet lui-même qui compte, jamais celle du membre qui configure.**

## Ce que décide l'équipement

Un skill équipé est proposé au modèle par sa description. Quand le modèle juge cette description pertinente pour ta demande, il lit le corps de la `SKILL.md`, puis ouvre les fichiers du bundle là où le corps pointe vers eux. Rien n'est exécuté et rien n'est collé d'avance — un skill ne coûte du contexte que sur les tours où le modèle va réellement le chercher.

Un bundle dont le frontmatter porte `disable-model-invocation: true` se comporte autrement. Il reste équipé et lisible, mais le modèle ne doit pas y aller de lui-même ; il attend un tour où quelqu'un le nomme.

## Équiper les agents d'un projet

Un [agent de projet](/fr/platform/agents/create) porte son propre équipement, choisi dans le menu d'équipement du dialogue de l'agent. La liste y suit la visibilité du **projet**, pas la tienne : les skills de toute l'organisation, plus les skills d'équipe partagés avec l'une des équipes du projet. Un projet ouvert à toute l'organisation ne voit que les skills d'organisation, et les anciens skills privés n'apparaissent jamais — un agent de projet tourne pour chaque membre du projet, son équipement ne doit donc jamais embarquer quelque chose que seule son autrice pouvait voir.

La même règle tient à l'exécution. Un run de tâche charge les skills de l'agent en tant que projet ; une automatisation au niveau de l'organisation charge en tant qu'organisation. Un skill qui devient invisible pour ce périmètre fait échouer le run en le nommant, plutôt que de tourner sans lui en silence — un équipement choisi qui manque sans bruit est pire qu'un run raté.

## Les skills dans une session sandbox

Quand un tour s'exécute dans une sandbox, les bundles équipés n'arrivent pas par un appel d'outil. Ils sont chargés dans la session comme des fichiers, dans la disposition que le runtime sait déjà découvrir : le harness les trouve comme il trouverait un skill sur n'importe quelle machine où il travaille.

Une règle gouverne les collisions : le dépôt gagne. Si le dépôt extrait embarque un skill sous le même slug qu'un skill que Tale chargerait, Tale retient sa copie et la version du dépôt reste. Un dépôt peut toujours remplacer ce que la plateforme apprendrait sinon à l'agent, et la session ne tient jamais deux bundles qui revendiquent le même nom.

## Skill ou instructions

| Prends … quand                                                  | Skill | Instructions d'agent |
| --------------------------------------------------------------- | ----- | -------------------- |
| Le motif se répète sur plusieurs agents                         | ✓     |                      |
| Le comportement a besoin de fichiers de référence avec la prose | ✓     |                      |
| Le comportement est la voix de cet agent-là                     |       | ✓                    |
| Une modification doit atteindre tous ceux qui l'utilisent       | ✓     |                      |
| Les instructions de l'agent tiennent encore sur un écran        |       | ✓                    |

Les instructions sont la bonne forme pour le caractère propre d'un agent. Un skill est la bonne forme dès que le même comportement apparaît chez un deuxième puis un troisième agent et que garder leurs instructions au pas commence à te coûter.

## Où cela s'inscrit

Équiper est la moitié étroite des skills : la bibliothèque décide de ce qui existe et de qui le voit ; le dialogue d'agent d'un projet et les nœuds agent d'une automatisation décident où cela sert — toujours à travers la visibilité du projet ou de l'organisation elle-même. Garde les listes d'équipement courtes, préfère remplacer un bundle plutôt que le cloner, et laisse un dépôt remplacer ce que la plateforme chargerait quand un agent travaille dedans. L'autre moitié de l'histoire — écrire une `SKILL.md`, téléverser un dossier, partager un bundle — c'est la [bibliothèque de skills](/fr/platform/workspace/skills).
