---
title: Déploiement en production
description: Déploie Tale sur un serveur de production avec le CLI Tale et des déploiements blue-green zero-downtime.
---

Ce guide est le chemin de production : un serveur Linux avec un vrai nom de domaine, un vrai TLS et la topologie blue-green qui permet aux montées de version de tenir sans fenêtre de maintenance. Le CLI `tale` fait le gros du travail — il télécharge les images Docker, joue les migrations et ne bascule le trafic qu'une fois que les nouveaux conteneurs ont passé leurs health checks. Si un déploiement ne monte pas, la version précédente continue de servir et rien de visible côté utilisateur ne casse.

Si tu veux juste essayer Tale en local, [Démarrage rapide](/fr/self-hosted/install/quickstart) est plus court et tourne en quelques minutes. Reviens ici quand tu es prêt à exposer l'instance à ton équipe.

## Prérequis

- Un serveur Linux avec Docker Engine 24.0+.
- Au moins 8 Go de RAM (12 Go recommandés pour les déploiements zero-downtime).
- Les ports 80 et 443 ouverts dans le firewall.
- Un nom de domaine qui pointe vers ton serveur.

## Tailles des images

Tale tire des images pré-construites depuis GitHub Container Registry. Tailles actuelles :

| Service  | Image                                     | Taille  |
| -------- | ----------------------------------------- | ------- |
| Platform | `ghcr.io/tale-project/tale/tale-platform` | ~320 Mo |
| Convex   | `ghcr.io/tale-project/tale/tale-convex`   | ~485 Mo |
| Crawler  | `ghcr.io/tale-project/tale/tale-crawler`  | ~1,9 Go |
| RAG      | `ghcr.io/tale-project/tale/tale-rag`      | ~515 Mo |
| DB       | `ghcr.io/tale-project/tale/tale-db`       | ~1,1 Go |
| Proxy    | `ghcr.io/tale-project/tale/tale-proxy`    | ~88 Mo  |

> **Astuce :** Le premier pull télécharge ~4,4 Go (compressés). Les mises à jour suivantes ne téléchargent que les layers modifiés.

