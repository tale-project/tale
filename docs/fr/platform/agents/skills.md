---
title: Skills d’agent
description: Un skill est un bundle réutilisable — un SKILL.md plus des scripts et références optionnels — que les agents lisent à l’exécution. Cette page couvre quand y recourir plutôt qu’allonger les instructions.
---

Un skill est l’unité vers laquelle Tale se tourne quand le même motif apparaît sur plusieurs agents. C’est un bundle réutilisable — un `SKILL.md` avec des instructions, plus des scripts, références et assets optionnels — qui vit dans la bibliothèque de skills de l’organisation et que les agents lisent à l’exécution. Lie le même skill à trois agents et tu maintiens le comportement à un seul endroit.

Cette page te donne le modèle mental pour savoir quand un skill est le bon geste et quand des instructions inline le sont. Lis-la avant de téléverser ton premier skill ; reviens-y quand les instructions d’un agent s’allongent et que tu te demandes s’il faut les scinder.

## Ce qu’un skill embarque

Un skill se téléverse comme un zip avec `SKILL.md` à la racine. Le frontmatter du fichier porte les métadonnées — description, licence, versions Python ou Node recommandées — et le corps porte les instructions. Les assets du bundle vivent sous `scripts/`, `references/` ou `assets/` : du code que l’agent peut exécuter quand il travaille dans une sandbox, et du matériel de référence qu’il lit à la demande.

Un skill fait d’instructions pures est la bonne forme quand le comportement est une voix ou une contrainte — « cite toujours la source par numéro de section », « refuse les questions hors de ce produit ». Un skill avec scripts est la bonne forme quand le comportement est un calcul, une transformation ou une tâche en plusieurs étapes que le modèle devrait sinon improviser en tokens.

## Lier un skill à un agent

Un skill devient visible pour un agent en le liant sur l’onglet **Skills** de l’agent — **Skills liés** liste la bibliothèque de l’organisation avec une case par skill. Un agent peut lier au plus dix skills, et un agent sans aucun lien n’en voit aucun : il n’y a pas de repli implicite vers une visibilité à l’échelle de l’organisation. L’agent lit un skill lié à l’exécution — la description lui dit quand le skill s’applique, et il tire alors le corps et les fichiers du bundle.

Le lien est par agent : deux agents peuvent lier le même skill, et délier est symétrique — la requête suivante tourne sans lui.

## Gérer la bibliothèque

Gérer les skills demande les permissions Admin ou Développeur. La bibliothèque vit dans les réglages Skills de l’organisation, où chaque skill montre son aperçu, le corps de ses instructions, l’arborescence de son bundle et une piste d’audit **Modifications récentes**. **Téléverser un skill** ajoute un nouveau bundle, **Remplacer le bundle** écrase l’existant en place, et **Dupliquer** le clone sous un nouveau slug.

<Warning>

Il n’y a pas d’épinglage de version : remplacer un bundle change ce que chaque agent lié lit dès la requête suivante, et supprimer un skill retire le bundle du disque — tout agent encore lié perd l’accès.

</Warning>

## Quand y recourir

| Utilise … quand                                                      | Skill | Instructions inline |
| -------------------------------------------------------------------- | ----- | ------------------- |
| Le motif se répète sur plusieurs agents                              | ✓     |                     |
| Le comportement passe par des scripts que le modèle imiterait sinon  | ✓     |                     |
| Le comportement est la voix d’un seul agent                          |       | ✓                   |
| Tu veux que l’organisation gouverne le comportement en un seul geste | ✓     |                     |
| Les instructions de l’agent tiennent encore sur un écran             |       | ✓                   |

Les instructions inline sont la bonne forme pour un agent. Les skills sont la bonne forme quand le même comportement revient dans deux ou trois agents et que le coût de garder leurs instructions inline synchronisées commence à peser.

## Construis-en un

Les skills sont le niveau d’abstraction au-dessus des quatre boutons — ils te laissent livrer un comportement une fois et laisser chaque agent qui en a besoin le récupérer en le liant. La marche suivante naturelle est [Construire un outil personnalisé](/fr/tutorials/developer/build-a-custom-tool) — elle va d’une page blanche à un skill avec scripts lié à un agent.
