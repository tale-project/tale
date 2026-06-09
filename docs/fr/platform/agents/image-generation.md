---
title: Génération d'images
description: La génération d'images comme capacité d'agent — n'importe quel assistant peut créer une image en ligne quand un modèle d'image est configuré, comment les images générées apparaissent, et ce qu'elles coûtent.
---

N'importe quel assistant dans Tale peut générer des images. Demande-lui de créer, dessiner ou concevoir quelque chose et il produit l'image en ligne — comme une pièce jointe s'affiche dans la réponse, sans mode séparé dans lequel basculer d'abord. Cela fonctionne dès qu'un modèle de génération d'images est configuré ; cette page couvre le câblage.

Le mécanisme dépend du fournisseur sous-jacent — qualité, coût et vitesse varient grandement. Le travail de Tale est d'exposer la capacité à l'agent et à l'utilisateur ; le travail du fournisseur est de fabriquer l'image.

## Demander une image à n'importe quel assistant

Chaque assistant porte un outil d'image qu'il sollicite quand tu lui demandes de créer une image, un logo ou une illustration. L'assistant appelle l'outil, l'image s'affiche en ligne, et son texte s'enroule autour du résultat comme autour d'une pièce jointe téléversée. Comme l'outil est livré avec chaque assistant, l'assistant **Auto** traite aussi une demande d'image — tu n'as pas à choisir d'abord un agent spécialisé.

L'image provient du modèle de génération d'images de l'organisation — celui qu'un admin a configuré dans [Providers](/fr/platform/admin/providers) et tagué **Image generation**. Il n'y a rien à configurer par agent. Si l'organisation n'a pas un tel modèle, l'assistant te dit que la génération d'images est indisponible au lieu de deviner, pour qu'un admin sache en ajouter un.

## Comment ça apparaît

Quand l'agent génère une image, la réponse affiche l'image en ligne à côté du texte de l'agent. Au survol, une petite puce **Aperçu d'image** apparaît ; cliquer ouvre l'aperçu en pleine taille avec les contrôles **Image précédente** et **Image suivante** si la réponse a produit plus d'une. L'image est stockée dans le stockage objet du chat à côté des pièces jointes et hérite des règles de rétention du chat.

## Coût et budget

Les modèles d'images coûtent plus par appel que les modèles texte — parfois dix fois plus. Les [Politiques et limites](/fr/platform/admin/governance/policies-and-limits) de l'organisation peuvent plafonner le coût image par utilisateur, par équipe ou par agent ; atteindre le plafond apparaît comme un toast et l'image échoue au rendu. Le coût est visible dans [Analytique d'utilisation](/fr/platform/admin/governance/usage-analytics) sous la même table Top Models que les modèles texte.

## Où ça s'inscrit

La génération d'images repose sur une seule chose — un modèle tagué **Image generation** dans l'organisation — et de là, chaque assistant peut produire une image en ligne, l'assistant **Auto** compris. Le candidat à la dérive ici est le nom des fournisseurs et modèles ; consulte cette page avec la liste des modèles en cours dans [Providers](/fr/platform/admin/providers) plutôt que de mémoriser des chaînes de modèles précises.
