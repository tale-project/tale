---
title: Génération d’images
description: La génération d’images ne fait pas partie de cette version — il n’y a pas de tool generate_image, et aucun agent ne produit d’image dans sa réponse.
---

Cette page décrivait `generate_image`, un tool que n’importe quel agent pouvait recevoir pour produire une image dans le fil de sa réponse. Ni le tool ni une autorisation par agent n’existent dans cette version de Tale : les outils de l’assistant de chat sont fixes et ne produisent que du texte, et aucun modèle d’image n’est branché sur une réponse. La page reste pour que l’absence soit documentée plutôt que découverte.

<Note>

La génération d’images n’est pas disponible dans cette version. Demander à l’assistant de dessiner ou de concevoir quelque chose renvoie du texte, pas une image.

</Note>

## Ce que tu peux faire avec des images aujourd’hui

Les images voyagent comme des fichiers. Attache-les à une tâche — la fiche de tâche accepte images et documents par glisser ou coller — et un agent de projet qui travaille cette tâche les trouve parmi ses fichiers d’entrée. Les documents que tu téléverses dans la [Base de connaissances](/fr/platform/knowledge/overview) sont indexés pour la recherche, et les livrables qu’un agent de projet produit atterrissent sur la tâche pour relecture ; [Automatisation des tâches](/fr/platform/projects/task-automation) couvre cette boucle.

Quels modèles ton organisation peut utiliser est une décision de [Fournisseurs](/fr/platform/admin/providers), prise sous **Paramètres > Fournisseurs IA** ; un modèle capable de traiter des images dans cette liste n’ajoute pas d’outil de dessin au chat.

## Où cela se place

Générer des images n’est pas une capacité que cette version offre, donc aucun agent, aucune politique et aucun budget n’a à en tenir compte. Quand ton flux de travail a besoin d’une image, traite-la comme n’importe quel fichier : attache-la à la tâche et relis-la là.
