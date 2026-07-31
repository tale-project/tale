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

| Fichier                 | Cas d'usage                                     | Overrides notables                                                                      |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `compose.yml`           | Production sur un seul hôte                     | La base — chaque service, healthchecks, politique de redémarrage                        |
| `compose.dev.yml`       | Développement local avec hot-reload             | Monte les sources dans les conteneurs, bascule sur les images dev, expose des ports dev |
| `compose.docs.yml`      | Ajoute le service du site de docs               | Démarre `tale-docs` et route `/docs` à travers le proxy                                 |
| `compose.web.yml`       | Ajoute le service du site marketing             | Démarre `tale-web` et route `/` (racine) à travers le proxy                             |
| `compose.test.yml`      | Lance la suite de tests platform contre la pile | Remplace l'image platform par la variante de forme test                                 |
| `compose.web.test.yml`  | Lance les tests web                             | Comme `web.yml`, mais la variante de forme test                                         |
| `compose.docs.test.yml` | Lance les tests docs                            | Comme `docs.yml`, mais la variante de forme test                                        |
| `compose.test.mock.yml` | Tests de connector adossés à des mocks          | Remplace les fournisseurs par des implémentations mock                                  |

## Services et leurs rôles

Le graphe de base démarre huit conteneurs :

- `tale-proxy` — Caddy. TLS, reverse-proxy, redirections 301.
- `tale-platform` — l'app TanStack Start. L'UI et l'API côté utilisateur.
- `tale-convex` — le backend Convex. WebSocket, queries, mutations, actions — et la recherche RAG, l'ingestion de documents, le crawling web et la génération de documents en in-process, qui étaient autrefois des services séparés.
- `tale-db` — Postgres opérationnel (ParadeDB). Le stockage persistant du backend Convex.
- `tale-knowledge-db` — Postgres du corpus de connaissances (ParadeDB). La base `tale_knowledge` qui détient les fragments de documents, les embeddings et les pages crawlées, sur le port 5433 pour ne jamais entrer en conflit avec `tale-db` sur 5432.
- `tale-sandbox-llm-gateway` — la gateway LLM pour les tours sur harness (image externe pinnée).
- `tale-sandbox-egress` et `tale-sandbox` — le plan sandbox. Conteneurs Run-code derrière un proxy de sortie (ouvert par défaut ; verrouillable avec `SANDBOX_EGRESS_ALLOWLIST`), aussi le runtime de navigateur headless que le backend convex appelle pour le rendu web et la génération de documents.

La stack est désormais entièrement TypeScript — il n'y a pas de service Python dans le graphe. [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) creuse qui possède quoi.

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

Un service du fichier de base utilise un profil Docker Compose. Les profils permettent à un service d'exister dans le graphe mais de ne pas démarrer tant que son profil n'est pas activé. Le profil en usage est `controller` — le sidecar `tale-controller`, à activer explicitement, qui redémarre le conteneur convex sur une requête signée pour qu'un changement de résidence des données s'applique sans donner à la plateforme l'accès au socket Docker. Active-le avec :

```bash
docker compose --profile controller up -d
```

## Où ça s'inscrit

La référence compose est la grille de l'opérateur pour l'arbre source. Pour l'intérieur de chaque conteneur, la page [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) couvre les responsabilités ; pour les variables que les conteneurs lisent au démarrage, la [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) est la source de vérité.
