---
title: Gérer Compose toi-même
description: Assemble images, stockages, réseaux, secrets et sondes lorsque ton équipe prend en charge l’orchestration de Tale.
---

Utilise cette référence si ton équipe maintient les fichiers et le processus de déploiement. Le [démarrage rapide CLI](/fr/self-hosted/install/quickstart) est plus court si tu veux que Tale génère les fichiers et coordonne les mises à niveau. Il n’existe pas de chart Helm officiel. Le spawner sandbox prend en charge Docker et Kubernetes ; choisis la configuration réseau et le runtime adaptés.

Cette page décrit le contrat de déploiement avec un exemple de couche applicative, pas un Compose complet prêt à démarrer. Assemble et valide stockage, proxy et sandbox avant d’utiliser cet exemple.

## Choisir la répartition des services

| Groupe | Services | Cycle de vie |
| --- | --- | --- |
| Application réplicable | `platform`, `backend-api`, `backend-worker` | Même image et release ; conserver des interfaces compatibles pendant le remplacement. |
| Stockages persistants et entrée | `db`, `object-store`, `proxy` | Préserver volumes, identifiants, certificats et noms réseau stables lors du remplacement. |
| Exécution partagée | `sandbox`, `sandbox-egress` | Coordonner les sessions actives avant remplacement ; le spawner demande le daemon Docker et des chemins de workspace correspondants. |
| Vidéo facultative | `bgutil-provider` | Fournisseur de jetons démarré au mieux ; sa panne peut affecter les récupérations vidéo. Le backend ne l’interroge qu’avec `VIDEO_INGEST_POT_PROVIDER=true`, que la pile de référence définit pour ses propres services. |

Le montage fourni conserve `tale_app` et `tale_knowledge` dans un service Postgres avec l’alias `knowledge-db`. Des bases séparées ou gérées sont aussi possibles ; configure explicitement connexions et sauvegardes. Recréer un conteneur persistant ne détruit pas automatiquement ses données, mais retirer ou remplacer son volume peut le faire.

## Fixer des images compatibles

Définis `VERSION` dans le `.env` de Compose avec la release Tale examinée et testée. Exporte la même valeur dans le shell pour le téléchargement séparé de l’image d’exécution plus bas. Garde les images Tale sur une release commune ; les deux services utilisant des images amont ont leurs propres versions. Les couches des images Tale sont compressées en zstd : l’hôte Docker doit donc exécuter Docker Engine 24.0 ou une version ultérieure.

| Service | Image |
| --- | --- |
| `platform`, `backend-api`, `backend-worker` | `ghcr.io/tale-project/tale/tale-platform:<version>` |
| `proxy` | `ghcr.io/tale-project/tale/tale-proxy:<version>` |
| `db` | `ghcr.io/tale-project/tale/tale-db:<version>` |
| `sandbox` | `ghcr.io/tale-project/tale/tale-sandbox:<version>` |
| `sandbox-egress` | `ghcr.io/tale-project/tale/tale-sandbox-egress:<version>` |
| `object-store` | `ghcr.io/versity/versitygw:v1.11.0` |
| `bgutil-provider` | `brainicism/bgutil-ytdlp-pot-provider:1.3.1` |

