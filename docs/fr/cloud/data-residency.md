---
title: Comprendre la résidence des données Cloud
description: Distinguer le stockage des flux vers les fournisseurs et les connecteurs avant de choisir un déploiement Cloud.
---

La résidence des données concerne leur stockage et leur traitement. Choisir une région Cloud définit l’emplacement du service hébergé, mais ne détermine pas à lui seul où chaque fournisseur de modèles ou service connecté traite tes données.

## Confirmer l’hébergement

Avant la configuration, confirme avec Tale la région principale, les emplacements de sauvegarde, la conservation, les objectifs de reprise et le processus d’assistance. Le contrat de service et les accords de traitement précisent les engagements de ton déploiement. Un libellé de région dans le produit ne permet pas de déduire une ville de sauvegarde ni une garantie de reprise.

Tale exploite le service Cloud. Les fichiers de configuration, les identifiants de base de données et les variables d’environnement de l’hôte relèvent de l’opérateur. La [référence d’auto-hébergement](/fr/self-hosted/configuration/data-residency) explique ce modèle technique.

## Suivre les données d’une requête

Un message de chat arrive sur ton instance Tale. Quand l’assistant utilise les connaissances, il récupère les contenus pertinents dans le stockage de l’organisation. Le message et le contexte sélectionné sont ensuite envoyés au fournisseur du modèle utilisé pour la réponse. Un outil peut contacter un autre service, comme un site web ou une application connectée.

| Flux de données | Point à vérifier |
| --- | --- |
| Chats, documents et configuration stockés | Emplacements d’hébergement et de sauvegarde convenus |
| Indexation des connaissances | Fournisseur d’embeddings qui reçoit les documents |
| Inférence du modèle | Point d’accès, conditions de traitement et conservation du fournisseur |
| Connecteurs et outils web | Systèmes externes qui reçoivent requêtes et contenus |
| Données d’exploitation | Traitement convenu des journaux, sauvegardes et accès d’assistance |

Un fournisseur peut proposer des points d’accès régionaux ou locaux. Vérifie celui qui est configuré : son nom commercial ne suffit pas à établir le lieu du traitement.

<Tip>

Vérifie le fournisseur d’embeddings en plus du modèle de chat. Un document peut lui être envoyé pendant l’indexation, avant même qu’une question soit posée à son sujet.

</Tip>

## Examiner une nouvelle intégration

Avant de connecter un service, identifie les données envoyées par la tâche prévue et le compte utilisé par le connecteur. Vérifie les conditions de traitement, limite les accès et teste avec des exemples non sensibles. Consigne la décision dans ta [revue de sécurité](/fr/cloud/trust-and-compliance).

## Changer de région

Organise le changement avec Tale. Le plan de migration doit couvrir les données stockées, les sauvegardes, les points d’accès externes, l’interruption et la validation. Créer une deuxième organisation ne déplace pas les données de la première.

Le [guide de préparation d’une migration](/fr/cloud/migrate-to-self-hosted) présente des questions et des vérifications utiles aussi pour un déplacement entre régions Cloud.
