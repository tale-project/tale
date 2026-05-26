---
title: Volet Canevas
description: Quand le volet Canvas s'ouvre, ce qui obtient un Canvas plutôt qu'un rendu en ligne, et comment le contenu du Canvas reste avec le chat entre les visites.
---

Le **Canvas** est un second volet qui s'ouvre à droite du thread de chat. Il apparaît quand la réponse contient un contenu que le thread linéaire ne peut pas bien tenir — un long bloc de code, un diagramme Mermaid, un document structuré, un script Python exécutable. Les réponses en ligne restent courtes et lisibles ; tout le reste s'écarte.

Le Canvas n'est pas une zone documentaire séparée ou un composer plus riche. C'est une destination de rendu — l'agent décide de ce qui y va en fonction de la forme de sa sortie, et l'utilisateur le voit sans avoir à demander.

## Ce qu'est le Canvas

Le Canvas s'ouvre automatiquement la première fois qu'une réponse produit du contenu digne du Canvas. Le thread garde un petit renvoi (« Source », « Aperçu ») à l'endroit de la conversation où le contenu du Canvas a été généré ; le volet de droite tient le contenu réel. Bascule entre **Source** et **Aperçu** en haut du Canvas pour lire le code brut ou voir le résultat rendu ; **Télécharger** sauvegarde le contenu actuel du Canvas dans un fichier.

## Quand il s'ouvre automatiquement

Le Canvas s'ouvre pour plusieurs types de rendu que le thread en ligne encombrerait : **Code** (n'importe quel langage), **HTML**, diagrammes **Mermaid**, **SVG**, longs documents **Markdown** que l'agent a produits, et scripts exécutables — **Python (sandbox)**, **Node (sandbox)**, **Script (sandbox)**. Les sorties de Run code atterrissent dans le Canvas à côté du script, donc un seul volet montre code et résultat. Les courts extraits que le thread en ligne peut tenir ne déclenchent pas le Canvas — le seuil est approximatif mais cohérent entre les types.

## Éditer dans le Canvas

Le Canvas est une surface de rendu pour ce que l'agent a produit. Éditer le contenu rendu signifie demander à l'agent une révision — un message de suivi dans le thread (« passe le timeout à 30 secondes », « rends le diagramme horizontal ») déclenche une nouvelle génération qui remplace le contenu du Canvas. Il n'y a pas de mode édition directe ; l'agent possède ce qui est dans le Canvas.

## Persistance entre les visites du chat

Le contenu du Canvas fait partie du chat, pas d'un fichier séparé. Rouvrir le chat plus tard rouvre le Canvas avec le contenu le plus récent ; passer à un autre chat ferme le volet Canvas jusqu'à ce que ce chat produise ou porte du contenu Canvas à lui. Partager le chat avec **Partager le chat** emporte le Canvas avec — le visiteur voit le même bascule Source / Aperçu, en lecture seule.

## Où ça s'inscrit

Le Canvas est la réponse à « que se passe-t-il quand la réponse est trop grosse pour le thread ». Il se compose avec tout le reste du Chat — agents, pièces jointes, voix, chats partagés — sans que ces fonctionnalités aient besoin de le savoir. Lecture parfois utile ensuite : [Construire un outil personnalisé](/fr/tutorials/developer/build-a-custom-tool) parcourt de bout en bout, sur une instance neuve, un agent qui produit du Python exécutable dans le Canvas.
