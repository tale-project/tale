---
title: Déploiement en production
description: Déploie Tale sur un serveur de production avec le CLI Tale et des déploiements blue-green sans coupure.
---

Le déploiement en production est le chemin canonique pour mettre Tale auto-hébergé devant une équipe — un serveur Linux avec un vrai domaine, de vrais certificats TLS et la topologie blue-green qui survit aux mises à jour sans fenêtre de maintenance. Le CLI `tale` fait le gros du travail : il récupère les bonnes images, fait tourner les migrations, démarre les nouveaux conteneurs aux côtés des anciens et ne fait basculer le trafic qu'après que la nouvelle version a passé ses health checks. Un déploiement raté laisse la version précédente en service et rien de visible utilisateur ne casse.

Ce guide suppose que tu as déjà évalué Tale sur un portable. Si ce n'est pas le cas, le [Démarrage rapide local](/fr/self-hosted/install/quickstart) prend quelques minutes et utilise le même CLI ; reviens ici quand l'instance doit être joignable en dehors de ta machine.

## Avant de commencer

- Un serveur Linux avec Docker Engine 24.0 ou plus récent.
- Au moins 8 Go de RAM, 12 Go recommandés pour que le déploiement blue-green ait la marge nécessaire pour faire tourner les deux couleurs côte à côte.
- Les ports 80 et 443 ouverts sur le pare-feu ; la validation ACME a besoin des deux, et le proxy de production aussi.
- Un nom de domaine avec un enregistrement A (ou AAAA) qui pointe sur le serveur.
- Une clé de fournisseur IA — OpenRouter est le défaut recommandé ; tout endpoint compatible OpenAI fonctionne.

