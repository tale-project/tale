---
title: Déploiement en production
description: Déploie Tale sur un serveur de production avec le CLI Tale et des déploiements blue-green zero-downtime.
---

## Prérequis

- Un serveur Linux avec Docker Engine 24.0+.
- Au moins 8 Go de RAM (12 Go recommandés pour les déploiements zero-downtime).
- Les ports 80 et 443 ouverts dans le firewall.
- Un nom de domaine qui pointe vers ton serveur.

## Tailles des images

Tale tire des images pré-construites depuis GitHub Container Registry. Tailles actuelles :

| Service    | Image                                        | Taille     |
| ---------- | -------------------------------------------- | ---------- |
| Platform   | `ghcr.io/tale-project/tale/tale-platform`    | ~320 Mo    |
| Convex     | `ghcr.io/tale-project/tale/tale-convex`      | ~485 Mo    |
| Crawler    | `ghcr.io/tale-project/tale/tale-crawler`     | ~1,9 Go    |
| RAG        | `ghcr.io/tale-project/tale/tale-rag`         | ~515 Mo    |
| DB         | `ghcr.io/tale-project/tale/tale-db`          | ~1,1 Go    |
| Proxy      | `ghcr.io/tale-project/tale/tale-proxy`       | ~88 Mo     |

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

## Installation initiale

### Étape 1 : initialiser le répertoire

```bash
mkdir ~/tale && cd ~/tale
tale init
```

Ça crée ton `.env` avec des secrets générés.

### Étape 2 : configurer l'environnement

Ouvre `.env` et définis les valeurs requises :

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
DB_PASSWORD=a-strong-database-password
```

Voir la [référence d'environnement](/fr/self-hosted/configuration/environment-reference) pour toutes les options.

### Étape 3 : déployer

```bash
tale deploy
```

Le CLI tire les images pré-construites, démarre tous les services, attend les health checks et indique quand la plateforme est prête. Au premier deploy il démarre aussi la DB et le proxy.

## Gérer les déploiements

### Déployer une nouvelle version

```bash
tale deploy                # déployer la version courante du CLI
tale deploy --dry-run      # prévisualiser sans déployer
tale deploy --all          # mettre aussi à jour DB et proxy
```

`tale deploy` déploie toujours la version du CLI en cours. Pour passer à une version plus récente, `tale upgrade` d'abord puis `tale deploy`.

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
tale rollback                      # revenir à la précédente
tale rollback --version 0.9.0      # revenir à une version précise
```

> **Changements de schéma forward-only.** `tale rollback` n'échange que les images ; il ne **rollback pas** les données Convex. Voir [Compatibilité de schéma et rollback](#compatibilite-de-schema-et-rollback).

### Nettoyage

```bash
tale cleanup              # retirer les conteneurs inactifs
tale reset --force        # retirer TOUS les conteneurs (demande confirmation)
```

## Zero-downtime

Le CLI utilise le blue-green. Lors d'une nouvelle version :

1. les nouveaux conteneurs démarrent à côté des actuels ;
2. les health checks confirment que la nouvelle version est prête ;
3. le trafic bascule ;
4. les anciens conteneurs sont drainés et retirés.

Ça demande au moins **12 Go de RAM** parce que les deux versions tournent en même temps. DB et proxy sont partagés et non dupliqués.

## Configuration TLS

### Let's Encrypt (recommandé)

```dotenv
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
```

Caddy émet et renouvelle automatiquement des certificats TLS de confiance. Les ports 80 et 443 doivent être joignables publiquement.

### Auto-signé (dev)

```dotenv
TLS_MODE=selfsigned
```

Génère un certificat auto-signé. Les navigateurs affichent un avertissement. Pour faire confiance sur l'hôte :

```bash
docker exec tale-proxy caddy trust
```

### TLS externe (derrière un reverse proxy)

```dotenv
TLS_MODE=external
```

Caddy n'écoute qu'en HTTP (port 80). Ton reverse proxy gère la terminaison TLS.

## Derrière un reverse proxy