Fixe versitygw par son digest, comme le fait `tale deploy` : `ghcr.io/versity/versitygw:v1.11.0@sha256:8319a530d08d537426e2f855bae5280709795dc73a3f0c347973ef915d6343c5`, avec des images pour `linux/amd64` et `linux/arm64`. Un stack qui garde ses fichiers dans MinIO exécute `ghcr.io/tale-project/ops/minio:RELEASE.2025-04-22T22-12-26Z`, uniquement en `linux/amd64`, jusqu’à ce que tu [les déplaces](#blob-store).

Les sessions utilisent aussi `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`. Définis `SANDBOX_RUNTIME_IMAGE` sur le spawner et télécharge-la avant le démarrage. Le tag local de développement par défaut ne suffit pas sur un hôte qui ne l’a jamais construite. Si tu actives Docker dans les conteneurs ou le cache de build partagé, prépare aussi les images compatibles de la [référence d’environnement](/fr/self-hosted/configuration/environment-reference).

## Préparer secrets et adresses publiques

Génère des valeurs uniques avant le premier démarrage et conserve-les dans ton gestionnaire de secrets. Ne copie pas les identifiants d’exemple d’un environnement de développement en production.

| Valeur | Exigence |
| --- | --- |
| `BETTER_AUTH_SECRET` | Secret d’authentification stable à forte entropie. |
| `ENCRYPTION_SECRET_HEX` | Valeur hexadécimale de 32 octets, par exemple via `openssl rand -hex 32` ; la conserver pour les valeurs déjà chiffrées en base. |
| `DB_PASSWORD` ou identifiants de base externe | Correspondre au rôle réellement utilisé par le backend. |
| `SANDBOX_TOKEN` | Même jeton aléatoire dans le backend et le spawner. |
| `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY` | Identifiants valides pour le stockage. Le versitygw fourni les reçoit dans `ROOT_ACCESS_KEY` et `ROOT_SECRET_KEY`, et `OBJECT_STORE_REGION` dans `VGW_REGION` : il refuse une requête signée pour une autre région. MinIO les reçoit dans `MINIO_ROOT_USER` et `MINIO_ROOT_PASSWORD`. |
| `OBJECT_STORE_PUBLIC_ENDPOINT` | Point d’accès joignable par le navigateur, généralement `SITE_URL` lorsque le proxy relaie le stockage fourni. |
| Identité age SOPS | Nécessaire aux fichiers de configuration chiffrés ; voir [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops). |

Le backend synchronise au démarrage la connexion objet par défaut gérée par l’environnement. Il laisse volontairement intact un fichier `managedBy: operator`. Changer les identifiants ne déplace pas les objets et ne les rend pas intrinsèquement orphelins, mais backend et stockage doivent être d’accord.

Définis `HOST`, `SITE_URL` et `TLS_MODE` pour l’accès public. [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains) traite les certificats, origines supplémentaires et sous-chemins.

## Assembler la couche applicative

Les trois rôles partagent une image. `TALE_ROLE=api` et `TALE_ROLE=worker` choisissent les rôles backend ; laisse cette variable absente du service web. Un workspace déployé avec `tale deploy` exécute à la place les trois dans un seul processus `platform` (`TALE_ROLE=all`) ; cette page garde trois services, que chaque version prend en charge. Ne fixe pas de `container_name` sur les rôles à répliquer.

```yaml
# Application-tier fragment; add the stores, proxy, and sandbox services.
# No container_name on replicated services.
services:
  platform:
    image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
    env_file: [.env]
    volumes: ['config-data:/app/data:ro']
    restart: unless-stopped
    stop_grace_period: 45s
    healthcheck:
      test:
        [
          'CMD-SHELL',
          'curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]',
        ]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 180s
    networks:
      internal:
        aliases: [platform]
  backend-api:
    image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
    environment:
      TALE_ROLE: api
      PORT: '3005'
      TALE_CONFIG_DIR: /app/data
      DATABASE_URL: ${DATABASE_URL:-postgresql://tale:${DB_PASSWORD:?required}@db:5432/tale_app}
      SANDBOX_URL: http://sandbox:8003
      SANDBOX_HTTP_API_BASE_URL: http://backend-api:3005
      OBJECT_STORE_ENDPOINT: ${OBJECT_STORE_ENDPOINT-http://object-store:9000}
    env_file: [.env]
    volumes: ['config-data:/app/data']
    cap_add: [NET_ADMIN]
    restart: unless-stopped
    stop_grace_period: 30s
    healthcheck:
      test: ['CMD-SHELL', 'curl -sf http://localhost:3005/ping']
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 30s
    networks:
      internal:
        aliases: [backend-api]
      sandbox:
        aliases: [backend-api]
  backend-worker:
    image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
    environment:
      TALE_ROLE: worker
      TALE_CONFIG_DIR: /app/data
      DATABASE_URL: ${DATABASE_URL:-postgresql://tale:${DB_PASSWORD:?required}@db:5432/tale_app}
      SANDBOX_URL: http://sandbox:8003
      SANDBOX_HTTP_API_BASE_URL: http://backend-api:3005
      OBJECT_STORE_ENDPOINT: ${OBJECT_STORE_ENDPOINT-http://object-store:9000}
    env_file: [.env]
    volumes: ['config-data:/app/data']
    cap_add: [NET_ADMIN]
    restart: unless-stopped
    stop_grace_period: 120s
    healthcheck: { disable: true }
    networks: [internal]
volumes:
  config-data:
networks:
  internal:
  sandbox:
    name: tale-sandbox-net
    internal: true
    enable_ipv6: false
```

Les entrées `environment` remplacent `env_file`. Le fragment conserve donc les valeurs externes de base et de stockage au lieu d’imposer les adresses fournies. Dans un projet Compose unique, ajoute des dépendances de santé ; entre projets, ton orchestrateur doit imposer l’ordre de démarrage.

## Préserver les noms réseau et l’isolation

| Adresse | Destination et exigence réseau |
| --- | --- |
| `platform` | Réplicas web sur le réseau applicatif interne. Ils atteignent le backend via `TALE_BACKEND_URL`, `http://backend-api:3005` si tu ne la définis pas. |
| `backend-api` | Réplicas API sur les réseaux applicatif et sandbox, port 3005. Les sessions sandbox appellent le [relais de modèles](/fr/self-hosted/configuration/environment-reference#model-relay) des mêmes réplicas sur le port 8080. |
| `knowledge-db` | Postgres de connaissances, ou une cible définie par `KNOWLEDGE_DATABASE_URL`. |
| `object-store` | versitygw fourni, ou MinIO jusqu’au déplacement de ses fichiers, sur le réseau applicatif. |
| `sandbox` | Spawner accessible au backend sur le port 8003. |
| `sandbox-egress` | Proxy de sortie accessible aux sessions sur le port 3128. |
| `bgutil-provider` | Fournisseur de jetons accessible au backend sur le port 4416. La session sandbox d’une vidéo l’interroge par le port du relais de modèles de `backend-api`. |

Le réseau sandbox doit être isolé des sorties directes. Le stack généré le nomme `tale-sandbox-net` ; si tu choisis un autre nom, garde `SANDBOX_EGRESS_NETWORK` cohérent avec le réseau réel. La sortie doit toujours passer par `sandbox-egress`.

Les sessions joignent le relais de modèles à `http://backend-api:8080` par ce réseau. Sans autre réglage, le relais écoute sur chaque réseau du conteneur, comme l’API. Pour qu’il n’écoute que sur le réseau sandbox, comme le prévoit `tale deploy`, donne à `SANDBOX_NETWORK_SUBNET`, dans le `.env`, le sous-réseau de ce réseau, qu’affiche `docker network inspect tale-sandbox-net --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'` une fois le réseau créé. Relis-le chaque fois que le réseau est recréé : un backend sans adresse dans ce sous-réseau ne démarre pas.

Configure `BACKEND_UPSTREAM=backend-api:3005` sur le proxy. Pour le stockage fourni, définis `OBJECT_STORE_UPSTREAM=object-store:9000` et le même `OBJECT_STORE_BUCKET` dans le proxy et le backend. Publie les ports 80/443 du proxy ; garde bases, administration du stockage, relais de modèles et API sandbox privés. Préserve un transfert fiable des informations client si un autre proxy se trouve en amont.

## Monter l’état persistant et les capacités requises

| Ressource | Montages ou réglages requis |
| --- | --- |
| Configuration des organisations | `config-data:/app/data` en lecture-écriture dans les rôles backend, en lecture seule dans `platform` ; en lecture seule sous `/app/platform-config` dans le spawner. |
| Données applicatives et connaissances fournies | `db-data:/var/lib/postgresql/data` ; un service de connaissances séparé demande son propre volume persistant. |
| Stockage objet fourni | `blob-data:/data` et la commande de versitygw, `command: --port :9000 --health /_health --quiet posix --fsync /data`, avec laquelle un envoi est écrit sur le disque avant que versitygw ne le confirme. Le système de fichiers du volume doit conserver les attributs étendus : versitygw y stocke le type de contenu et l’ETag de chaque objet. Un stack encore sous MinIO garde `object-store-data:/data` et `command: server /data`. |
| Certificats et état du proxy | `caddy-data:/data`, `caddy-config:/config`. |
| Spawner | `/var/run/docker.sock` et `/var/lib/tale-sandbox` montés aux mêmes chemins hôte/conteneur. Le socket Docker donne le contrôle du daemon de l’hôte. |
| Rôles backend | `cap_add: [NET_ADMIN]` pour le filtrage réseau du point d’entrée fourni. |
| Service de sortie | Après retrait de toutes les autres capacités : `NET_ADMIN`, `DAC_OVERRIDE`, `CHOWN`, `SETUID`, `SETGID`, `NET_BIND_SERVICE` et `KILL`. Sans `KILL`, le superviseur root ne peut plus signaler tinyproxy une fois passé à `nobody` : un arrêt attend la fin du délai de grâce et se termine en exit 137 au lieu de se vider proprement. |
| IPv6 de sortie | `sysctls` avec `net.ipv6.conf.all.disable_ipv6: '1'` et `net.ipv6.conf.default.disable_ipv6: '1'`, comme dans le stack fourni. Le pare-feu egress fonctionne en fail-closed : il exige un pare-feu IPv6 fonctionnel ou IPv6 désactivé pour la valeur par défaut et chaque interface, et un conteneur ne peut pas écrire ces sysctls lui-même à travers un `/proc/sys` en lecture seule. Sans elles, le proxy refuse de démarrer sur un noyau sans le module `ip6_tables` ; voir [Infrastructure sandbox](/fr/self-hosted/configuration/environment-reference#sandbox-infrastructure). |
| Arrêt Postgres | `stop_signal: SIGINT`, `stop_grace_period: 60s`, `shm_size: 256mb` dans la référence. |
| Arrêt web, backend et spawner | Délais de grâce de 45 secondes pour le web, 30 pour `backend-api`, 120 pour `backend-worker` et 30 pour le spawner. Un worker transmet ses exécutions d’automatisation pendant ce délai (`SHUTDOWN_DRAIN_MS`) ; coordonner le reste du travail actif avant l’arrêt. |
| Réservations de mémoire | `mem_reservation` (cgroup v2 `memory.low`) dans la pile fournie, par conteneur, la part de chaque service dans le budget mémoire de l’hôte : `db` `120m`, `platform` `64m`, `backend-api` `128m`, `backend-worker` `64m`, `object-store` `35m`, `proxy` `35m`, `sandbox` `20m` et `sandbox-egress` `10m`. Une variable propre remplace chacune d’elles, comme l’indique la [référence d’environnement](/fr/self-hosted/configuration/environment-reference#memory-reservations) ; `0` ne réserve rien. versitygw et l’edge reçoivent en outre `GOMEMLIMIT: 28MiB` et `mem_limit: 140m`, soit 80 pour cent et quatre fois leur réservation : modifie les deux avec elle. Tant que les sessions d’agent pèsent sur la mémoire de l’hôte, la récupération de mémoire épargne cette quantité à chaque service. Cela ne tient que si le cgroup parent de Docker reçoit lui aussi au moins leur somme, ce qu’aucun réglage par défaut ne fait : avec le pilote cgroup systemd, exécute `systemctl set-property system.slice MemoryLow=476M` (la somme des valeurs par défaut). Sur un hôte en cgroup v1, Docker fait d’une réservation une limite souple, qui reprend d’abord la mémoire d’un service au-delà : mets-y les huit à `0` dans ton propre fichier Compose. `tale deploy` demande à Docker sa version de cgroup et laisse de lui-même les réservations de côté en cgroup v1, et là où Docker n’en signale aucune, avec un avertissement. Donne leur somme au spawner dans [`SANDBOX_RESERVED_MEMORY`](/fr/self-hosted/configuration/environment-reference#sandbox-infrastructure) ; `tale deploy` le fait lui-même. |

Conserve `db-backup` si tes outils écrivent dans `/var/lib/postgresql/backup` ; un montage seul ne programme aucune sauvegarde. Les anciens volumes de configuration `convex-data` demandent un transfert délibéré vers `config-data`, pas leur suppression. Garde l’ancienne copie jusqu’à vérification.

## Utiliser les bonnes sondes

| Service | Sonde | Signification |
| --- | --- | --- |
| `backend-api` | `curl -sf http://localhost:3005/ping` | Processus actif ; reste disponible pendant le drainage. |
| `backend-api` | `GET /ready` sur le port 3005 | Acceptation de nouveau travail, distincte de la santé des stockages externes. |
| `platform` | `curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]` | Démarrage web terminé. |
| `backend-worker` | Désactiver la sonde web de l’image. | Aucun serveur HTTP ; surveiller les jobs et la progression séparément. |
| `proxy` | `curl -sf http://127.0.0.1:2020/health` | Le proxy répond. |
| `db` | `pg_isready -U tale && [ -f /tmp/.db_ready ]` | Postgres et initialisation prêts ; adapter l’utilisateur. |
| `object-store` | `wget -q -O /dev/null http://127.0.0.1:9000/_health` | versitygw répond sur sa route de santé. La sonde de MinIO est `mc ready local`. |
| `sandbox` | `curl -fsS http://127.0.0.1:8003/health` | Spawner prêt après préparation de l’image d’exécution. |
| `sandbox-egress` | `curl -sS -o /dev/null --max-time 3 --noproxy '*' http://127.0.0.1:3128/ && nslookup -type=a -timeout=1 sandbox-egress-health.invalid 127.0.0.1` | Le proxy répond lui-même à une requête non proxy (page 400) : cela prouve qu’il sert, sans dépendance à un site tiers. Puis dnsmasq répond à un nom tiré de sa propre configuration : cela prouve que le relais DNS des conteneurs imbriqués et des builds répond, sans interroger de résolveur en amont. Ne sonde pas le port par une simple connexion TCP : tinyproxy journalise chaque connexion-fermeture comme une erreur, une ligne par intervalle. |

Prévois assez de temps pour un démarrage à froid : le téléchargement de l’environnement sandbox peut dépasser un délai adapté à un hôte déjà préparé. Une sonde réussie ne prouve ni accès aux fichiers, ni identifiants de modèle, ni parcours utilisateur complet. Vérifie-les séparément.

## Connecter des stockages externes

Une base applicative externe remplace `DATABASE_URL` ; les connaissances utilisent `KNOWLEDGE_DATABASE_URL`. Cette dernière demande pgvector et, pour la recherche hybride complète, pg_search. Fournis une connexion compatible avec les sessions et, si nécessaire, `POSTGRES_CA_FILE`. Ne suppose pas qu’un pooler par transaction conserve le comportement requis.

Pour un stockage compatible S3 externe, définis explicitement `OBJECT_STORE_*` et le point d’accès navigateur. AWS S3 peut utiliser un point d’accès personnalisé vide ; d’autres stockages demandent path-style. Prépare permissions et CORS, puis teste réellement envoi et téléchargement. Retire seulement les services fournis devenus inutiles et leurs références `depends_on`. Garde les anciens volumes jusqu’à validation de la migration.

Changer les URL ne migre pas les lignes ou fichiers existants. [Résidence des données](/fr/self-hosted/configuration/data-residency) décrit les choix par organisation et déploiement. Les stockages externes exigent des sauvegardes coordonnées hors des archives de volumes de `tale backup`.

## Démarrer et valider l’installation

Démarre les stockages avant leurs dépendants et utilise des règles de redémarrage comme `unless-stopped`. Prépare `VERSION` dans le shell comme indiqué plus haut, puis valide ton Compose complet :

```bash
docker compose config --quiet
docker pull "ghcr.io/tale-project/tale/tale-sandbox-runtime:$VERSION"
docker compose up -d
docker compose ps
docker compose logs --tail=100 backend-api backend-worker
```

Confirme santé des services, migrations backend réussies et progression des workers. Ouvre l’URL publique, suis [Premier administrateur](/fr/self-hosted/install/first-admin), configure fournisseur et modèle d’embedding, puis teste de façon contrôlée chat, import/téléchargement et recherche. Si tu utilises des environnements d’agent, vérifie aussi une session sandbox.

Les migrations de base s’exécutent au démarrage du backend. Ton processus doit maintenir des versions compatibles pendant cette étape, s’arrêter en cas d’échec, drainer le travail actif avant remplacement et conserver l’état nécessaire à la reprise. Copier la répartition des services n’active pas la coordination bleu-vert, la reprise de bascule, les snapshots automatiques ni les contrôles de rollback de la CLI.

## Transposer le contrat à Kubernetes

[Déployer sur Kubernetes](/fr/self-hosted/install/kubernetes) transpose ce contrat en Deployments, Services, StatefulSets et NetworkPolicies, bascule le spawner de sandbox sur `SANDBOX_BACKEND=kubernetes` et liste les vérifications qu’un cluster doit réussir avant d’accueillir des utilisateurs. Cette page reste la référence pour les noms de services, les volumes, les sondes et les variables d’environnement que les objets Kubernetes doivent reproduire.

## Déplacer les blobs de MinIO vers versitygw {#blob-store}

versitygw ne sait pas lire le volume de MinIO : MinIO conserve les objets dans un format qui lui est propre, alors que versitygw conserve chaque objet comme un fichier. Un stack qui exécute MinIO continue de fonctionner avec lui. Pour déplacer les blobs, copie chaque bucket via S3 vers un versitygw installé sur un nouveau volume, comme le fait `tale deploy --stop` pour un workspace. L’application continue de fonctionner pendant la première copie et s’arrête pour la dernière.

Vérifie d’abord le système de fichiers du nouveau volume. Il lui faut la place du volume de MinIO et une marge, car les deux restent sur le disque jusqu’à ce que tu supprimes celui de MinIO. Il doit aussi conserver les attributs étendus : sans eux, versitygw servirait chaque fichier sans son type de contenu ni son ETag.

1. Ajoute versitygw comme second service, sur un volume qui lui est propre, avec la clé et la région du stockage, puis démarre-le :

   ```yaml
   services:
     object-store-next:
       image: ghcr.io/versity/versitygw:v1.11.0@sha256:8319a530d08d537426e2f855bae5280709795dc73a3f0c347973ef915d6343c5
       command: --port :9000 --health /_health --quiet posix --fsync /data
       environment:
         ROOT_ACCESS_KEY: ${OBJECT_STORE_ACCESS_KEY}
         ROOT_SECRET_KEY: ${OBJECT_STORE_SECRET_KEY}
         VGW_REGION: ${OBJECT_STORE_REGION:-us-east-1}
       volumes:
         - blob-data:/data
       networks: [internal]
   volumes:
     blob-data:
   ```

   ```bash
   docker compose up -d object-store-next
   ```

2. Copie chaque bucket pendant que l’application continue de fonctionner. L’image de MinIO contient le client `mc`, et son conteneur la clé. Note l’heure que la commande affiche après `began=` :

   ```bash
   docker compose exec object-store bash -c '
     mc alias set src http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
     mc alias set dst http://object-store-next:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
     echo "began=$(date +%s)" &&
     mc mirror --retry src dst'
   ```

3. Arrête le proxy et l’application, pour que plus rien n’écrive dans le stockage :

   ```bash
   docker compose stop proxy platform backend-api backend-worker
   ```

4. Copie ce qui a été écrit depuis le début de la première copie, supprime ce qui a été effacé, puis liste le contenu des deux côtés. Remplace `<time>` par l’heure notée à l’étape 2 :

   ```bash
   docker compose exec object-store bash -c '
     began=<time> &&
     mc alias set src http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
     mc alias set dst http://object-store-next:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" &&
     mc mirror --retry --overwrite --remove --newer-than "$(( $(date +%s) - began + 60 ))s" src dst &&
     mc du --depth 2 src && mc du --depth 2 dst'
   ```

   Les deux listes doivent montrer les mêmes buckets, chacun avec le même nombre d’objets et la même taille. `--newer-than` limite la copie à ce qui a changé depuis le début de la première copie, plus une minute. Sans cette option, `mc` copie de nouveau chaque objet, car versitygw ne liste pas les détails que `mc` compare.

5. Supprime le second service, puis bascule `object-store` sur versitygw : son image, sa commande, son environnement, son volume et sa sonde, comme dans les tableaux plus haut. Retire `object-store-next` du fichier Compose et démarre le stack :

   ```bash
   docker compose rm -s -f object-store-next
   docker compose up -d
   ```

6. Télécharge quelques fichiers connus et ouvre-les. Garde le volume de MinIO jusqu’à ce que ta prochaine sauvegarde inclue `blob-data`, puis supprime-le avec `docker volume rm`.

Sur Kubernetes, les étapes sont les mêmes. Exécute versitygw comme second Deployment et second Service, nommés `object-store-next`, sur un nouveau claim, `blob-data`. Lance les copies avec `kubectl -n tale exec deploy/object-store -- bash -c '…'`, et arrête `proxy`, `platform`, `backend-api` et `backend-worker` avec `kubectl -n tale scale --replicas=0`. Bascule ensuite sur le stockage que décrit [Exécuter les stockages](/fr/self-hosted/install/kubernetes#run-the-stores).
