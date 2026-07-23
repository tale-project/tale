---
title: Skills d’agent
description: Lier un skill de la bibliothèque de l’organisation à un agent — la liste du tab Skills, son plafond, et le chemin d’un bundle jusqu’à une session sandbox.
---

Un agent n’atteint un skill que si tu le lui lies. La [bibliothèque de skills](/fr/platform/workspace/skills) de l’organisation contient les bundles, et le tab **Skills** d’un agent est la liste qui dit lesquels cette persona a le droit de déplier. Lie un même bundle à trois agents et le comportement reste dans un seul fichier, entretenu une seule fois.

Cette page est le versant agent des skills : ce qu’une liaison décide, où se situe le plafond, et ce qui change quand le tour s’exécute dans une sandbox. L’écriture et le partage des bundles eux-mêmes se passent dans la bibliothèque.

## Ce qu’une liaison décide

Un skill lié est proposé à l’agent par sa description. Quand le modèle juge cette description pertinente pour ce que tu as demandé, il déplie le bundle : il lit le corps de la `SKILL.md`, puis ouvre les fichiers du bundle là où le corps y renvoie. Rien n’est exécuté et rien n’est collé d’avance, si bien qu’un skill ne coûte du contexte que sur les tours où l’agent va réellement le chercher.

Un bundle dont le frontmatter porte `disable-model-invocation: true` se comporte autrement. Il reste lié et lisible, mais le modèle ne doit pas aller le chercher spontanément : il attend un tour où quelqu’un le nomme.

## Lier un skill à un agent

Ouvre l’agent, passe sur **Skills** et choisis dans la bibliothèque de l’organisation. Un compteur à côté de la liste montre ce que tu as consommé du plafond : un agent peut lier **dix skills au maximum**. Ce dix est délibéré — une liste de liaisons, c’est une autorisation stricte que quelqu’un tient à la main, et au-delà d’une poignée plus personne ne la tient.

Traite cette liste comme une autorisation, pas comme une suggestion. Un agent dont la liste est vide ne déplie aucun skill ; il n’existe aucun repli silencieux vers tout ce que l’organisation partage. La liaison se fait par agent et fonctionne dans les deux sens : deux agents peuvent lier le même bundle, et une déliaison prend effet dès la requête suivante.

<Note>

Ce que tu peux choisir se décide dans la bibliothèque et non ici : un skill `org` est proposé à toute l’organisation, un skill `private` seulement là où travaille son propriétaire. Le partage passe par le champ `visibility`, sur la page [bibliothèque de skills](/fr/platform/workspace/skills).

</Note>

## Quand le bundle change en dessous

Une liaison nomme un slug, jamais un instantané. Remplace un bundle dans la bibliothèque et tout agent qui le lie en lit la nouvelle version dès sa requête suivante — aucune version à figer, aucune liaison à refaire. C’est précisément ce qui rend un skill digne d’être extrait : une modification atteint tous les agents qui le portent.

<Warning>

Supprimer un skill retire le bundle du disque, et chaque agent lié y perd l’accès sans aucun repli. Pour changer ce qu’il dit, remplace plutôt le bundle ; ne supprime qu’après avoir vérifié quels agents le nomment encore.

</Warning>

## Les skills dans une session sandbox

Quand un tour s’exécute dans une sandbox, les bundles liés n’arrivent pas par un appel d’outil. Ils sont déposés dans la session sous forme de fichiers, dans la disposition que l’environnement d’exécution sait déjà parcourir : l’agent de code les trouve comme il trouverait un skill sur n’importe quelle machine.

Une règle tranche les collisions : le dépôt gagne. Si le dépôt cloné livre un skill sous le même slug qu’un bundle que Tale déposerait, Tale retient sa copie et la version du dépôt reste en place. Un dépôt peut donc toujours écraser ce que la plateforme apprendrait sinon à l’agent, et la session ne contient jamais deux bundles réclamant le même nom. La comparaison est exacte : un slug qui diffère d’un seul caractère est un autre skill, et les deux sont déposés.

## Skill ou instructions

| Choisis … quand                                                 | Skill | Instructions d’agent |
| --------------------------------------------------------------- | ----- | -------------------- |
| Le motif revient chez plusieurs agents                          | ✓     |                      |
| Le comportement s’accompagne de fichiers de référence           | ✓     |                      |
| Il s’agit de la voix de cet agent-là                            |       | ✓                    |
| Une seule modification doit atteindre tous ceux qui l’utilisent | ✓     |                      |
| Les instructions de l’agent tiennent encore sur un écran        |       | ✓                    |

Les instructions sont la bonne forme pour le caractère propre d’un agent. Un skill devient la bonne forme dès que le même comportement apparaît chez un deuxième puis un troisième agent et que garder leurs instructions au même niveau commence à coûter.

## Où cela se place

La liaison est la moitié étroite des skills : la bibliothèque décide de ce qui existe et de qui peut le voir, le tab **Skills** décide quelle persona a le droit de déplier quoi. Garde les listes courtes, préfère remplacer un bundle plutôt que le cloner, et laisse un dépôt écraser ce que la plateforme dépose quand un agent y travaille. L’autre moitié — écrire une `SKILL.md`, téléverser un zip, partager un bundle avec l’organisation — c’est la [bibliothèque de skills](/fr/platform/workspace/skills).