Si Tale tourne derrière un reverse proxy terminant TLS (nginx, Traefik, Cloudflare Tunnel) :

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=external
```

`SITE_URL` doit matcher l'URL que voient les utilisateurs. Si ton reverse proxy utilise un port non standard, inclus-le (ex. `SITE_URL=https://yourdomain.com:8443`).

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

Caddy gère le strip du préfixe en interne — ton reverse proxy n'a **pas** besoin de le stripper. Transfère simplement tout le trafic sous le sous-chemin tel quel (note : pas de slash final sur `proxy_pass`) :

```nginx
location /tale/ {
    proxy_pass http://tale-server:80;
    # ... mêmes headers et config WebSocket que plus haut ...
}
```

**Limitations connues :**

- Le Convex Dashboard (`/convex-dashboard`) n'est pas accessible en déploiement sous-chemin.

## Utiliser une base externe

Tale livre un conteneur ParadeDB (PostgreSQL 16 + pgvector + pg_search), mais l'architecture supporte aussi une instance PostgreSQL externe. Utile quand ton organisation exige une base managée, doit respecter des règles de résidence des données ou veut utiliser un cluster existant.

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

| Variable               | Service   | Description                                                           |
| ---------------------- | --------- | --------------------------------------------------------------------- |
| `POSTGRES_URL`         | tous      | URL de base sans nom de base.                                         |
| `RAG_DATABASE_URL`     | RAG       | URL complète avec nom de base, surcharge `POSTGRES_URL` pour RAG.     |
| `CRAWLER_DATABASE_URL` | Crawler   | URL complète avec nom de base, surcharge `POSTGRES_URL` pour Crawler. |

Avec les URLs par service, inclus le nom de base :

```dotenv
RAG_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
CRAWLER_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
```

### Initialisation DB

Le conteneur DB fourni exécute les scripts d'init automatiquement au premier start. Avec une DB externe, il faut les lancer à la main. Les scripts sont dans `services/db/init-scripts/`, numérotés :

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
    profiles: ["disabled"]
```

Ça garde la définition (pour que `depends_on` ne casse pas) mais empêche le démarrage sauf profil `disabled` explicite.

## Upgrade depuis pre-split-convex (pre-v0.2.34)

v0.2.34 sépare le backend Convex dans son propre service `convex`. Les déploiements existants stockent les données Convex dans `platform-data` ; les nouveaux (et v0.2.x après upgrade) utilisent un volume dédié `convex-data`. Les migrations sont détectées et appliquées au prochain `tale start` ou `tale deploy` — il n'y a **pas** de commande `tale migrate` séparée :

```bash
tale upgrade                          # récupérer CLI + images
tale deploy --yes                     # non-interactif : appliquer migrations auto
                                      # (ou `tale deploy` pour confirmation interactive)
