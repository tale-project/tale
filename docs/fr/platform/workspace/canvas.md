---
title: Canevas
description: Visualise, édite et révise les artéfacts générés par l'IA — HTML, code, SVG, diagrammes Mermaid et Markdown — dans un panneau latéral que l'IA peut patcher en place d'un tour à l'autre.
---

Canevas est un panneau latéral qui s'ouvre à côté du chat pour visualiser et éditer les **artéfacts** générés par l'IA : HTML exécutable, illustrations SVG, diagrammes Mermaid, documents Markdown ou extraits de code. Chaque artéfact vit en dehors du flux de messages et garde une identité stable sur toute la conversation, donc l'IA peut le réviser de façon incrémentale au lieu de réémettre le document entier à chaque correction. Imagine un brief marketing que l'IA esquisse et que tu resserres, un diagramme que tu fais étendre, ou une petite maquette HTML qui passe par trois tours de retours — chacun se termine sur un artéfact unique, pas trois messages.

Le public, c'est toute personne dans le chat. Pas de verrou de rôle ; quiconque peut discuter peut aussi ouvrir et éditer les artéfacts qu'une conversation produit.

## Comment le cycle de vie d'un artéfact fonctionne

Quand l'IA décide de produire quelque chose d'exécutable ou de révisable, elle appelle l'outil `artifact_create`. Le nouvel artéfact apparaît comme une carte dans la barre des **Artéfacts** au-dessus du chat, s'ouvre automatiquement dans le panneau Canevas à la première création, et diffuse son contenu en direct dans le panneau pendant que l'IA tape. Pour le réviser, l'IA appelle `artifact_edit` sur la même identité — les petites modifications utilisent `mode: 'patch'` (blocs recherche-remplacement) ; les grandes réécritures utilisent `mode: 'rewrite'`. Dans les deux cas, Canevas se re-rend en place, donc tu ne remontes jamais pour trouver la dernière version.

Pendant que l'IA écrit ou patche, la carte montre un indicateur de progression et l'en-tête de Canevas affiche **L'IA écrit…** ou **L'IA modifie…**.

## Types d'artéfact pris en charge

Canevas rend cinq formes d'artéfact, chacune avec sa paire aperçu / éditeur de source :

| Type         | Aperçu                                       | Édition                 | Notes                                                     |
| ------------ | -------------------------------------------- | ----------------------- | --------------------------------------------------------- |
| **HTML**     | aperçu rendu dans une iframe sandbox         | éditeur source HTML     | Les scripts tournent en environnement sandbox.            |
| **SVG**      | graphique vectoriel rendu                    | éditeur source SVG      | Utilise le même moteur de rendu que HTML.                 |
| **Mermaid**  | diagramme rendu                              | éditeur DSL Mermaid     | La librairie Mermaid se charge à la première utilisation. |
| **Markdown** | texte riche formaté                          | éditeur source Markdown | Rendu avec la mise en forme Markdown standard.            |
| **Code**     | affichage avec coloration syntaxique (Shiki) | éditeur texte brut      | Prend en charge les langages de programmation courants.   |

## La barre des Artéfacts

Une bande horizontale au-dessus du chat liste chaque artéfact du fil courant. Chaque carte affiche le titre, une icône de type et la révision actuelle (`v3`, `v4`, …). Clique sur une carte pour l'ouvrir dans Canevas. Les cartes restent visibles sur toute la conversation, donc un artéfact créé douze messages plus tôt est à un clic.

## Actions de la barre d'outils

L'en-tête de Canevas porte les actions qui s'appliquent à l'artéfact ouvert. **Modifier** bascule le panneau en éditeur de source ; clique sur **Aperçu** (la même bascule) pour revenir à la sortie rendue. **Appliquer les modifications** valide tes modifications comme nouvelle révision — le bouton apparaît dès que tu as modifié et que l'IA n'est pas en train d'écrire. **Copier** copie le contenu affiché dans le presse-papiers. **Télécharger** sauvegarde le contenu comme fichier avec l'extension adaptée (`.html`, `.mmd`, `.svg`, `.md` ou l'extension du langage pour le code). **Plein écran** étend le panneau au viewport entier ; `Échap` ou l'icône de réduction le ramène à la taille ancrée. **Fermer le canevas** ferme le panneau.

## Modifier et appliquer

Pour modifier l'artéfact à la main au lieu de demander à l'IA, clique sur l'icône crayon — le contenu validé se charge dans un éditeur de source. Fais les modifications, clique sur l'icône œil pour prévisualiser, et sur **Appliquer les modifications** pour les valider comme nouvelle révision. Tes modifications sont enregistrées avec `editKind: 'user'` dans l'historique, donc le journal des révisions de l'artéfact montre qui a changé quoi.

L'IA voit ta version modifiée au tour suivant et patche à partir de là. C'est la boucle autour de laquelle le panneau Canevas est construit — un dialogue rapide, sur place, entre toi et l'IA, sur un document persistant.

## Redimensionner et mise en page

Fais glisser le bord gauche du panneau Canevas pour le redimensionner. Le panneau a une largeur minimale de 320 pixels et une maximale de 900 pixels, donc la colonne de chat n'est jamais poussée hors écran.

## Où ça s'inscrit

Canevas est l'atelier pour les artéfacts générés par l'IA. Le chat, c'est là où tu demandes ; Canevas, c'est là où la sortie structurée de l'IA — une maquette HTML, un diagramme Mermaid, un brief Markdown, un extrait de code — prend sa forme persistante. Sans Canevas, chaque révision réémettrait le document entier dans le flux de chat ; avec Canevas, l'artéfact a une identité stable que l'IA peut patcher en place d'un tour à l'autre.

Pour déclencher un artéfact, demande à l'IA quelque chose que Canevas sait rendre — un graphique, un diagramme, une petite page HTML, un document Markdown. Pour réviser un artéfact toi-même, ouvre l'éditeur de source et clique sur **Appliquer les modifications** ; l'IA reprend tes modifications au tour suivant et patche à partir de là.
