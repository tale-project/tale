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
| Exécution partagée | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` | Coordonner les sessions actives avant remplacement ; le spawner demande le daemon Docker et des chemins de workspace correspondants. |
| Vidéo facultative | `bgutil-provider` | Fournisseur de jetons démarré au mieux ; sa panne peut affecter les récupérations vidéo. |

Le montage fourni conserve `tale_app` et `tale_knowledge` dans un service Postgres avec l’alias `knowledge-db`. Des bases séparées ou gérées sont aussi possibles ; configure explicitement connexions et sauvegardes. Recréer un conteneur persistant ne détruit pas automatiquement ses données, mais retirer ou remplacer son volume peut le faire.

## Fixer des images compatibles

Définis `VERSION` dans le `.env` de Compose avec la release Tale examinée et testée. Exporte la même valeur dans le shell pour le téléchargement séparé de l’image d’exécution plus bas. Garde les images Tale sur une release commune ; les deux services utilisant des images amont ont leurs propres versions.

| Service | Image |
| --- | --- |
| `platform`, `backend-api`, `backend-worker` | `ghcr.io/tale-project/tale/tale-platform:<version>` |
| `proxy` | `ghcr.io/tale-project/tale/tale-proxy:<version>` |
| `db` | `ghcr.io/tale-project/tale/tale-db:<version>` |
| `sandbox` | `ghcr.io/tale-project/tale/tale-sandbox:<version>` |
| `sandbox-egress` | `ghcr.io/tale-project/tale/tale-sandbox-egress:<version>` |
| `sandbox-llm-gateway` | `ghcr.io/tale-project/tale/tale-sandbox-llm-gateway:<version>` |
| `object-store` | `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z` |
| `bgutil-provider` | `brainicism/bgutil-ytdlp-pot-provider:1.3.1` |

Les sessions utilisent aussi `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`. Définis `SANDBOX_RUNTIME_IMAGE` sur le spawner et télécharge-la avant le démarrage. Le tag local de développement par défaut ne suffit pas sur un hôte qui ne l’a jamais construite. Si tu actives Docker dans les conteneurs ou le cache de build partagé, prépare aussi les images compatibles de la [référence d’environnement](/fr/self-hosted/configuration/environment-reference).

## Préparer secrets et adresses publiques

Génère des valeurs uniques avant le premier démarrage et conserve-les dans ton gestionnaire de secrets. Ne copie pas les identifiants d’exemple d’un environnement de développement en production.

| Valeur | Exigence |
| --- | --- |
| `BETTER_AUTH_SECRET` | Secret d’authentification stable à forte entropie. |
| `ENCRYPTION_SECRET_HEX` | Valeur hexadécimale de 32 octets, par exemple via `openssl rand -hex 32` ; la conserver pour les valeurs déjà chiffrées en base. |
| `DB_PASSWORD` ou identifiants de base externe | Correspondre au rôle réellement utilisé par le backend. |
| `SANDBOX_TOKEN` | Même jeton aléatoire dans le backend et le spawner. |
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | Identifiant de gestion stable partagé avec le backend ; le nom d’utilisateur vaut `admin` par défaut. |
| `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY` | Identifiants valides pour le stockage ; les mapper sur `MINIO_ROOT_USER` et `MINIO_ROOT_PASSWORD` pour MinIO. |
| `OBJECT_STORE_PUBLIC_ENDPOINT` | Point d’accès joignable par le navigateur, généralement `SITE_URL` lorsque le proxy relaie le stockage fourni. |
| Identité age SOPS | Nécessaire aux fichiers de configuration chiffrés ; voir [Secrets avec SOPS](/fr/self-hosted/configuration/secrets-with-sops). |

Le backend synchronise au démarrage la connexion objet par défaut gérée par l’environnement. Il laisse volontairement intact un fichier `managedBy: operator`. Changer les identifiants ne déplace pas les objets et ne les rend pas intrinsèquement orphelins, mais backend et stockage doivent être d’accord. La passerelle conserve son hash de mot de passe établi ; retrouve le secret correspondant ou suis sa procédure de rotation au lieu de supprimer le volume comme dépannage courant.

Définis `HOST`, `SITE_URL` et `TLS_MODE` pour l’accès public. [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains) traite les certificats, origines supplémentaires et sous-chemins.

## Assembler la couche applicative

Les trois rôles partagent une image. `TALE_ROLE=api` et `TALE_ROLE=worker` choisissent les rôles backend ; laisse cette variable absente du service web. Ne fixe pas de `container_name` sur les rôles à répliquer.

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
| `backend-api` | Réplicas API sur les réseaux applicatif et sandbox, port 3005. |
| `knowledge-db` | Postgres de connaissances, ou une cible définie par `KNOWLEDGE_DATABASE_URL`. |
| `object-store` | MinIO fourni sur le réseau applicatif. |
| `sandbox` | Spawner accessible au backend sur le port 8003. |
| `sandbox-egress` | Proxy de sortie accessible aux sessions sur le port 3128. |
| `sandbox-llm-gateway` / `llm-gateway` | Passerelle accessible au backend et aux sessions sur le port 8080. |
| `bgutil-provider` | Fournisseur de jetons accessible au worker sur le port 4416. |

Le réseau sandbox doit être isolé des sorties directes. Le stack généré le nomme `tale-sandbox-net` ; si tu choisis un autre nom, garde `SANDBOX_EGRESS_NETWORK` cohérent avec le réseau réel. La sortie doit toujours passer par `sandbox-egress`.

Configure `BACKEND_UPSTREAM=backend-api:3005` sur le proxy. Pour le stockage fourni, définis `OBJECT_STORE_UPSTREAM=object-store:9000` et le même `OBJECT_STORE_BUCKET` dans le proxy et le backend. Publie les ports 80/443 du proxy ; garde bases, administration du stockage, passerelle et API sandbox privées. Préserve un transfert fiable des informations client si un autre proxy se trouve en amont.

## Monter l’état persistant et les capacités requises

| Ressource | Montages ou réglages requis |
| --- | --- |
| Configuration des organisations | `config-data:/app/data` en lecture-écriture dans les rôles backend, en lecture seule dans `platform` ; en lecture seule sous `/app/platform-config` dans le spawner. |
| Données applicatives et connaissances fournies | `db-data:/var/lib/postgresql/data` ; un service de connaissances séparé demande son propre volume persistant. |
| Stockage objet fourni | `object-store-data:/data` et MinIO `command: server /data`. |
| Certificats et état du proxy | `caddy-data:/data`, `caddy-config:/config`. |
| État de passerelle | `llm-gateway-data:/app/data`. |
| Spawner | `/var/run/docker.sock` et `/var/lib/tale-sandbox` montés aux mêmes chemins hôte/conteneur. Le socket Docker donne le contrôle du daemon de l’hôte. |
| Rôles backend | `cap_add: [NET_ADMIN]` pour le filtrage réseau du point d’entrée fourni. |
| Service de sortie | Après retrait des autres capacités : `NET_ADMIN`, `DAC_OVERRIDE`, `CHOWN`, `SETUID`, `SETGID`, `NET_BIND_SERVICE`. |
| Arrêt Postgres | `stop_signal: SIGINT`, `stop_grace_period: 60s`, `shm_size: 256mb` dans la référence. |
| Arrêt web et spawner | Délais de grâce de 45 secondes pour le web, 30 pour le spawner ; coordonner le travail actif avant l’arrêt. |

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
| `object-store` | `mc ready local` | Disponibilité du MinIO fourni. |
| `sandbox` | `curl -fsS http://127.0.0.1:8003/health` | Spawner prêt après préparation de l’image d’exécution. |
| `sandbox-egress` | `nc -z 127.0.0.1 3128` | Port local du proxy, sans dépendance à un site tiers. |
| `sandbox-llm-gateway` | `wget -q -O /dev/null http://127.0.0.1:8080/health` | Utiliser le client présent dans l’image ; elle ne contient pas `curl`. |

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