tale status                           # vérifier le nouveau setup
```

Ce que fait la migration split-convex quand elle se déclenche :

1. **Détection** — cherche `${projectId}_platform-data` (prod) et/ou `${projectId}-dev_platform-data` (dev) avec des données, et confirme que `convex-data` est vide ou absent.
2. **Plan** — affiche source/destination et quels conteneurs seront arrêtés. En interactif, le runner demande confirmation (défaut : Non) ; non-interactif exige `--yes`.
3. **Arrêt** — descend les projets compose/conteneurs tenant le volume source pour que `cp -a` n'entre pas en course avec un writer vivant.
4. **Copie** — `docker run --rm --user 1001:1001 -v src:/src:ro -v dst:/dst alpine sh -c "cp -a /src/. /dst/ && touch /dst/.tale-migration-complete"`.
5. **Vérification** — compare les compteurs de fichiers entre source et destination.
6. **Enregistrement** — append l'ID de migration dans `.tale/migrations.json` pour que les runs suivants sautent. Le volume legacy est **préservé** pour permettre un downgrade.

### Notes de sécurité

- La migration **ne supprime pas** ni ne modifie le volume legacy `platform-data`. Une fois le nouveau setup validé de bout en bout, libère l'espace :

  ```bash
  docker volume rm <projectId>_platform-data
  docker volume rm <projectId>-dev_platform-data   # si tu utilises le dev
  ```

- En cas de problème en pleine copie, relance `tale deploy` / `tale start` — la sentinelle `.tale-migration-complete` est vérifiée avant toute copie, et toute destination partielle est déplacée dans un volume de backup horodaté (`…partial-<ts>`) avant nouvelle tentative.
- Re-lancer après une migration réussie est un no-op.

### Rollback d'un upgrade raté

Si v0.2.x se comporte mal et que tu dois revenir à v0.2.x, **ne supprime pas** le volume legacy `platform-data` :

```bash
tale rollback --version 0.2.33
# Ou downgrade le CLI :
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/v0.2.x/scripts/install-cli.sh | bash
tale start
```

L'ancienne image attend `platform-data:/app/data` ; tant que ce volume est intact, le rollback est propre.

## Compatibilité de schéma et rollback

Les déploiements Tale ne sont pas automatiquement rollback-safe si ton changement modifie le schéma Convex. Les données Convex persistent indépendamment du code, et `tale rollback` n'échange que les images — pas l'état de la base.

### Changements sûrs (rollback-friendly)

- Nouveaux champs **optionnels** dans tables existantes.
- Nouvelles tables.
- Nouveaux index.
- Nouvelles queries/mutations/actions.
- Retrait de champs que l'ancien code tolérait déjà comme optionnels.

### Changements risqués (forward-only)

- Ajouter un champ **requis** à une table existante.
- Renommer un champ.
- Changer le type d'un champ.
- Retirer un champ requis sur lequel le nouveau code compte.
- Restructurer des documents dénormalisés.

### Pattern recommandé : expand-contract

Pour tout changement "risqué", releaser en **deux versions** :

1. **Expand** — introduire la nouvelle forme à côté de l'ancienne. Code qui gère les deux formes. Migrer les données existantes via un backfill one-shot. Rollback sûr, car les deux formes marchent.
2. **Contract** — une fois que l'expand est stable en production, un release suit qui retire l'ancienne forme. Forward-only, mais les données sont garanties dans la nouvelle forme.

### Fenêtre transitoire blue-green

Comme `convex deploy` remplace le set de fonctions atomiquement, il y a une courte fenêtre (~10–30 s) pendant le cutover où les utilisateurs de la couleur platform ancienne peuvent appeler les nouvelles signatures :

1. `green` platform démarre et pousse V2 des functions.
2. Convex sert désormais V2 à tous — y compris les sessions ouvertes sur `blue`.
3. Le health check de Caddy voit `green` sain et bascule le trafic ; `blue` draine.
4. Les clients navigateur se reconnectent et prennent le nouveau code.

Si V2 retire ou renomme des functions, les utilisateurs `blue` voient des erreurs pendant la fenêtre — traite donc "retirer/renommer une function" comme un changement risqué et applique expand-contract.

## Scan de vulnérabilités

Toutes les images Tale sont scannées pour vulnérabilités pendant le pipeline CI/CD via [Trivy](https://trivy.dev/). Les résultats sont uploadés dans l'onglet Security GitHub pour chaque release.

Scan local :

```bash
bun run docker:test:vulnerability
```

Les rapports vont dans `trivy-reports/`. Voir [Architecture des conteneurs](/fr/self-hosted/operate/container-architecture) pour les détails d'image.

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

## Accès au Convex Dashboard

Tale inclut un backend Convex embarqué. Le Convex Dashboard permet d'inspecter la base, voir les logs des fonctions et gérer les jobs de fond.

1. Générer une clé admin :

```bash
./scripts/get-admin-key.sh
```

2. Copier la clé depuis la sortie.
3. Ouvrir `https://yourdomain.com/convex-dashboard` dans le navigateur.
4. Coller la clé admin quand elle est demandée.

> **Note :** Le Convex Dashboard donne un accès direct en lecture et écriture à toutes les données. Ne partage des clés admin qu'avec des équipiers de confiance.
