---
title: Choisir une méthode d’installation
description: Installe un environnement avec la CLI Tale ou mets en œuvre l’architecture documentée avec tes propres outils d’infrastructure.
---

Utilise la CLI Tale pour une installation standard. Choisis ton propre déploiement lorsque tes outils d’infrastructure doivent gérer les définitions des services. Les deux méthodes nécessitent les mêmes services applicatifs et une personne responsable de la configuration et de la maintenance.

## Installer avec la CLI

Le [guide de démarrage](/self-hosted/install/quickstart) couvre les prérequis, la création du projet, le démarrage et la première connexion. `tale init` prépare un répertoire de projet. `tale dev` lance une instance de développement ; `tale deploy` déploie cet environnement.

La CLI gère les opérations sur les conteneurs. Tu restes responsable de la configuration, des identifiants, des volumes et des mises à jour. Conserve le répertoire du projet avec ses paramètres de déploiement. [Installer la CLI](/self-hosted/install/cli-install) décrit les systèmes pris en charge, l’accès à un hôte Docker distant, les commandes et les déploiements gérés.

## Utiliser tes propres définitions de services

[Exploiter ton propre déploiement](/self-hosted/install/own-compose) décrit les services, les volumes, le réseau, les contrôles de disponibilité et l’ordre de démarrage à respecter. Suis ce guide si tu maintiens Compose ou transposes cette architecture dans Kubernetes. Tale ne fournit pas de chart Helm officiel.

Pour modifier le code source de Tale, configure plutôt un [environnement de développement](/develop/contributor-setup).

## Terminer la configuration initiale

Une fois l’instance prête, [crée le premier compte administrateur](/self-hosted/install/first-admin), connecte un fournisseur et teste une conversation. Ajoute ensuite les utilisateurs dans [Membres et rôles](/platform/admin/members-and-roles), selon les options de compte et de connexion disponibles dans ton organisation.

Avant d’utiliser des données de production, configure TLS et les sauvegardes. Vérifie les [paramètres d’environnement](/self-hosted/configuration/environment-reference) et consulte l’[architecture d’exploitation](/self-hosted/operate/container-architecture).
