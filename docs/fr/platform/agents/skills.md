---
title: Les skills sur les agents
description: Comment un skill de la bibliothèque atteint une conversation ou un agent — le menu d'équipement du chat, la commande / pour un message, les agents de projet, et quelle visibilité compte où.
---

Un chat ou un agent n'atteint un skill que s'il est équipé — et l'équipement se choisit dans la [bibliothèque de skills](/fr/platform/workspace/skills) de l'organisation. Cette page parle des surfaces qui y puisent : le composer du chat, la commande `/` et les agents d'un projet. Une seule règle décide de ce que chaque surface peut choisir : **dans un chat, c'est ta visibilité qui compte ; dans un projet, celle du projet lui-même.**

## Ce que décide l'équipement

Un skill équipé est proposé au modèle par sa description. Quand le modèle juge cette description pertinente pour ta demande, il lit le corps de la `SKILL.md`, puis ouvre les fichiers du bundle là où le corps pointe vers eux. Rien n'est exécuté et rien n'est collé d'avance — un skill ne coûte du contexte que sur les tours où le modèle va réellement le chercher.

Un bundle dont le frontmatter porte `disable-model-invocation: true` se comporte autrement. Il reste équipé et lisible, mais le modèle ne doit pas y aller de lui-même ; il attend un tour où quelqu'un le nomme.

Le `usage-mode` d'un skill décide quelles surfaces le proposent : `chat` le réserve aux conversations (le menu d'équipement et la commande `/`), `agent` aux agents et automatisations, et `all` — le défaut — le propose partout.

## Équiper une conversation

Le menu d'équipement à côté du sélecteur de modèle du composer liste chaque skill utilisable en chat que tu vois, à côté des connecteurs activés. Ce que tu coches là est l'équipement de la conversation : il est chargé dans la session de l'agent et reste équipé pour tout le fil.

Parce qu'un chat est à toi, la liste suit **ta** visibilité — tes skills privés, ceux de tes équipes et ceux de l'organisation. Un skill que tu perds de vue (repartagé, supprimé) cesse simplement de se charger à ton tour suivant.

## Invoquer un skill pour un message

Tape `/` comme premier caractère du message, et le composer propose les skills utilisables en chat que tu vois ; continue à taper pour affiner, flèches pour bouger, Entrée pour compléter. Un message comme

```text
/release-notes tout ce qui a été mergé depuis mardi
```

invoque ce skill-là pour ce message-là : le bundle est chargé pour le tour, le modèle doit le lire d'abord et traiter le reste du message comme ses arguments — l'équipement enregistré de la conversation n'est pas touché. Un `/quelque-chose` qui ne correspond à aucun skill que tu peux utiliser en chat part comme du texte ordinaire. Ce passage en clair est la porte de sortie : il n'y a rien à échapper.

## Équiper les agents d'un projet

Un [agent de projet](/fr/platform/agents/create) porte son propre équipement, choisi dans le même menu d'équipement du dialogue de l'agent. La liste y suit la visibilité du **projet**, pas la tienne : les skills de toute l'organisation, plus les skills d'équipe partagés avec l'une des équipes du projet. Un projet ouvert à toute l'organisation ne voit que les skills d'organisation, et les skills privés n'apparaissent jamais — un agent de projet tourne pour chaque membre du projet, son équipement ne doit donc jamais embarquer quelque chose que seule son autrice pouvait voir.

La même règle tient à l'exécution. Un run de tâche charge les skills de l'agent en tant que projet ; une automatisation au niveau de l'organisation charge en tant qu'organisation. Un skill qui devient invisible pour ce périmètre fait échouer le run en le nommant, plutôt que de tourner sans lui en silence — un équipement choisi qui manque sans bruit est pire qu'un run raté.

## Les skills dans une session sandbox

Quand un tour s'exécute dans une sandbox, les bundles équipés n'arrivent pas par un appel d'outil. Ils sont chargés dans la session comme des fichiers, dans la disposition que le runtime sait déjà découvrir : l'agent tiers les trouve comme il trouverait un skill sur n'importe quelle machine où il travaille.

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

Équiper est la moitié étroite des skills : la bibliothèque décide de ce qui existe et de qui le voit ; le menu du chat, la commande `/` et le dialogue d'agent d'un projet décident où cela sert — chacun à travers sa propre visibilité. Garde les listes d'équipement courtes, préfère remplacer un bundle plutôt que le cloner, et laisse un dépôt remplacer ce que la plateforme chargerait quand un agent travaille dedans. L'autre moitié de l'histoire — écrire une `SKILL.md`, téléverser un dossier, partager un bundle — c'est la [bibliothèque de skills](/fr/platform/workspace/skills).
