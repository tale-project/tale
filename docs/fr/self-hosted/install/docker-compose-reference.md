---
title: Référence Docker Compose
description: Quel fichier compose est livré avec Tale, à quoi sert chacun, et comment fonctionne la superposition quand tu démarres des combinaisons dev, docs ou test.
---

Tale livre une poignée de fichiers Docker Compose. La base est `compose.yml` ; le reste, ce sont des overlays qui ajoutent ou remplacent des services pour des scénarios précis — développement, docs, test. Cette page nomme chaque fichier, dit quand le choisir, et donne la règle de superposition à laquelle tout le reste obéit.

La forme est volontairement conservatrice. Le fichier de base tout seul tourne en production ; chaque overlay est opt-in via `-f` et n'ajoute que ce qu'il doit. Mémorise la base et un seul overlay, pas toute la grille.

## Un compose-up déroulé

Une instance de production sur un seul hôte tourne depuis la base seule :

```bash
docker compose up -d
```

Un développeur qui hacke sur platform et docs en même temps superpose deux overlays :

```bash
docker compose -f compose.yml -f compose.dev.yml -f compose.docs.yml up -d
```

Le fichier le plus à gauche est la base ; chaque fichier suivant fusionne ses clés par-dessus. Les conflits (même service, même clé) se résolvent dernier-fichier-gagne. Le graphe fusionné est ce que Docker démarre.

## Les fichiers compose

| Fichier                        | Cas d'usage                                     | Overrides notables                                                                      |
| ------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `compose.yml`                  | Production sur un seul hôte                     | La base — chaque service, healthchecks, politique de redémarrage                        |
| `compose.dev.yml`              | Développement local avec hot-reload             | Monte les sources dans les conteneurs, bascule sur les images dev, expose des ports dev |
| `compose.docs.yml`             | Ajoute le service du site de docs               | Démarre `tale-docs` et route `/docs` à travers le proxy                                 |
| `compose.web.yml`              | Ajoute le service du site marketing             | Démarre `tale-web` et route `/` (racine) à travers le proxy                             |
| `compose.test.yml`             | Lance la suite de tests platform contre la pile | Remplace l'image platform par la variante de forme test                                 |
| `compose.web.test.yml`         | Lance les tests web                             | Comme `web.yml`, mais la variante de forme test                                         |
| `compose.docs.test.yml`        | Lance les tests docs                            | Comme `docs.yml`, mais la variante de forme test                                        |
| `docker-compose.test-mock.yml` | Tests d'intégration adossés à des mocks         | Remplace les fournisseurs par des implémentations mock                                  |

## Services et leurs rôles

Le graphe de base démarre huit conteneurs :

- `tale-proxy` — Caddy. TLS, reverse-proxy, redirections 301.
- `tale-platform` — l'app TanStack Start. L'UI et l'API côté utilisateur.
- `tale-convex` — le backend Convex. WebSocket, queries, mutations, actions.
- `tale-db` — Postgres. Le stockage persistant.
- `tale-rag` — Python FastAPI. Embeddings, récupération.
- `tale-crawler` — le service crawler. Sources de connaissances web.
- `tale-sandbox-egress` et `tale-sandbox` — le plan sandbox. Conteneurs Run-code derrière une liste d'autorisations de sortie.

[Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) creuse qui possède quoi.

## Surcharges

Les personnalisations d'opérateur appartiennent à un overlay supplémentaire, pas à des édits sur les fichiers livrés. Crée un `compose.local.yml` avec les surcharges dont tu as besoin :

```yaml
services:
  platform:
    environment:
      - LOG_LEVEL=debug
```

Démarre la pile avec l'overlay local superposé en dernier :

```bash
docker compose -f compose.yml -f compose.local.yml up -d
```

Ce motif garde `git pull` propre — pas de conflits de merge sur les fichiers livrés. Le même motif fonctionne pour tout montage de volume personnalisé, port personnalisé, ou surcharge d'environnement.

## Profils

Une poignée de services dans le fichier de base utilisent des profils Docker Compose. Les profils permettent à un service d'exister dans le graphe mais de ne pas démarrer tant que son profil n'est pas activé. Les deux profils en usage sont `gpu` (pour les hôtes avec inférence locale sur GPU) et `monitoring` (pour les Prometheus et Grafana optionnels). Active avec :

```bash
docker compose --profile monitoring up -d
```

## Où ça s'inscrit

La référence compose est la grille de l'opérateur pour l'arbre source. Pour l'intérieur de chaque conteneur, la page [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) couvre les responsabilités ; pour les variables que les conteneurs lisent au démarrage, la [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) est la source de vérité.
