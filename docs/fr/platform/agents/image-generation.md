---
title: Génération d'images
description: La génération d'images comme capacité d'agent — choisir un modèle tagué image, coûts, et comment les images générées apparaissent dans la réponse.
---

La génération d'images est une capacité qu'un agent obtient en choisissant un modèle tagué image. La réponse de l'agent peut inclure des images générées à côté du texte ; l'utilisateur voit l'image en ligne dans le chat comme s'affiche une pièce jointe. Cette page couvre le câblage.

Le mécanisme dépend du fournisseur sous-jacent — qualité, coût et vitesse varient grandement. Le travail de Tale est d'exposer la capacité à l'agent et à l'utilisateur ; le travail du fournisseur est de fabriquer l'image.

## Choisir le modèle

Dans l'onglet **Instructions & model** de l'agent, le sélecteur de modèles expose les modèles tagués **Image generation**. Choisis-en un comme modèle secondaire et la liste d'outils de l'agent gagne un outil de génération d'images ; l'agent peut l'invoquer pendant une réponse quand le modèle décide que l'utilisateur veut une image. Certains fournisseurs exposent **Image editing** comme tag séparé — choisis-le pour que l'agent édite une image attachée plutôt que d'en créer une à partir de rien.

## Comment ça apparaît

Quand l'agent génère une image, la réponse affiche l'image en ligne à côté du texte de l'agent. Au survol, une petite puce **Aperçu d'image** apparaît ; cliquer ouvre l'aperçu en pleine taille avec les contrôles **Image précédente** et **Image suivante** si la réponse a produit plus d'une. L'image est stockée dans le stockage objet du chat à côté des pièces jointes et hérite des règles de rétention du chat.

## Coût et budget

Les modèles d'images coûtent plus par appel que les modèles texte — parfois dix fois plus. Les [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) de l'organisation peuvent plafonner le coût image par utilisateur, par équipe ou par agent ; atteindre le plafond apparaît comme un toast et l'image échoue au rendu. Le coût est visible dans [Analytique d'utilisation](/fr/platform/admin/governance/usage-analytics) sous la même table Top Models que les modèles texte.

## Où ça s'inscrit

La génération d'images est un tag de plus sur le sélecteur de modèles — le reste de la forme de l'agent reste le même. Le candidat à la dérive ici est le nom des fournisseurs et modèles ; couple cette page avec la liste des modèles en cours dans [Providers](/fr/platform/admin/providers) plutôt que de mémoriser des chaînes de modèles précises.
