---
title: Héberger Tale sur ton infrastructure
description: Choisis une méthode d’installation, définis les responsabilités d’exploitation et retrouve les guides de configuration et de maintenance.
kind: index
---

En hébergeant Tale, ton organisation choisit où l’application s’exécute, où les données sont stockées et quels modèles elle utilise. La plateforme open source offre les mêmes fonctionnalités que la version Enterprise. Ton équipe exploite l’infrastructure et décide quels services externes elle peut contacter.

## Choisir ton point de départ

| Ton objectif | Guide |
| --- | --- |
| Essayer une instance locale ou installer un nouvel environnement | [Démarrage de l’installation](/self-hosted/install/quickstart) |
| Comprendre les services, les données et les connexions réseau | [Vue d’ensemble de l’architecture](/self-hosted/overview) |
| Déployer avec tes propres définitions Compose ou Kubernetes | [Exploiter ton propre déploiement](/self-hosted/install/own-compose) |
| Modifier le code de l’application | [Configurer l’environnement de développement](/develop/contributor-setup) |
| Utiliser une instance déjà exploitée par une autre équipe | [Envoyer ton premier message](/get-started/quickstart) |

## Répartir les responsabilités d’exploitation

Désigne les responsables des accès, de TLS, des mises à jour, des sauvegardes, de la surveillance et des incidents avant d’ajouter des utilisateurs. Configure un fournisseur d’IA. Pour rendre les documents interrogeables, prévois aussi un modèle d’embeddings et le stockage des connaissances. Teste un téléversement et une conversation complète avant de considérer l’instance comme prête.

L’auto-hébergement ne garantit pas que toutes les requêtes restent sur ton réseau. Un fournisseur de modèles, un Connector, un robot d’exploration ou un service de surveillance externe peut recevoir des données. Vérifie les destinations réelles à l’aide du guide de [renforcement de la sécurité](/self-hosted/operate/security/hardening) et de la configuration des fournisseurs. Une installation isolée nécessite des images, modèles, identifiants et dépendances disponibles localement.

## Configurer et maintenir l’instance

La [référence des variables d’environnement](/self-hosted/configuration/environment-reference) décrit les paramètres du déploiement. Les guides de configuration couvrent ceux de l’organisation. Consulte l’[architecture des conteneurs](/self-hosted/operate/container-architecture) pour les dépendances d’exploitation et [Sauvegardes et restauration](/self-hosted/operate/backups-and-restore) pour préparer une reprise.

Si ton équipe préfère confier l’exploitation à Tale, consulte [Tale Cloud](/cloud). Les guides de la plateforme s’appliquent aux deux modes d’hébergement.
