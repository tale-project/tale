---
title: Installation
description: Choisis le bon chemin d'installation de Tale — un essai sur laptop avec la CLI, une installation de production durcie sur un hôte Linux, ou la référence Docker Compose brute pour un contrôle total.
---

Installer Tale prend trois formes, et la bonne dépend de ce que tu fais du résultat. Cette page t'aiguille vers le chemin qui convient — un essai local rapide, une installation de production derrière TLS, ou la référence Compose brute quand tu veux posséder chaque bouton — pour que tu ne te lances pas dans un parcours de durcissement alors que tu voulais juste cliquer un peu.

Les trois chemins atterrissent sur le même produit ; la différence est la part de la stack que tu exploites et la durabilité dont le résultat a besoin. La CLI enveloppe Docker Compose pour les deux premiers, de sorte qu'il n'y a rien à éditer à la main, tandis que le chemin de la référence est pour les équipes qui font tourner Compose elles-mêmes.

## Essayer Tale sur un laptop

Si tu veux une instance qui tourne pour cliquer dedans — sur ta propre machine, sans domaine ni durcissement — le [démarrage rapide](/fr/self-hosted/install/quickstart) est le chemin. Installe la CLI, lance `tale init` puis `tale dev`, et tu es connecté à ta propre organisation en quelques minutes. La CLI provisionne Docker s'il manque, génère chaque secret et monte ta configuration de sorte que les édits rechargent à chaud. C'est le bon chemin pour une évaluation, une démo, ou du développement local contre une vraie stack.

Quand tu dépasses le laptop et veux le même projet sur un vrai hôte, le projet d'essai se reporte — `tale deploy` l'amène sur un domaine sans réinitialiser.

## Faire tourner Tale en production

Quand du vrai trafic atterrira sur l'instance, le parcours [Linux serveur](/fr/self-hosted/install/linux-server) est le chemin. Il couvre TLS, un pare-feu, un utilisateur non-root, le reverse proxy et les crochets opérationnels que tu veux avant de pointer un domaine dessus. La CLI fait toujours le gros du travail — `tale deploy` exécute un déploiement blue-green sans interruption avec health checks et rollback — mais ce parcours ajoute la configuration au niveau de l'hôte qu'un essai saute.

Après le premier déploiement, [Premier admin](/fr/self-hosted/install/first-admin) explique l'assistant de configuration unique qui fait du premier compte l'**Owner** — tous les suivants arrivent par invitation, donc il n'y a pas d'inscription ouverte à fermer — et [Installation de la CLI](/fr/self-hosted/install/cli-install) configure la CLI sur une workstation pour déployer et mettre à jour une instance distante.

## Posséder la couche Compose

Si tu préfères faire tourner la stack depuis un clone du dépôt et gérer Compose toi-même — pour la transparence, des builds air-gapped ou ta propre automation — la [référence Docker Compose](/fr/self-hosted/install/docker-compose-reference) est le chemin. Elle documente le fichier de base et les overlays que la CLI génère en coulisse, pour que tu puisses les reproduire ou les étendre à la main. C'est le plus de contrôle et le plus de travail ; la plupart des équipes sont mieux servies par les chemins CLI ci-dessus.

Ce chemin se marie au parcours [Linux serveur](/fr/self-hosted/install/linux-server) pour les pièces au niveau de l'hôte (TLS, pare-feu, utilisateur) que Compose seul ne couvre pas.

## Où cela s'inscrit

Les trois chemins d'installation échangent la commodité contre le contrôle : le [démarrage rapide](/fr/self-hosted/install/quickstart) est le moyen le plus rapide vers une instance qui tourne, le parcours [Linux serveur](/fr/self-hosted/install/linux-server) la durcit pour du vrai trafic, et la [référence Docker Compose](/fr/self-hosted/install/docker-compose-reference) te remet chaque bouton quand les valeurs par défaut de la CLI ne suffisent pas. Choisis selon la durabilité : un essai que tu jetteras veut le démarrage rapide ; une instance dont ton équipe dépend veut le parcours de production.

Une fois installé, les pages [Configuration](/fr/self-hosted/configuration/environment-reference) sont la source de vérité pour chaque variable d'environnement et fichier de fournisseur, et la section [Exploiter](/fr/self-hosted/operate/container-architecture) couvre les mises à jour, les sauvegardes et l'observabilité de la stack en marche.
