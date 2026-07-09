---
title: Génération d’images
description: La génération d’images comme capacité d’agent — des images inline dans la réponse de n’importe quel assistant, l’outil Générer une image, le type d’agent dédié à l’image, et leur coût.
---

N’importe quel assistant dans Tale peut générer des images. Demande-lui de créer, dessiner ou concevoir quelque chose et il produit l’image inline, comme une pièce jointe s’affiche dans la réponse — il n’y a aucun mode séparé à activer d’abord. Cela fonctionne dès que l’espace de travail a un modèle de génération d’images configuré ; cette page couvre le câblage.

La mécanique dépend du fournisseur sous-jacent — qualité, coût et vitesse varient largement. Le travail de Tale est d’exposer la capacité à l’agent et à l’utilisateur ; celui du fournisseur, de fabriquer l’image.

## Demander une image à n’importe quel assistant

Chaque assistant porte un outil d’image qu’il saisit quand tu lui demandes de créer une image, un logo ou une illustration. L’assistant appelle l’outil, l’image s’affiche inline, et son texte s’enroule autour du résultat comme il le ferait autour d’une pièce jointe téléversée. Parce que l’outil est livré avec chaque assistant, l’assistant **Auto** prend aussi en charge une demande d’image — tu n’as pas à choisir d’abord un agent spécialisé.

L’image vient du modèle de génération d’images de l’espace de travail — celui qu’un admin a mis en place sous [Fournisseurs](/fr/platform/admin/providers) et étiqueté **Génération d'images**. Il n’y a rien à configurer par agent. Quand l’espace de travail n’a pas de tel modèle, l’assistant te dit que la génération d’images est indisponible au lieu de deviner, pour qu’un admin sache qu’il faut en ajouter un.

## Les surfaces d’image dédiées

Deux formes plus lourdes existent au-delà de l’outil inline. Dans l’éditeur d’agent, l’outil lui-même est **Générer une image** sous la catégorie **Images** de l’onglet Outils — décoche-le pour un agent qui ne doit jamais produire d’images. Et le type d’un agent (sur l’onglet **Général**) peut être réglé sur **Génération d'images**, ce qui route chaque message droit vers un modèle d’image — la forme derrière l’agent **Créateur d'images** du catalogue, qui génère et retouche des images à partir de prompts texte. Va vers le type dédié quand tout le travail de l’agent est l’imagerie ; laisse l’outil inline à tous les autres.

## Comment ça s’affiche

Quand l’agent génère une image, la réponse l’affiche inline à côté de son texte. Survoler montre une petite pastille **Aperçu de l'image** ; cliquer ouvre l’aperçu en taille réelle avec les contrôles **Image précédente** et **Image suivante** si la réponse en a produit plusieurs. L’image est stockée dans le magasin d’objets du chat, à côté des pièces jointes, et hérite des règles de rétention du chat.

## Coût et budget

Les modèles d’image coûtent plus cher par appel que les modèles de texte — parfois dix fois plus. Les [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) de l’organisation peuvent plafonner le coût d’image par utilisateur, par équipe ou par agent ; atteindre le plafond se manifeste par un toast et l’image ne s’affiche pas. Le coût est visible dans les [analyses d’utilisation](/fr/platform/admin/governance/usage-analytics), dans le même tableau Top Models que les modèles de texte.

## Où ça se situe

La génération d’images repose sur une seule chose — un modèle étiqueté **Génération d'images** dans l’espace de travail — et à partir de là chaque assistant peut produire une image inline, l’assistant **Auto** compris. Le candidat à la dérive ici, ce sont les noms de fournisseurs et de modèles ; couple cette page avec la liste vivante des modèles sous [Fournisseurs](/fr/platform/admin/providers) plutôt que de mémoriser des chaînes de modèles précises.
