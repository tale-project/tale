---
title: Référence Docker Compose
description: Quel fichier compose est livré avec Tale, à quoi sert chacun, et comment fonctionne la superposition quand tu démarres des combinaisons dev, docs ou test.
---

Tale livre une poignée de fichiers Docker Compose. La base est `compose.yml` ; le reste, ce sont des overlays qui ajoutent ou remplacent des services pour des scénarios précis — développement, docs, test. Cette page nomme chaque fichier, dit quand le choisir, et donne la règle de superposition à laquelle tout le reste obéit.

La forme est volontairement conservatrice. Le fichier de base est un stack build-depuis-les-sources pour le développement local et les tests de fumée — **pas** la production ; chaque overlay est opt-in via `-f` et n'ajoute que ce qu'il doit. Une instance de production est générée et roulée par la [CLI `tale`](/fr/self-hosted/install/cli-install) (`tale deploy`), qui écrit son propre compose sécurisé en ligne — seuls `80`/`443` exposés — et n'utilise jamais ces fichiers. Mémorise la base et un seul overlay, pas toute la grille.

## Un compose-up déroulé

Le fichier de base construit chaque image depuis les sources et tourne sur ce build figé. Il expose des ports qui ne doivent jamais être publics (`5432`, `8003`) et démarre avec des secrets dev peu sûrs par défaut, donc il est pour les tests de fumée locaux, pas pour une instance publique :

```bash
docker compose up -d
```

Un développeur qui hacke sur platform et docs en même temps superpose deux overlays pour des sources en direct et le hot-reload :

```bash
docker compose -f compose.yml -f compose.dev.yml -f compose.docs.yml up -d
```

Le fichier le plus à gauche est la base ; chaque fichier suivant fusionne ses clés par-dessus. Les conflits (même service, même clé) se résolvent dernier-fichier-gagne. Le graphe fusionné est ce que Docker démarre.

## Les fichiers compose

| Fichier                 | Cas d'usage                                     | Overrides notables                                                                   |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| `compose.yml`           | Base de dev locale (build depuis les sources)   | La base — chaque service, healthchecks, politique de redémarrage                     |
| `compose.dev.yml`       | Développement local avec hot-reload             | Bind-monte les sources de l'hôte pour le hot-reload ; livre des secrets dev peu sûrs |
| `compose.docs.yml`      | Ajoute le service du site de docs               | Démarre `tale-docs` et route `/docs` à travers le proxy                              |
| `compose.web.yml`       | Ajoute le service du site marketing             | Démarre `tale-web` et route `/` (racine) à travers le proxy                          |
| `compose.test.yml`      | Lance la suite de tests platform contre la pile | Remplace l'image platform par la variante de forme test                              |
| `compose.web.test.yml`  | Lance les tests web                             | Comme `web.yml`, mais la variante de forme test                                      |
| `compose.docs.test.yml` | Lance les tests docs                            | Comme `docs.yml`, mais la variante de forme test                                     |
| `compose.test.mock.yml` | Tests de connector adossés à des mocks          | Remplace les fournisseurs par des implémentations mock                               |

## Services et leurs rôles

Le graphe de base démarre onze conteneurs :

- `tale-proxy` — Caddy. TLS, reverse-proxy, redirections 301.
- `tale-platform` — le tier web : une SPA Vite + TanStack Router avec le serveur Bun qui la sert, le branding et la surveillance SSE de config.
- `tale-backend-api` — le backend applicatif dans le rôle `api` (`TALE_ROLE=api`). Chaque porte applicative : l'API de l'app, l'auth, le flux SSE de hints et les portes machine.
- `tale-backend-worker` — la même image dans le rôle `worker`. L'exécuteur de jobs derrière les schedules et les tours d'agent, ainsi que l'ingestion de documents, le crawling web, l'indexation RAG et la génération de documents en in-process, qui étaient autrefois des services séparés.
- `tale-db` — Postgres opérationnel (ParadeDB). Le magasin applicatif `tale_app`, sur le port 5432.
- `tale-knowledge-db` — Postgres du corpus de connaissances (ParadeDB). La base `tale_knowledge` qui détient les fragments de documents, les embeddings et les pages crawlées, sur le port 5433 pour ne jamais entrer en conflit avec `tale-db` sur 5432. (Un stack de production `tale deploy` replie ceci dans `tale-db` — voir [Aperçu de l'architecture](/fr/self-hosted/overview).)
- `tale-object-store` — MinIO, le backend de blobs compatible S3 pour les téléversements, les pièces jointes et les médias générés (purement interne).
- `tale-sandbox-llm-gateway` — la gateway LLM pour les tours sur harness.
- `tale-sandbox-egress` et `tale-sandbox` — le plan sandbox. Conteneurs Run-code derrière un proxy de sortie (ouvert par défaut ; verrouillable avec `SANDBOX_EGRESS_ALLOWLIST`), aussi le runtime de navigateur headless que le backend appelle pour le rendu web et la génération de documents.
- `tale-bgutil-provider` — un sidecar tiers fournissant les PO-tokens YouTube pour l'ingestion de liens vidéo.

Il n'y a pas de service Python séparé dans le graphe — le travail de connaissances (RAG, crawling, génération de documents) tourne maintenant dans le backend worker. [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) creuse qui possède quoi.

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

## Où ça s'inscrit

La référence compose est la grille de l'opérateur pour l'arbre source. Pour l'intérieur de chaque conteneur, la page [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) couvre les responsabilités ; pour les variables que les conteneurs lisent au démarrage, la [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) est la source de vérité.
