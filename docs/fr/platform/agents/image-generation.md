---
title: Génération d’images
description: La génération d’images est un outil accordable à n’importe quel agent — generate_image produit une image dans la réponse, sur un modèle choisi tour par tour.
---

Dans Tale, la génération d’images est un outil, pas une catégorie d’agent. Tout agent à qui `generate_image` est accordé peut produire une image dans le fil de sa réponse : demande-lui de créer, de dessiner ou de concevoir quelque chose, le modèle appelle l’outil, et l’image s’affiche dans la réponse comme le ferait une pièce jointe. Aucun mode dans lequel basculer d’abord, aucune persona spécialisée à choisir.

Cette page traite de cet outil : ce qu’il fait, comment tu l’accordes ou le retiens, comment le résultat arrive dans la conversation, et ce qu’il coûte. La mécanique en dessous appartient au fournisseur — qualité, prix et vitesse varient beaucoup d’un modèle d’image à l’autre.

## L’outil generate_image

`generate_image` prend une seule chose : un prompt décrivant l’image à produire. Ce prompt se suffit à lui-même, car le modèle d’image ne voit jamais la conversation — l’agent replie dans cette unique description tout ce que tu as dit du style, de l’ambiance, de la composition et des couleurs. Le résultat revient sous forme de fichier, s’affiche dans le fil, et le texte de l’agent s’enroule autour.

Puisque c’est un outil ordinaire, tout ce qui vaut pour le reste de la surface d’outils vaut ici. Le modèle décide quand l’appeler à partir de la liste accordée à son agent, l’appel et son résultat apparaissent dans la conversation comme n’importe quel autre appel d’outil, et un agent à qui l’outil n’a jamais été accordé ne peut pas l’atteindre.

## L’accorder ou le retenir

Ouvre l’onglet **Outils** de l’agent et accorde `generate_image` là où le travail implique des images ; laisse-le éteint pour un agent qui ne doit répondre qu’en texte. Il n’y a rien d’autre à régler — pas de paramètre image par agent, pas de persona réservée à l’image, pas de type dans lequel basculer un agent.

Le modèle derrière l’image vient du même endroit que tous les autres : celui qui envoie le message le choisit dans le composer, plutôt que l’agent n’en épingle un. Si aucun fournisseur de l’organisation ne propose de modèle capable de produire des images, tu reçois un refus net plutôt qu’une approximation — c’est le signal pour qu’un admin en ajoute un sous [Fournisseurs](/fr/platform/admin/providers).

## Comment l’image arrive dans la réponse

L’image produite s’affiche à côté du texte de l’agent et s’ouvre en grand quand tu cliques dessus. Le fichier est rangé avec les pièces jointes de la conversation et hérite des mêmes règles de conservation : une image générée est donc exactement aussi durable — et aussi supprimable — que ce que tu as toi-même téléversé dans ce fil.

Comme l’image passe par un appel d’outil, elle s’audite comme tel : le prompt réellement envoyé par le modèle est visible dans l’appel, et c’est le plus souvent le moyen le plus rapide de comprendre pourquoi une image ne ressemble pas à ce que tu imaginais.

## Coût et budget

Les modèles d’image coûtent plus cher par appel que les modèles de texte, parfois d’un ordre de grandeur. Les [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) de l’organisation plafonnent la dépense par personne, par équipe et par agent, et atteindre un plafond se traduit par un message dans la conversation plutôt que par une image. La dépense apparaît dans l’[Analytique d’usage](/fr/platform/admin/governance/usage-analytics), dans les mêmes tableaux que l’usage texte.

## Où cela se place

La génération d’images est une entrée dans une liste, et c’est tout l’intérêt : un agent qui doit dessiner reçoit `generate_image`, un agent qui ne doit pas ne le reçoit pas, et aucune partie de la persona n’a besoin d’être refaçonnée autour des images. Ce qui vieillit le plus vite ici, ce sont les noms de fournisseurs et de modèles — appuie-toi sur la liste vivante dans [Fournisseurs](/fr/platform/admin/providers) plutôt que sur des identifiants mémorisés, et sur [Outils d’agent](/fr/platform/agents/tools) pour le reste du catalogue.