Confirme santé des services, migrations backend réussies et progression des workers. Ouvre l’URL publique, suis [Premier administrateur](/fr/self-hosted/install/first-admin), configure fournisseur et modèle d’embedding, puis teste de façon contrôlée chat, import/téléchargement et recherche. Si tu utilises des harnesses, vérifie aussi une session sandbox.

Les migrations de base s’exécutent au démarrage du backend. Ton processus doit maintenir des versions compatibles pendant cette étape, s’arrêter en cas d’échec, drainer le travail actif avant remplacement et conserver l’état nécessaire à la reprise. Copier la répartition des services n’active pas la coordination bleu-vert, la reprise de bascule, les snapshots automatiques ni les contrôles de rollback de la CLI.

## Transposer le contrat à Kubernetes

Utilise des Deployments et des Services stables pour les rôles applicatifs, avec un volume de configuration partagé qui prend en charge les écritures et verrouillages nécessaires. Les stockages utilisent des volumes persistants ou des services externes. Avec `SANDBOX_BACKEND=kubernetes`, le spawner crée les Pods de session et les PVC de workspace via l’API Kubernetes, sans utiliser le socket Docker de l’hôte.

### Préparer le namespace sandbox

Place les Pods de session, le proxy de sortie et la passerelle de modèles dans le namespace sandbox prévu. La StorageClass doit conserver les volumes de workspace et pouvoir les rattacher là où un Pod repris est planifié.