## Installer le CLI Tale

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Ou télécharge le binaire directement depuis [GitHub Releases](https://github.com/tale-project/tale/releases) :

```bash
curl -fsSL https://github.com/tale-project/tale/releases/latest/download/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

### Épingler une version précise

Pour installer une version précise du CLI au lieu de la dernière release, définis la variable d’environnement `VERSION` sur l’installeur :

```bash
VERSION=0.9.0 curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Ou télécharge le binaire directement avec le tag de version dans l’URL :

```bash
curl -fsSL https://github.com/tale-project/tale/releases/download/v0.9.0/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

Les versions disponibles sont sur la [page GitHub Releases](https://github.com/tale-project/tale/releases).

## Installation initiale

### Étape 1 : initialiser le répertoire

```bash
mkdir ~/tale && cd ~/tale
tale init
```

Ça crée ton `.env` avec des secrets générés.

### Étape 2 : configurer l’environnement

Ouvre `.env` et définis les valeurs requises :

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
DB_PASSWORD=a-strong-database-password
```

Voir la [référence d’environnement](/fr/self-hosted/configuration/environment-reference) pour toutes les options.

### Étape 3 : déployer

```bash
tale deploy
```

Le CLI tire les images pré-construites, démarre tous les services, attend les health checks et indique quand la plateforme est prête. Au premier deploy il démarre aussi la DB et le proxy.

## Gérer les déploiements

### Passer à une nouvelle version

`tale deploy` déploie toujours la version du binaire CLI en cours, donc un upgrade se fait en deux étapes :

```bash
tale upgrade            # 1. mettre à jour le CLI vers la dernière release
tale deploy             # 2. dérouler la nouvelle version
```

#### Migrer ou redescendre vers une version précise

```bash
tale upgrade --version 0.9.0       # bascule le CLI vers v0.9.0 (montée ou descente)
tale deploy                        # dérouler ensuite cette version
```

`--version` accepte `0.9.0` ou `v0.9.0`. Les downgrades sont autorisés, mais **les changements de schéma restent forward-only** — voir [Compatibilité de schéma et rollback](#compatibilité-de-schéma-et-rollback). Les versions disponibles sont sur la [page GitHub Releases](https://github.com/tale-project/tale/releases).

#### Avant l’upgrade

Lis les [release notes](https://github.com/tale-project/tale/releases) pour repérer les ruptures de compatibilité et les notes de migration. Sauvegarde la base — le volume Postgres contient toutes les données plateforme et les fichiers uploadés. Si l’instance est critique, teste l’upgrade sur une instance de staging au préalable ; `tale init` dans un répertoire séparé sur un autre hôte te donne un stack isolé.

### Déployer

```bash
tale deploy             # déployer la version courante du CLI
tale deploy --dry-run   # prévisualiser sans déployer
tale deploy --all       # mettre aussi à jour DB et proxy
```

### Statut

```bash
tale status
```

Affiche la couleur active (blue/green), conteneurs et santé.

### Logs

```bash
tale logs platform
tale logs platform --follow
tale logs db --tail 100
```

### Rollback

```bash
tale rollback                       # revenir à la précédente
tale rollback --version 0.9.0       # revenir à une version précise
```

> **Changements de schéma forward-only.** `tale rollback` n’échange que les images ; il ne **rollback pas** les données Convex. Voir [Compatibilité de schéma et rollback](#compatibilité-de-schéma-et-rollback).

### Nettoyage

```bash
tale cleanup            # retirer les conteneurs inactifs
tale reset --force      # retirer TOUS les conteneurs (demande confirmation)
```

## Zero-downtime

Le CLI utilise le blue-green. Lors d’une nouvelle version :

1. les nouveaux conteneurs démarrent à côté des actuels ;
2. les health checks confirment que la nouvelle version est prête ;
3. le trafic bascule ;
4. les anciens conteneurs sont drainés et retirés.

Ça demande au moins **12 Go de RAM** parce que les deux versions tournent en même temps. DB et proxy sont partagés et non dupliqués.

## Configuration TLS

### Let’s Encrypt (recommandé)

```dotenv
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
```

Caddy émet et renouvelle automatiquement des certificats TLS de confiance. Les ports 80 et 443 doivent être joignables publiquement.

### Auto-signé (dev)

```dotenv
TLS_MODE=selfsigned
```

Génère un certificat auto-signé. Les navigateurs affichent un avertissement. Pour faire confiance sur l’hôte :

```bash
docker exec tale-proxy caddy trust
```

### TLS externe (derrière un reverse proxy)

```dotenv
TLS_MODE=external
```

Caddy n’écoute qu’en HTTP (port 80). Ton reverse proxy gère la terminaison TLS.

## Derrière un reverse proxy

Si Tale tourne derrière un reverse proxy terminant TLS (nginx, Traefik, Cloudflare Tunnel) :

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=external
```

`SITE_URL` doit matcher l’URL que voient les utilisateurs. Si ton reverse proxy utilise un port non standard, inclus-le (ex. `SITE_URL=https://yourdomain.com:8443`).

Caddy écoute alors uniquement en HTTP (port 80). Ton reverse proxy doit :

- terminer TLS et transférer tout le trafic (WebSocket compris) à Tale sur le port 80 ;
- poser les headers `X-Forwarded-Proto` et `X-Forwarded-For`.

Exemple nginx :

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    # ... ta config de certificat TLS ...

    location / {
        proxy_pass http://tale-server:80;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # support WebSocket
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # timeouts longs pour la sync WebSocket Convex
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        proxy_buffering off;
    }
}
```

## Déploiement en sous-chemin

Si ton reverse proxy sert Tale sous un sous-chemin (ex. `https://yourdomain.com/tale/`), définis `BASE_PATH` :

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=external
BASE_PATH=/tale
```

Caddy gère le strip du préfixe en interne — ton reverse proxy n'a **pas** besoin de le stripper. Transfère tout le trafic sous le sous-chemin tel quel (note : pas de slash final sur `proxy_pass`) :

```nginx
location /tale/ {
    proxy_pass http://tale-server:80;
    # ... mêmes headers et config WebSocket que plus haut ...
}
```

**Limitations connues :**

- Le Convex Dashboard (`/convex-dashboard`) n’est pas accessible en déploiement sous-chemin.

## Utiliser une base externe

Tale livre un conteneur ParadeDB (PostgreSQL 16 + pgvector + pg_search), mais l’architecture supporte aussi une instance PostgreSQL externe. Utile quand ton organisation exige une base managée, doit respecter des règles de résidence des données ou veut utiliser un cluster existant.

### Exigences

| Exigence                       | Détail                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Version PostgreSQL             | 16+                                                                                  |
| Extension pgvector             | requise pour la recherche vectorielle/sémantique.                                    |
| Extension pg_search (ParadeDB) | optionnelle — la recherche plein-texte BM25 se désactive proprement si indisponible. |
| Bases                          | `tale` (données platform) et `tale_knowledge` (RAG + crawler).                       |
| Schémas dans `tale_knowledge`  | `public_web` (crawler) et `private_knowledge` (RAG).                                 |

### Configuration

Définis `POSTGRES_URL` dans `.env` pour pointer tous les services :

```dotenv
POSTGRES_URL=postgresql://tale:your-password@your-db-host:5432
```

Tu peux aussi surcharger les connexions par service :

| Variable               | Service | Description                                                           |
| ---------------------- | ------- | --------------------------------------------------------------------- |
| `POSTGRES_URL`         | tous    | URL de base sans nom de base.                                         |
| `RAG_DATABASE_URL`     | RAG     | URL complète avec nom de base, surcharge `POSTGRES_URL` pour RAG.     |
| `CRAWLER_DATABASE_URL` | Crawler | URL complète avec nom de base, surcharge `POSTGRES_URL` pour Crawler. |

Avec les URLs par service, inclus le nom de base :

```dotenv
RAG_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
CRAWLER_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
```

### Initialisation DB

Le conteneur DB fourni exécute les scripts d’init automatiquement au premier start. Avec une DB externe, il faut les lancer à la main. Les scripts sont dans `services/db/init-scripts/`, numérotés :

```bash
for f in services/db/init-scripts/*.sql; do
  psql -h your-db-host -U postgres -f "$f"
done
```

Puis applique les migrations en attente. Installe [dbmate](https://github.com/amacneil/dbmate) localement (`brew install dbmate` sur macOS ; pour Linux/Windows, voir le README du dépôt), ou lance-le via Docker si tu préfères ne rien installer :

```bash
# Avec dbmate installé localement :
dbmate -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" -d services/db/migrations/db/migrations up

# Ou via Docker (aucune installation locale nécessaire) :
docker run --rm -v "$PWD/services/db/migrations/db/migrations:/db/migrations" \
  amacneil/dbmate \
  -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" up
```

### Désactiver le conteneur DB fourni

Après avoir configuré la DB externe, empêche le conteneur DB fourni de démarrer. Crée un `compose.override.yml` dans le répertoire de déploiement :

```yaml
services:
  db:
    profiles: ['disabled']
```

Ça garde la définition (pour que `depends_on` ne casse pas) mais empêche le démarrage sauf profil `disabled` explicite.

## Compatibilité de schéma et rollback

Les déploiements Tale ne sont pas automatiquement rollback-safe si ton changement modifie le schéma Convex. Les données Convex persistent indépendamment du code, et `tale rollback` n’échange que les images — pas l’état de la base.

### Changements sûrs (rollback-friendly)

- Nouveaux champs **optionnels** dans tables existantes.
- Nouvelles tables.
- Nouveaux index.
- Nouvelles queries/mutations/actions.
- Retrait de champs que l’ancien code tolérait déjà comme optionnels.

### Changements risqués (forward-only)

- Ajouter un champ **requis** à une table existante.
- Renommer un champ.
- Changer le type d’un champ.
- Retirer un champ requis sur lequel le nouveau code compte.
- Restructurer des documents dénormalisés.

### Pattern recommandé : expand-contract

Pour tout changement "risqué", releaser en **deux versions** :

1. **Expand** — introduire la nouvelle forme à côté de l’ancienne. Code qui gère les deux formes. Migrer les données existantes via un backfill one-shot. Rollback sûr, car les deux formes marchent.
2. **Contract** — une fois que l’expand est stable en production, un release suit qui retire l’ancienne forme. Forward-only, mais les données sont garanties dans la nouvelle forme.

### Fenêtre transitoire blue-green

Comme `convex deploy` remplace le set de fonctions atomiquement, il y a une courte fenêtre (~10–30 s) pendant le cutover où les utilisateurs de la couleur platform ancienne peuvent appeler les nouvelles signatures :

1. `green` platform démarre et pousse V2 des functions.
2. Convex sert désormais V2 à tous — y compris les sessions ouvertes sur `blue`.
3. Le health check de Caddy voit `green` sain et bascule le trafic ; `blue` draine.
4. Les clients navigateur se reconnectent et prennent le nouveau code.

Si V2 retire ou renomme des functions, les utilisateurs `blue` voient des erreurs pendant la fenêtre — traite donc "retirer/renommer une function" comme un changement risqué et applique expand-contract.

## Scan de vulnérabilités

Toutes les images Tale sont scannées pour vulnérabilités pendant le pipeline CI/CD via [Trivy](https://trivy.dev/). Les résultats sont uploadés dans l’onglet Security GitHub pour chaque release.

Scan local :

```bash
bun run docker:test:vulnerability
```

Les rapports vont dans `trivy-reports/`. Voir [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) pour les détails d’image.

## Versioning des images

Les images sont publiées dans GitHub Container Registry avec deux tags :

- **Tag de version** (ex. `1.2.0`) — immutable, pointe vers un build précis.
- **`latest`** — mutable, pointe toujours vers la release la plus récente.

Les deux tags incluent des manifestes multi-architecture (amd64 + arm64).

```bash
# Pull d'une version précise
docker pull ghcr.io/tale-project/tale/tale-platform:1.2.0

# Pull de la dernière release
docker pull ghcr.io/tale-project/tale/tale-platform:latest
```

### Épingler une version d’image

`tale deploy` choisit les images selon la version du CLI. Pour verrouiller des images de service indépendamment — par exemple pour tester une seule image sans upgrader tout le stack — crée un `compose.override.yml` à côté de ton `.env` :

```yaml
services:
  platform:
    image: ghcr.io/tale-project/tale/tale-platform:1.2.0
```

`tale deploy` fusionne l’override automatiquement.

## Accès au Convex Dashboard

Tale inclut un backend Convex embarqué. Le Convex Dashboard permet d’inspecter la base, voir les logs des fonctions et gérer les jobs de fond.

1. Générer une clé admin :

```bash
./scripts/get-admin-key.sh
```

2. Copier la clé depuis la sortie.
3. Ouvrir `https://yourdomain.com/convex-dashboard` dans le navigateur.
4. Coller la clé admin quand elle est demandée.

> **Note :** Le Convex Dashboard donne un accès direct en lecture et écriture à toutes les données. Ne partage des clés admin qu'avec des équipiers de confiance.

## Où ça s'inscrit

L'installation serveur Linux est le chemin canonique de production pour Tale auto-hébergé. Une fois l'instance debout, la [référence des variables d'environnement](/fr/self-hosted/configuration/environment-reference) catalogue chaque bouton que l'installation a touché et chaque bouton qu'elle n'a pas touché ; [Authentification](/fr/self-hosted/admin/authentication) câble l'instance à ton fournisseur d'identité ; [Opérations](/fr/self-hosted/operate/observability/operations) couvre ce qu'il faut scraper et sur quoi alerter une fois que le trafic démarre. Pour le travail utilisateur final dans l'app qui tourne, [Platform](/fr/platform) est la destination suivante.
