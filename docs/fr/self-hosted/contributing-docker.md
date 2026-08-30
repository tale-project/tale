---
title: Contribuer aux images Docker
description: Comment construire et étendre les images Docker de Tale pour des forks, des builds vendorisés ou des distributions air-gapped.
---

Chaque conteneur que Tale ship a son Dockerfile dans le repo source public. Les forks, distributions air-gapped et patches one-off partent tous des mêmes fichiers ; cette page est le walk opérateur à travers la construction des images toi-même, où les coutures de personnalisation vivent, et comment garder un fork en sync avec l'amont sans diverger sur les parties ennuyeuses.

L'architecture des conteneurs vit dans [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) ; cette page est ce que tu lis quand les images publiées ne vont pas et qu'il te faut construire les tiennes.

## Quelles sont les images

La stack est entièrement TypeScript — pas d'image Python. Chaque image a un Dockerfile sous `services/<name>/` :

| Image                    | Chemin source                 | Base                         |
| ------------------------ | ----------------------------- | ---------------------------- |
| `tale-proxy`             | `services/proxy/`             | Caddy                        |
| `tale-platform`          | `services/platform/`          | Bun + Debian slim            |
| `tale-convex`            | `services/convex/`            | Convex local-backend         |
| `tale-db`                | `services/db/`                | ParadeDB (Postgres)          |
| `tale-sandbox`           | `services/sandbox/`           | Bun + CLI Docker             |
| `tale-sandbox-egress`    | `services/sandbox-egress/`    | Alpine + tinyproxy           |
| `tale-sandbox-runtime`   | `services/sandbox-runtime/`   | Bun + Chromium + Playwright  |
| `tale-sandbox-buildkitd` | `services/sandbox-buildkitd/` | Debian + BuildKit + redsocks |

Les deux conteneurs de base de données — `db` et `knowledge-db` — se construisent depuis la même image ParadeDB `tale-db` ; la différence est la base que chacun sert. La gateway LLM, `tale-sandbox-llm-gateway`, est une image amont pinnée (`maximhq/bifrost`), elle n'a donc pas de Dockerfile dans le repo. Les fichiers compose à la racine du repo (`compose.yml` pour développement, le compose de production généré par la CLI) les référencent via `ghcr.io/tale-project/tale/<image>:<tag>`. Un build local remplace le pull de registre par un bloc `build:` dans compose.

## Construire localement

Un premier build de chaque image prend environ 15 minutes sur un laptop récent ; les builds suivants touchent le cache de layers de Docker et finissent en moins d'une minute pour l'image que tu as changée.

```bash
# Construis chaque image dans compose.yml
docker compose build

# Construis une image
docker compose build platform
```

Mets `PULL_POLICY=build` dans ton environnement (ou dans `.env`) pour forcer compose à construire plutôt qu'à puller l'image publiée. Le `compose.yml` livré défaut sur `build`, donc un clone local sans overrides construit déjà ; les fichiers compose de production que `tale deploy` génère défautent sur `always` et pullent depuis le registre.

## Les coutures de personnalisation

Les points d'extension supportés pour les forks sont au niveau du Dockerfile. L'entrypoint de l'image et les fichiers de configuration à l'intérieur sont stables — patche-les, construis l'image, et le reste du système n'a pas besoin de savoir.

- **Caddyfile** — `services/proxy/Caddyfile` contrôle le routage et la terminaison TLS. Les en-têtes personnalisés, sous-domaines personnalisés et rate limits personnalisés atterrissent ici.
- **Templates plop plateforme** — `services/platform/Dockerfile` lance une étape de build qui cuit les messages, le schéma et les assets statiques. Un fork qui ship des chaînes UI personnalisées ou des routes supplémentaires construit l'image plateforme.
- **Image runtime sandbox** — `services/sandbox-runtime/Dockerfile` est l'environnement d'exécution pour **Exécuter du code**, le rendu web et la génération de documents ; il embarque déjà Chromium et Playwright. Un fork qui a besoin d'un paquet système supplémentaire ou d'un build de navigateur différent patche ici.
- **Proxy d'egress sandbox** — `services/sandbox-egress/tinyproxy.conf.template` est la configuration proxy que l'entrypoint rend au démarrage : egress ouvert par défaut, ou un filtre d'hôtes en refus par défaut quand `SANDBOX_EGRESS_ALLOWLIST` est défini. Un fork qui a besoin d'un autre comportement proxy patche ici.

Ce qui n'est pas une couture supportée : le code applicatif du backend convex, y compris l'extraction de documents et la logique RAG et crawler qui vit désormais en in-process (`services/platform/convex/`), et le code runtime du conteneur plateforme (`services/platform/app/`). Ces fichiers sont du code applicatif, pas de la configuration — ajouter un extracteur de format de document ou changer le comportement de récupération est un vrai fork et porte la taxe de montée de version.

## Tagger et pousser vers ta propre registre

Pour les distributions air-gapped ou vendorisées, le chemin est « construire, tagger, pousser vers ta registre, changer les lignes `image:` du compose ».

```bash
# Construire, tagger, pousser
export REGISTRY=registry.internal.example.com/tale
docker compose build
docker tag ghcr.io/tale-project/tale/tale-platform:latest \
  $REGISTRY/tale-platform:vendored-1.0
docker push $REGISTRY/tale-platform:vendored-1.0
```

Le déploiement de la CLI génère un fichier compose avec le chemin de registre ; soit patche le fichier généré après génération, soit saute la CLI et lance `docker compose` directement contre un fichier compose que tu maintiens toi-même.

## Rester en sync avec l'amont

Le chemin bon marché est un fork sur GitHub qui merge périodiquement depuis `tale-project/tale@main`. Les conflits atterrissent dans les fichiers que tu as patchés ; le reste passe propre. Les deux anti-patterns :

- **Patcher du code applicatif au lieu de le contribuer en retour.** Si le changement est largement utile, upstream une PR — chaque taxe de release descend.
- **Pinner sur une vieille image de base.** Les bases Caddy, Bun et Postgres prennent les patches de sécurité à la reconstruction ; pinner la base pour la « stabilité » est emprunter des ennuis.

## Où cela s'inscrit

Cette page est la couture côté contributeur de l'histoire opérateur. La vue d'ensemble de l'architecture vit dans [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) ; le workflow de montée de version qui fait tourner les images publiées est dans [Montées de version](/fr/self-hosted/operate/upgrades). Si ton fork est non-trivial, la conversation qui vaut la peine d'être lancée avant que tu n'écrives du code est celle sur le Discord ou les GitHub Discussions du projet — beaucoup de forks finissent par être des fonctionnalités qui attendent d'atterrir en amont.
