---
title: Canevas
description: Visualise, édite et exporte le code, HTML, diagrammes et Markdown générés par l'IA dans un panneau dédié.
---

Le canevas est un panneau latéral à côté du chat, un espace de travail concentré pour voir et éditer le contenu généré par l'IA. Au lieu de faire défiler les blocs de code dans la conversation, tu les ouvres dans le canevas pour coloration syntaxique, aperçu en direct, édition et export.

## Ouvrir le canevas

Quand l'IA génère un bloc de code, un snippet HTML, un diagramme Mermaid ou un bloc Markdown, un bouton **Ouvrir dans le canevas** apparaît sur le bloc. Clique-le pour ouvrir le contenu dans le panneau canevas à droite.

## Types de contenu pris en charge

| Type         | Aperçu                               | Édition                 | Notes                                            |
| ------------ | ------------------------------------ | ----------------------- | ------------------------------------------------ |
| **Code**     | affichage avec coloration (Shiki)    | éditeur texte brut      | supporte tous les langages courants.             |
| **HTML**     | aperçu rendu dans une iframe sandbox | éditeur source HTML     | les scripts tournent en sandbox.                 |
| **SVG**      | graphique vectoriel rendu            | éditeur source SVG      | utilise le même moteur que HTML.                 |
| **Mermaid**  | diagramme rendu                      | éditeur DSL Mermaid     | charge la lib Mermaid à la première utilisation. |
| **Markdown** | texte riche formaté                  | éditeur source Markdown | rend avec la mise en forme Markdown standard.    |

## Actions de la barre d'outils

L'en-tête du canevas comprend :

- **bascule Modifier / Aperçu** — passe entre l'édition de la source et l'aperçu du rendu.
- **Appliquer les modifications** — réécrit tes modifications dans le message source du chat. Apparaît seulement si tu as modifié.
- **Copier** — copie le contenu dans le presse-papiers.
- **Télécharger** — télécharge comme fichier avec l'extension adaptée (`.html`, `.mmd`, `.svg`, `.md` ou l'extension du code d'origine).
- **Fermer le canevas** — ferme le panneau.

## Éditer et appliquer

1. Clique l'icône **crayon** pour entrer en mode édition.
2. Modifie dans l'éditeur.
3. Clique l'icône **œil** pour voir le rendu.
4. Clique **Appliquer les modifications** pour réécrire les modifications dans le message source.

Le bouton Appliquer n'apparaît que si le contenu diffère de l'original. Un toast confirme l'application.

## Redimensionner

Fais glisser le bord gauche du panneau pour le redimensionner. Largeur minimale : 320 px ; maximale : 900 px.