Si ton environnement demande un Postgres managé plutôt que la base livrée, parcours [Utiliser une base de données externe](#using-an-external-database) en bas de cette page avant de commencer — ça change quelques valeurs de `.env` et ajoute une étape d'initialisation manuelle.

## Tailles d'image

Tale récupère des images multi-architectures (amd64 + arm64) depuis GitHub Container Registry. Le premier pull pèse environ 4,4 Go compressés au total ; les mises à jour suivantes ne téléchargent que les couches changées.

| Service    | Image                                     | Taille compressée |
| ---------- | ----------------------------------------- | ----------------- |
| `proxy`    | `ghcr.io/tale-project/tale/tale-proxy`    | ~88 Mo            |
| `platform` | `ghcr.io/tale-project/tale/tale-platform` | ~320 Mo           |
| `convex`   | `ghcr.io/tale-project/tale/tale-convex`   | ~485 Mo           |
| `rag`      | `ghcr.io/tale-project/tale/tale-rag`      | ~515 Mo           |
| `crawler`  | `ghcr.io/tale-project/tale/tale-crawler`  | ~1,9 Go           |
| `db`       | `ghcr.io/tale-project/tale/tale-db`       | ~1,1 Go           |

## Installer le CLI

Le CLI `tale` est un binaire unique qui pilote chaque opération de ce guide. Le script d'installation écrit dans `/usr/local/bin/tale` :

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Pour épingler une version précise plutôt que la dernière release, pose la variable d'environnement `VERSION` sur l'installateur :

```bash
VERSION=0.9.0 curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Ou récupère le binaire directement depuis un tag de release — le même binaire multi-architectures est publié pour chaque release :

```bash
curl -fsSL https://github.com/tale-project/tale/releases/download/v0.9.0/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

La liste complète des releases vit sur la page [GitHub Releases](https://github.com/tale-project/tale/releases).

## Étape 1 — Initialiser le répertoire de déploiement

Choisis un répertoire sur le serveur qui hébergera le fichier `.env` et la configuration locale. Le schéma standard est `~/tale` :

```bash
mkdir ~/tale && cd ~/tale
tale init
```

`tale init` écrit un fichier `.env` avec des secrets auto-générés — `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`, `INSTANCE_SECRET` et une `SOPS_AGE_KEY` pour le mode de secrets de fournisseur chiffrés SOPS. Il dépose aussi les configurations d'exemple de fournisseur sous `examples/providers/` et échafaude `TALE_CONFIG_DIR`. Le répertoire est la source de vérité pour cette instance ; tout ce que `tale deploy` lit vit ici ou dans `.env`.

## Étape 2 — Configurer ton environnement

Ouvre `.env` et pose les valeurs requises. L'ensemble production minimum est de cinq variables :

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
DB_PASSWORD=a-strong-database-password
```

`SITE_URL` doit correspondre à l'URL que les utilisateurs atteignent réellement dans leur navigateur. Si ton reverse proxy ou ton load balancer termine le TLS sur un port non standard, inclus-le (`https://yourdomain.com:8443`). La [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) catalogue chaque variable que Tale lit — domaine, TLS, secrets, base, supervision, SSO, en-têtes de confiance — avec les valeurs par défaut de `.env.example`.

## Étape 3 — Déployer

```bash
tale deploy
```

Le premier déploiement récupère chaque image, démarre la base et le proxy, et fait monter la plateforme une fois les dépendances saines. Les déploiements suivants réutilisent la base et le proxy en marche et ne roulent que les services applicatifs. Le CLI annonce quand chaque conteneur passe son health check et quand la plateforme répond à `/api/health` depuis l'intérieur du réseau.

Ajoute `--dry-run` pour prévisualiser sans appliquer ; ajoute `--all` pour mettre aussi à jour les services d'infrastructure (`db`, `proxy`) que le CLI laisse d'ordinaire tranquilles après l'installation initiale.

## Opérations quotidiennes

`tale deploy` est le cheval de bataille, mais quelques autres commandes font partie du rythme courant.

```bash
tale status                      # Couleur active (blue ou green), conteneurs en marche, santé
tale logs platform               # Affiche les logs d'un service
tale logs platform --follow      # Idem, en streaming
tale logs db --tail 100          # 100 dernières lignes depuis la base
tale cleanup                     # Retire les conteneurs inactifs de la couleur précédente
tale reset --force               # Retire chaque conteneur (confirmation requise)
```

### Mises à niveau

Une montée de version, c'est deux commandes : mettre à jour le binaire CLI, puis redéployer.

```bash
tale upgrade                     # Récupère la dernière release du CLI
tale deploy                      # Déploie la nouvelle version
```

Pour épingler une version précise (en avant ou en arrière), passe `--version` :

```bash
tale upgrade --version 0.9.0
tale deploy
```

Lis les notes de version avant de mettre à niveau. Les changements cassants et les notes de migration vivent sur la page [GitHub Releases](https://github.com/tale-project/tale/releases), au format défini par [Format des notes de version](/fr/self-hosted/operate/release-notes/format). Pour des instances critiques en production, fais tourner la même paire `tale upgrade` plus `tale deploy` sur une instance de staging d'abord ; `tale init` dans un répertoire séparé sur un autre hôte te donne un stack isolé.

### Rollback

```bash
tale rollback                    # Revient à la version précédente
tale rollback --version 0.9.0    # Revient à une version précise
```

`tale rollback` échange les images de conteneurs. Il ne fait pas de rollback du schéma ou des données Convex. Voir [Compatibilité de schéma et rollback](#schema-compatibility-and-rollback) pour les cas où ça compte.

## Mises à niveau sans coupure

Le CLI déploie en blue-green : la nouvelle couleur démarre à côté de la couleur en marche, le proxy attend qu'elle passe ses health checks, puis bascule le trafic et drain l'ancienne couleur. C'est pour ça que la recommandation RAM passe de 8 Go à 12 Go — `platform`, `rag` et `crawler` existent deux fois pendant la bascule. Les services `db` et `proxy` sont partagés et jamais dupliqués.

```text
1. green démarre.
2. Les conteneurs de green passent leurs health checks.
3. Le proxy bascule le trafic de blue vers green.
4. blue drain et s'arrête.
```

Si green ne reporte jamais sain, le proxy continue de router vers blue et `tale deploy` échoue avec les logs du conteneur attachés. Rien de visible utilisateur ne casse.

## TLS

`TLS_MODE` est l'interrupteur unique qui choisit comment les certificats sont émis. Trois valeurs ; prends celle qui colle.

### Let's Encrypt (recommandé pour la production)

```dotenv
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
```

Caddy émet et renouvelle des certificats de confiance automatiquement. Les ports 80 et 443 doivent être joignables depuis Internet public — le défi HTTP-01 d'ACME tourne sur le port 80, et le trafic HTTPS répond sur 443.

### Auto-signé (développement et démos)

```dotenv
TLS_MODE=selfsigned
```

Caddy génère un certificat local. Les navigateurs affichent un avertissement de connexion non privée jusqu'à ce que tu fasses confiance au certificat. Pour lui faire confiance sur l'hôte :

```bash
docker exec tale-proxy caddy trust
```

### Externe (derrière un reverse proxy en amont)

```dotenv
TLS_MODE=external
```

Caddy n'écoute qu'en HTTP. Ton reverse proxy (nginx, Traefik, HAProxy, Cloudflare Tunnel) termine le TLS et transmet à Tale sur le port 80. Le reverse proxy doit aussi propager les upgrades WebSocket parce que le canal temps réel de Convex tourne sur WS.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    # ... TLS certificate config ...

    location / {
        proxy_pass http://tale-server:80;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Long timeout for Convex WebSocket sync connections
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;

        proxy_buffering off;
    }
}
```

## Déploiement sous sous-chemin

Si ton reverse proxy sert Tale sous un préfixe de chemin (`https://yourdomain.com/tale/`), pose `BASE_PATH` pour que la SPA émette les bonnes URL d'assets :

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=external
BASE_PATH=/tale
```

Caddy retire le préfixe en interne — ton proxy en amont transmet le chemin complet tel quel. Pas de barre oblique finale sur `proxy_pass` :

```nginx
location /tale/ {
    proxy_pass http://tale-server:80;
    # ... same headers and WebSocket config as above ...
}
```

Le tableau de bord Convex sur `/convex-dashboard` n'est pas joignable actuellement sous un déploiement à sous-chemin.

## Utiliser une base de données externe

Le conteneur `db` livré embarque ParadeDB (Postgres 16 + pgvector + pg_search) et fonctionne d'origine. Si tu as besoin d'une base managée, d'une résidence des données dans un cluster précis ou d'un pool Postgres existant, les quatre services qui utilisent la base peuvent se connecter à n'importe quelle instance Postgres externe à la place.

L'instance externe doit remplir quelques conditions :

| Exigence                      | Détail                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| Version Postgres              | 16 ou plus récente                                                  |
| Extension `pgvector`          | Requise pour la recherche vectorielle / sémantique                  |
| Extension `pg_search`         | Optionnelle — la recherche plein-texte BM25 dégrade proprement sans |
| Bases                         | `tale` (plateforme) et `tale_knowledge` (RAG et crawler)            |
| Schémas dans `tale_knowledge` | `public_web` (crawler) et `private_knowledge` (RAG)                 |

Pointe Tale sur l'instance externe depuis `.env` :

```dotenv
POSTGRES_URL=postgresql://tale:your-password@your-db-host:5432
```

`POSTGRES_URL` est l'URL de base sans nom de base de données. Convex ajoute `tale` et les services Python dérivent `tale_knowledge` de la même base. Si un service a besoin d'un hôte différent (le service RAG sur un réplica en lecture, par exemple), surcharge par service :

```dotenv
RAG_DATABASE_URL=postgresql://tale:your-password@rag-replica:5432/tale_knowledge
CRAWLER_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
```

Le conteneur `db` livré fait tourner ses scripts d'init au premier démarrage ; une instance externe ne les voit jamais, donc tu dois les appliquer à la main avant le premier `tale deploy` :

```bash
for f in services/db/init-scripts/*.sql; do
  psql -h your-db-host -U postgres -f "$f"
done
```

Puis fais tourner les migrations dbmate contre `tale_knowledge` :

```bash
# Avec dbmate installé localement (brew install dbmate sur macOS) :
dbmate -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" \
  -d services/db/migrations/db/migrations up

# Ou en one-shot via Docker :
docker run --rm -v "$PWD/services/db/migrations/db/migrations:/db/migrations" \
  amacneil/dbmate \
  -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" up
```

Enfin, empêche le conteneur `db` livré de démarrer en déposant un `compose.override.yml` à côté de ton `.env` :

```yaml
services:
  db:
    profiles: ['disabled']
```

La surcharge garde la définition du service (pour que les références `depends_on` se résolvent encore) mais ne démarre jamais le conteneur.

## Compatibilité de schéma et rollback

Les déploiements Tale ne sont pas automatiquement sûrs au rollback quand ton changement de code modifie le schéma Convex. Les données Convex persistent indépendamment de l'image applicative, et `tale rollback` ne fait que basculer les conteneurs — jamais les données.

### Changements sûrs

- Ajout de champs optionnels à des tables existantes.
- Ajout de nouvelles tables.
- Ajout de nouveaux index.
- Ajout de nouvelles queries, mutations ou actions.
- Retrait de champs que l'ancien code tolérait déjà comme optionnels.

### Changements risqués

- Ajout d'un champ requis à une table existante.
- Renommage d'un champ.
- Changement du type d'un champ.
- Retrait d'un champ requis dont le nouveau code dépend.
- Restructuration de documents dénormalisés.

### Expand-contract

Pour tout changement risqué, livre deux releases.

La première release **étend** : elle ajoute la nouvelle forme aux côtés de l'ancienne, écrit du code qui gère les deux et migre les données existantes vers la nouvelle forme via un backfill en une passe. Les deux formes marchent, donc la release est sûre au rollback. La seconde release **contracte** : une fois que la production a tourné assez longtemps sur la release étendue pour confirmer la stabilité, la suite retire l'ancienne forme. À ce stade, les données sont garanties dans la nouvelle forme, donc la release de contraction peut être forward-only.

### Fenêtre transitoire blue-green

L'étape de déploiement pousse le nouveau jeu de fonctions Convex atomiquement. Pendant une courte fenêtre — environ 10 à 30 secondes — les sessions ouvertes sur l'ancienne couleur peuvent appeler des signatures de fonction qui matchent la nouvelle forme :

```text
1. La plateforme green démarre, fait tourner `bunx convex deploy` contre le service convex.
2. Convex sert maintenant les fonctions V2 à chaque client, y compris les sessions blue ouvertes.
3. Le proxy voit que green est sain et bascule le trafic.
4. Les clients navigateur se reconnectent et prennent le nouveau code plateforme.
```

Si V2 retire ou renomme des fonctions, les clients connectés à blue voient des erreurs pendant la fenêtre. Traite « retirer ou renommer une fonction » comme un changement risqué et suis expand-contract.

## Analyse de vulnérabilités

Chaque image Tale est analysée avec [Trivy](https://trivy.dev/) dans le pipeline de release CI ; les résultats sont publiés sur l'onglet Security de GitHub contre le tag de release. Pour faire tourner l'analyse localement contre les images de ton hôte :

```bash
bun run docker:test:vulnerability
```

Les rapports atterrissent dans `trivy-reports/`. Les vérifications au niveau image (labels OCI, utilisateur non-root, budgets de taille, pas de secrets dans les couches) sont couvertes par `bun run docker:test:image`. Le [guide Contributing Docker](/fr/develop/contributing-docker) liste chaque vérification que la CI fait tourner.

## Versions d'image

Les images sont publiées avec deux tags. Les tags de version (`1.2.0`) sont immuables et pointent sur un build précis ; `latest` est mutable et suit la release la plus récente. Les deux portent des manifests multi-architectures pour amd64 et arm64.

```bash
docker pull ghcr.io/tale-project/tale/tale-platform:1.2.0
docker pull ghcr.io/tale-project/tale/tale-platform:latest
```

Pour épingler un service à une version précise sans monter le reste du stack — pour tester une seule image, ou faire avancer uniquement le crawler — dépose un `compose.override.yml` à côté de `.env` :

```yaml
services:
  platform:
    image: ghcr.io/tale-project/tale/tale-platform:1.2.0
```

`tale deploy` fusionne la surcharge automatiquement.

## Tableau de bord Convex

Le backend Convex livré embarque un tableau de bord pour inspecter la base, voir les logs de fonctions et gérer les jobs d'arrière-plan. Il écoute derrière le proxy sur `/convex-dashboard` et demande une clé admin à chaque session.

Pour générer la clé admin :

```bash
tale convex admin
```

Colle la clé dans le tableau de bord quand il la demande. Le tableau de bord donne un accès direct en lecture et en écriture à chaque collection de Convex, donc ne partage les clés admin qu'avec des opérateurs de confiance.

## Où cela s'insère

Le déploiement en production est le chemin canonique pour Tale auto-hébergé. Une fois l'instance joignable, la [Référence d'environnement](/fr/self-hosted/configuration/environment-reference) catalogue chaque bouton touché ici et chaque bouton que ce guide a laissé à sa valeur par défaut ; [Authentification](/fr/self-hosted/admin/authentication) branche l'instance sur ton fournisseur d'identité ; [Exploitation](/fr/self-hosted/operate/observability/operations) couvre ce qu'il faut scraper, journaliser et surveiller une fois que le trafic commence à couler. Pour tout ce que les utilisateurs finaux font une fois connectés, [Platform](/fr/platform) se lit à l'identique en Cloud et en auto-hébergé.
