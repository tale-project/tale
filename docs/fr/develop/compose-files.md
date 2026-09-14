---
title: Fichiers Compose pour contribuer
description: Choisir un mode de développement et comprendre les fichiers Compose complémentaires du dépôt.
---
Utilise les fichiers Compose du dépôt pour développer ou tester Tale à partir du code source. Dans le parcours local habituel, [l’application et le backend tournent sur la machine, avec leurs dépendances dans Docker](/develop/contributor-setup). Choisis le parcours ci-dessous pour tester les images de développement elles-mêmes.

Les installations auto-hébergées utilisent le déploiement généré par la CLI, décrit dans le [démarrage rapide](/self-hosted/install/quickstart). Les fichiers du dépôt contiennent des ports et des montages de développement. Examine-les avant d’exposer un hôte publiquement.

## Démarrer le développement en conteneurs

Depuis la racine du dépôt, utilise la version de Bun prévue et Docker Compose :

```bash
bun install
bun run docker:dev
bun run docker:dev:logs
```

`docker:dev` prépare l’image et le réseau de la sandbox, génère un complément d’environnement et démarre ensemble les configurations de base, de développement et de documentation. Utilise cette commande plutôt que de copier uniquement son dernier appel Compose : la préparation fait partie du parcours. Le complément généré transmet la plupart des variables de l’hôte au conteneur de la plateforme. Vérifie donc l’environnement depuis lequel tu le lances.

`Ctrl-C` arrête le suivi des journaux. `bun run docker:dev:down` arrête ce déploiement. Conserve les volumes de données et l’environnement existant pour reprendre avec la même instance. Un second worktree a besoin de ports, de noms de conteneurs et de stockage distincts pour fonctionner indépendamment.

## Choisir un fichier complémentaire

| Fichier | Fonction |
| --- | --- |
| `compose.yml` | Services de base construits depuis le code et leurs dépendances. |
| `compose.dev.yml` | Montages du code et commandes de développement. |
| `compose.docs.yml` | Site de documentation et routage du proxy. |
| `compose.web.yml` | Site marketing et routage du proxy. |
| `compose.test.yml` | Configuration des tests de conteneur de la plateforme. |
| `compose.docs.test.yml` | Configuration des tests de conteneur de la documentation. |
| `compose.web.test.yml` | Configuration des tests de conteneur du site marketing. |
| `compose.test.mock.yml` | Configuration d’intégration avec services simulés. |

Lis le script qui utilise un fichier de test avant de l’appeler directement : il peut préparer les images, les ports et les données de test. [Contribuer à Docker](/develop/contributing-docker) décrit les contrôles adaptés.

## Examiner la fusion Compose

Les fichiers s’appliquent de gauche à droite. Selon les règles de fusion de Compose, les suivants remplacent ou complètent la configuration précédente. Affiche les noms des services sans imprimer l’environnement résolu et ses secrets :

```bash
docker compose -f compose.yml -f compose.dev.yml -f compose.docs.yml config --services
```

Cette commande examine les fichiers statiques. `docker:dev` ajoute aussi son complément d’environnement généré. Une sortie complète de `docker compose config` peut contenir des identifiants interpolés ; garde-la hors des journaux publics et des rapports de bug.

## Comprendre les principaux services

Le déploiement du dépôt sépare `backend-api` et `backend-worker`. L’API traite les requêtes et l’authentification ; le processus de traitement exécute les tâches, les appels de modèles et le traitement des connaissances. `platform` sert l’application web. `proxy` dirige le trafic ; `db`, `knowledge-db` et `object-store` stockent les données applicatives, les connaissances et les fichiers.

`sandbox`, `sandbox-egress` et `sandbox-llm-gateway` fournissent l’exécution isolée et ses accès réseau et modèles. Le dépôt comprend aussi le service auxiliaire d’import vidéo. La topologie de production peut différer : le déploiement généré pour un seul hôte combine les bases applicative et de connaissances. Consulte [Architecture des conteneurs](/self-hosted/operate/container-architecture) pour les responsabilités et la [référence d’environnement](/self-hosted/configuration/environment-reference) pour leur configuration.

## Comprendre le premier échec

Si la préparation échoue, lis d’abord la première erreur du script. Pour une erreur d’image, vérifie Docker et la construction ; pour un réseau sandbox absent, sa création ; pour un second checkout, les ports occupés et les conteneurs existants. Consulte `docker compose ps` et les journaux du service avant de modifier sa configuration. Ne supprime pas les volumes pour résoudre un problème de démarrage : tu perdrais l’état nécessaire pour le reproduire.
