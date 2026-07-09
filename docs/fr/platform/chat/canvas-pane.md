---
title: Volet Canevas
description: Quand le volet Canevas s’ouvre, ce qui obtient un Canevas plutôt qu’un rendu en ligne, et comment le contenu du Canevas reste avec le chat entre les visites.
---

Le **Canevas** est un second volet qui s’ouvre à droite du thread de chat. Il apparaît quand la réponse contient un contenu que le thread linéaire ne peut pas bien tenir — un long bloc de code, un diagramme Mermaid, un document structuré, un script Python exécutable. Les réponses en ligne restent courtes et lisibles ; tout le reste s’écarte du chemin.

Le Canevas n’est pas un composeur plus riche, et ce n’est pas un endroit où tu édites à la main. C’est une vue vivante de l’espace de travail du chat — les fichiers que l’agent écrit, les fichiers que tu téléverses et les fichiers que les exécutions de code produisent — et tu le vois sans avoir à le demander.

## Ce qu’est le Canevas

Le Canevas s’ouvre automatiquement la première fois qu’une réponse produit du contenu digne du Canevas. Il a deux parties : à gauche une arborescence de fichiers, à droite un lecteur. L’arborescence regroupe les fichiers de l’espace de travail du chat selon leur origine — les **Fichiers IA** que l’agent a écrits (`/user/code`), les **Téléversés** que tu as joints ou épinglés avec `@` (`/user/uploads`), et la **Sortie de code** qu’une exécution a produite (`/user/output`) ; les groupes vides restent masqués. Choisis un fichier et il s’ouvre dans le lecteur, où tu bascules entre **Source** et **Aperçu** pour lire le code brut ou voir le résultat rendu, et où **Télécharger** enregistre ce fichier.

## Quand il s’ouvre automatiquement

Le Canevas s’ouvre pour plusieurs types de rendu que le thread en ligne encombrerait : **Code** (n’importe quel langage), **HTML**, diagrammes **Mermaid**, **SVG**, longs documents **Markdown** produits par l’agent, et scripts exécutables — **Python (sandbox)**, **Node (sandbox)**, **Script (sandbox)**. `run_code` s’exécute sur l’espace de travail partagé du chat — il lit les scripts que l’agent a écrits sous `/user/code` et récupère ce qu’une exécution laisse dans `/user/output`, si bien que les résultats apparaissent comme des lignes **Sortie de code** dans l’arborescence de fichiers, pas seulement à côté du script ; une exécution peut aussi se contenter d’installer des paquets comme étape distincte, en affichant **Installation des dépendances** pendant ce temps. Seuls les fichiers écrits par l’agent et les sorties de code ouvrent le Canevas automatiquement — les fichiers que tu téléverses apparaissent dans l’arborescence mais ne s’emparent pas de l’écran. Les courts extraits que le thread en ligne peut tenir ne déclenchent pas le Canevas — un script de vingt lignes s’affiche en ligne avec son propre contrôle **Copier**, comme ci-dessous.

<Frame caption="Un script court reste en ligne — le Canevas est pour la sortie qui déborde du thread.">

![Une réponse de chat contenant un bloc de code Python avec coloration syntaxique, rendu en ligne avec un bouton Copier, sans que le volet Canevas s’ouvre.](/images/platform/chat-code-reply.webp)

</Frame>

## Éditer dans le Canevas

Le Canevas est une surface de rendu pour ce que l’agent a produit. Éditer le contenu rendu revient à demander une révision à l’agent — un message de suivi dans le thread (« passe le timeout à 30 secondes », « rends le diagramme horizontal ») déclenche une nouvelle génération qui remplace le contenu du Canevas. Il n’y a pas de mode d’édition directe ; l’agent possède les fichiers qu’il écrit, et les fichiers que tu téléverses restent exactement tels que tu les as envoyés.

## Persistance entre les visites du chat

Le contenu du Canevas fait partie du chat, pas d’un fichier séparé. Rouvrir le chat plus tard rouvre le Canevas avec le contenu le plus récent ; passer à un autre chat ferme le volet Canevas jusqu’à ce que ce chat produise ou porte son propre contenu Canevas. Partager le chat avec **Partager le chat** emporte le Canevas — le visiteur voit la même bascule Source / Aperçu, en lecture seule.

## Où ça s’inscrit

Le Canevas est la réponse à « que se passe-t-il quand la réponse est trop grosse pour le thread ». Il se compose avec tout le reste du Chat — agents, pièces jointes, voix, chats partagés — sans que ces fonctionnalités aient besoin de le connaître. La lecture qui compte parfois ensuite : [Construire un outil personnalisé](/fr/tutorials/developer/build-a-custom-tool) parcourt de bout en bout, sur une instance neuve, un agent qui produit du Python exécutable dans le Canevas.