| Paramètre | Exigence |
| --- | --- |
| `SANDBOX_BACKEND` | `kubernetes`. Les chemins hôte et noms de bridges Docker ne configurent pas ce backend. |
| `SANDBOX_K8S_NAMESPACE` | Namespace des sessions ; `tale-sandbox` par défaut. |
| `SANDBOX_RUNTIME_IMAGE` | Image du runtime sandbox Tale correspondant, accessible aux nœuds du cluster. |
| `NODE_EXTRA_CA_CERTS` | Fichier CA du cluster, généralement `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt` dans le spawner. Conserve la vérification TLS. |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT` | Taille du PVC de workspace, `4Gi` par défaut ; limite aussi le stockage temporaire du Docker interne lorsqu’il est actif. |
| `SANDBOX_K8S_CACHE_STORAGECLASS` | StorageClass des workspaces ; sans valeur, celle du cluster s’applique. |
| `SANDBOX_RUNTIME` / `SANDBOX_RUNTIME_CLASS` | Niveau de runtime pris en charge et, si nécessaire, nom de la RuntimeClass installée. |
| `SANDBOX_EGRESS_PROXY` | Service de sortie joignable ; `http://sandbox-egress:3128` par défaut. |

Le ServiceAccount du spawner nécessite ces droits dans le namespace :

| Ressource | Verbes |
| --- | --- |
| `pods` | `create`, `get`, `list`, `delete`, `patch` |
| `secrets` | `create`, `delete`, `list` |
| `persistentvolumeclaims` | `get`, `create`, `delete` |
| `networkpolicies` dans `networking.k8s.io` | `create`, `update` |

Les opérations de session contactent runnerd par HTTP sur l’IP du Pod, au port 8200. Elles n’exigent pas `pods/exec`, et les Pods de session ne reçoivent aucun jeton ServiceAccount. Autorise les connexions nécessaires du spawner vers Kubernetes et runnerd dans tes politiques. Le [contrat Kubernetes des sandboxes](https://github.com/tale-project/tale/blob/main/services/sandbox/docs/kubernetes.md) fournit la Role et les détails du runtime.

### Vérifier l’isolation et le cycle de vie

Le spawner applique une NetworkPolicy de sortie aux Pods de session, autorisant DNS et le namespace sandbox. Ton CNI doit faire respecter NetworkPolicy. Un échec de création de cette politique est journalisé mais n’empêche pas le spawner de démarrer. Avant d’admettre des traitements, vérifie que la politique effective existe et bloque réellement une destination non autorisée. Les variables de proxy seules n’imposent pas l’isolation.

Vérifie la protection IPv6 du proxy de sortie et les [prérequis réseau du Docker interne](/fr/self-hosted/configuration/environment-reference#sandbox-infrastructure). Pour Docker imbriqué, choisis explicitement un `SANDBOX_DIND_INNER_POOL` hors des plages Pod, Service et VPC du cluster. Un Pod ne peut pas découvrir tous les réseaux du cluster.

Une session arrêtée conserve son PVC de workspace pour la reprise ; sa destruction explicite le supprime. `SANDBOX_MAX_SESSIONS` compte les sessions du namespace, mais ne garantit pas une limite stricte lors d’admissions simultanées sur plusieurs réplicas. Utilise ResourceQuota et des limites CPU/mémoire fondées sur des mesures de charge.

Teste la création, l’exécution, le redémarrage du runner, l’arrêt sur inactivité, la reprise avec les fichiers conservés et la destruction explicite. Avec plusieurs réplicas du spawner, vérifie aussi l’accès depuis un autre réplica. Prévois les sondes et l’arrêt progressif de l’application, puis observe les requêtes en cours pendant une mise à jour. La coordination Docker de la CLI ne gère pas un déploiement Kubernetes.
