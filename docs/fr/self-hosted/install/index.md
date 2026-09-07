---
title: Installation
description: Deux façons de faire tourner Tale — la CLI, ou une stack que tu écris toi-même (Compose ou Kubernetes).
---

Installer Tale prend deux formes. La CLI enveloppe Docker Compose, tu n’édites aucun fichier. Écrire la stack toi-même est le chemin quand ce wrapper est précisément ce que tu ne peux pas faire tourner — un fichier compose, ou un mapping Kubernetes du même contrat.

## La CLI

Installe la CLI, puis `tale init` et soit `tale dev`, soit `tale deploy`. Le même répertoire de projet est l’unité : un essai sur laptop devient un hôte de production sans réinitialiser.

- [Démarrage rapide](/fr/self-hosted/install/quickstart) — `tale init`, puis `tale dev` ou `tale deploy`.
- Après le premier boot, [Premier admin](/fr/self-hosted/install/first-admin) fait du premier compte l’**Owner**. Tous les suivants arrivent par invitation.
- [Installation de la CLI](/fr/self-hosted/install/cli-install) est l’installateur et la moitié workstation distante (`DOCKER_HOST`).

## Écrire la stack toi-même

Pas de chart Helm officiel. Le contrat est le même que tu écrives Compose ou Kubernetes : quels services tiennent l’état, les noms DNS, les sondes, les volumes, et ce qu’un fichier que tu maintiens ne fait pas pour toi.

[Écrire Compose toi-même](/fr/self-hosted/install/own-compose) est cette page.

## Où cela s’inscrit

Choisis selon ce que tu acceptes d’exploiter. Le [démarrage rapide](/fr/self-hosted/install/quickstart) est le chemin CLI — laptop ou hôte de production. Le chemin compose-ou-cluster est pour l’air-gap et l’automation déjà en place.

Une fois installé, les pages [Configuration](/fr/self-hosted/configuration/environment-reference) sont chaque variable d’environnement et fichier de fournisseur, et [Exploitation](/fr/self-hosted/operate/container-architecture) couvre les montées de version, les sauvegardes et l’observabilité.
