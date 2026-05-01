---
title: Canevas
description: Visualise, édite et révise les artéfacts générés par l'IA — HTML, code, SVG, diagrammes Mermaid et Markdown — dans un panneau dédié que l'IA peut patcher en place.
---

Le canevas est un panneau latéral à côté du chat pour visualiser et éditer les **artéfacts** générés par l'IA — HTML exécutable, illustrations SVG, diagrammes Mermaid, documents Markdown ou snippets de code. Chaque artéfact existe en dehors du flux de messages et garde une identité stable sur toute la conversation, donc l'IA peut le réviser de façon incrémentale au lieu de réémettre le document entier à chaque correction.

## Cycle de vie d'un artéfact

Quand l'IA décide de produire quelque chose d'exécutable ou de révisable, elle appelle l'outil `artifact_create`. Le nouvel artéfact :

- apparaît comme une carte dans la **barre d'artéfacts** au-dessus du chat.
- s'ouvre automatiquement dans le panneau canevas à la première création.
- diffuse son contenu en direct dans l'iframe pendant que l'IA tape.

Pour le réviser, l'IA appelle `artifact_edit` sur le même artéfact. Les petites modifications utilisent `mode: 'patch'` (blocs de recherche-remplacement) ; les grandes réécritures utilisent `mode: 'rewrite'`. Dans les deux cas, le canevas se re-rend en place — pas besoin de remonter pour trouver la dernière version.

## Types d'artéfacts pris en charge

| Type         | Aperçu                               | Édition                 | Notes                                            |
| ------------ | ------------------------------------ | ----------------------- | ------------------------------------------------ |
| **HTML**     | aperçu rendu dans une iframe sandbox | éditeur source HTML     | les scripts tournent en sandbox.                 |
| **SVG**      | graphique vectoriel rendu            | éditeur source SVG      | utilise le même moteur que HTML.                 |
| **Mermaid**  | diagramme rendu                      | éditeur DSL Mermaid     | charge la lib Mermaid à la première utilisation. |
| **Markdown** | texte riche formaté                  | éditeur source Markdown | rend avec la mise en forme Markdown standard.    |
| **Code**     | affichage avec coloration (Shiki)    | éditeur texte brut      | supporte tous les langages courants.             |

## Barre d'artéfacts

Une bande horizontale au-dessus du chat liste chaque artéfact du fil courant. Chaque carte affiche le titre, l'icône de type et la révision actuelle (`v3`, `v4`, …). Clique sur une carte pour l'ouvrir dans le canevas.

Pendant que l'IA écrit ou patche un artéfact, la carte montre un spinner et l'en-tête du canevas affiche **L'IA écrit…** ou **L'IA modifie…**.

## Actions de la barre d'outils

L'en-tête du canevas comprend :

- **bascule Modifier / Aperçu** — passe entre l'édition de la source et l'aperçu du rendu.
- **Appliquer les modifications** — enregistre tes modifications comme nouvelle révision. Apparaît seulement si tu as modifié et que l'IA n'écrit pas.
- **Copier** — copie le contenu affiché dans le presse-papiers.
- **Télécharger** — télécharge comme fichier avec l'extension adaptée (`.html`, `.mmd`, `.svg`, `.md` ou l'extension de langage du code).
- **Plein écran** — agrandit le panneau au viewport entier. Appuie sur `Échap` ou clique l'icône de réduction pour sortir.
- **Fermer le canevas** — ferme le panneau.

## Éditer et appliquer

1. Clique l'icône **crayon** pour entrer en mode édition. Le contenu actuel est chargé dans un éditeur de texte.
2. Modifie le contenu.
3. Clique l'icône **œil** pour voir le rendu.
4. Clique **Appliquer les modifications** pour valider comme nouvelle révision. L'IA voit ta version modifiée au tour suivant et peut patcher à partir de là.

Les éditions utilisateur sont enregistrées comme nouvelle révision (`editKind: 'user'`) pour que l'historique de l'artéfact montre qui a changé quoi.

## Redimensionner

Fais glisser le bord gauche du panneau pour le redimensionner. Largeur minimale : 320 px ; maximale : 900 px.
