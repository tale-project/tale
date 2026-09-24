---
title: Déployer sur Kubernetes
description: Applique un jeu complet de manifestes Kubernetes pour Tale, exécute le spawner de sandbox sur son backend natif et vérifie l’isolation, le cycle de vie des sessions et les mises à jour avant d’accueillir des utilisateurs.
---

Tale fonctionne sur Kubernetes lorsque tu transposes le [contrat de services](/fr/self-hosted/install/own-compose) en Deployments, Services et volumes, et que tu bascules le spawner de sandbox sur `SANDBOX_BACKEND=kubernetes`. Il n’existe pas de chart Helm officiel. Ce guide fournit un jeu complet de manifestes pour un seul namespace, vérifié de bout en bout avec Tale 0.5.31 sur un cluster à un seul nœud, ainsi que les vérifications qui prouvent le résultat. Le cluster, son stockage, son point d’entrée public et la procédure de mise à jour restent sous ta responsabilité.

## Vérifier les prérequis

| Prérequis | Pourquoi il compte |
| --- | --- |
| Un CNI qui applique NetworkPolicy, comme Calico, Cilium ou kube-network-policies | La barrière de sortie des sandboxes et celle du backend sont des objets NetworkPolicy. Tout serveur d’API les accepte ; seul le CNI bloque réellement le trafic. |
| Une StorageClass par défaut dont les volumes `ReadWriteOnce` se rattachent là où un Pod est planifié | La base de données, le stockage d’objets, les certificats du proxy, l’état de la passerelle et chaque workspace de sandbox vivent sur des PersistentVolumeClaims. |
| Un stockage `ReadWriteMany`, ou un seul nœud, pour la configuration des organisations | Les rôles backend écrivent `config-data` ; la couche web et le spawner le lisent. Sur un nœud, `ReadWriteOnce` suffit. Plusieurs nœuds exigent `ReadWriteMany` ou l’épinglage de ces Pods sur un nœud. |
| Des nœuds qui accordent `NET_ADMIN` et fournissent ip6tables, ou autorisent les sysctls IPv6 | Le proxy de sortie installe son pare-feu au démarrage et refuse de démarrer sans lui. |
| Les ports 80 et 443 joignables à l’adresse publique | Caddy obtient lui-même les certificats en mode `selfsigned` et `letsencrypt`. Derrière un Ingress qui termine TLS, définis `TLS_MODE=external`. |
| Un accès en lecture à `ghcr.io/tale-project/tale/*` sur chaque nœud, y compris pour l’image du runtime sandbox | Les Pods de session démarrent depuis `SANDBOX_RUNTIME_IMAGE`. Un nœud qui ne peut pas la récupérer fait échouer la première session qui y est planifiée. |
| Une RuntimeClass sysbox ou kata si les agents ont besoin de Docker dans leur sandbox | Sans elle, garde `SANDBOX_DOCKER_IN_CONTAINER=false`. Le niveau `runc` exigerait des Pods privilégiés. |
| `kubectl` et `envsubst` sur la machine qui applique les manifestes | Les manifestes contiennent une variable `${VERSION}` que kubectl ne développe pas. |

Réserve de la mémoire pour les rôles applicatifs plus une session d’agent par tâche simultanée ; `SANDBOX_AGENT_MEMORY` et les autres limites de session sont décrites dans la [référence d’environnement](/fr/self-hosted/configuration/environment-reference#sandbox-infrastructure).

## Organiser le namespace

Tous les services s’exécutent dans un seul namespace, `tale`. Les Pods de session doivent joindre directement `backend-api` et `sandbox-llm-gateway`, et la barrière de sortie que le spawner installe n’autorise que le namespace dans lequel il s’exécute : les rôles applicatifs doivent donc s’y trouver aussi. Les noms de Services reprennent les noms de services Compose : les images résolvent `db`, `knowledge-db`, `object-store`, `backend-api`, `platform`, `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` avec son alias `llm-gateway`, et `bgutil-provider` par leur nom.

<Warning>

Chaque Pod ci-dessous définit `enableServiceLinks: false`. Sinon, Kubernetes injecte pour chaque Service du namespace des variables à la manière de Docker, comme `SANDBOX_PORT=tcp://10.96.6.49:8003` et `DB_PORT=tcp://10.96.150.113:5432`. Le spawner lit `SANDBOX_PORT` comme son port d’écoute et s’arrête au démarrage, et l’image de la plateforme dérive son URL de base de données de `DB_PORT`.

</Warning>

| Service Compose | Objets Kubernetes | Remarques |
| --- | --- | --- |
| `db` avec l’alias `knowledge-db` | StatefulSet `db` ; Services `db` et `knowledge-db` sélectionnant le même Pod | `TALE_DB_ROLE` reste vide : l’image crée les deux bases et applique les migrations de connaissances ; le backend migre le schéma applicatif au démarrage. Un `emptyDir` en mémoire de 256 Mio sert de `/dev/shm`. L’image s’arrête sur `SIGINT` dans un délai de 60 secondes. |
| `object-store` | Deployment avec la stratégie `Recreate`, PVC sur `/data`, Service sur 9000 | Le backend crée le bucket au démarrage. |
| `platform` | Deployment ; Service sur 3000 | `config-data` en lecture seule, `TALE_BACKEND_URL=http://backend-api:3005`. |
| `backend-api` | Deployment à deux réplicas ; Service sur 3005 | `config-data` en lecture-écriture. Deux réplicas permettent une mise à jour sans interruption. |
| `backend-worker` | Deployment | Ni Service ni sonde HTTP. |
| `proxy` | Deployment avec la stratégie `Recreate` ; `hostPort` 80 et 443 ; PVC pour `/data` | Le magasin de certificats survit aux redémarrages sur le PVC. |
| `sandbox` | ServiceAccount, Role, RoleBinding, Deployment ; Service sur 8003 | `SANDBOX_BACKEND=kubernetes` ; `config-data` en lecture seule sur `/app/platform-config`. Aucun socket Docker. |
| `sandbox-egress` | Deployment ; Service sur 3128 | Le jeu de capabilities livré, sans sysctls. |
| `sandbox-llm-gateway` | Deployment avec la stratégie `Recreate`, PVC sur `/app/data` ; Services `sandbox-llm-gateway` et `llm-gateway` sur 8080 | L’image s’exécute avec l’uid 1000 ; `fsGroup: 1000` lui permet d’écrire son état. |
| `bgutil-provider` | Deployment ; Service sur 4416 | Fournisseur de jetons vidéo, facultatif. |

Les sondes transposent les contrôles de santé Compose :

| Service | Sonde de démarrage | Sonde de disponibilité | Sonde de vivacité |
| --- | --- | --- | --- |
| `backend-api` | `GET /ping` sur 3005, jusqu’à cinq minutes pour les migrations | `GET /ready` sur 3005 | `GET /ping` sur 3005 |
| `platform` | `curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]`, jusqu’à trois minutes | la même commande | aucune |
| `db` | `pg_isready -U tale -d tale && [ -f /tmp/.db_ready ]`, jusqu’à trois minutes | la même commande | `pg_isready -U tale -d tale` |
| `object-store` | aucune | `mc ready local` | aucune |
| `proxy` | aucune | `GET /health` sur 2020 | aucune |
| `sandbox` | `GET /health` sur 8003 | `GET /health` sur 8003 | aucune |
| `sandbox-egress` | aucune | `curl -sS -o /dev/null --max-time 3 --noproxy '*' http://127.0.0.1:3128/` | aucune |
| `sandbox-llm-gateway` | aucune | `GET /health` sur 8080 | aucune |

Kubernetes n’a pas de `depends_on`. Un rôle backend qui démarre avant que Postgres réponde se termine une fois avec `ECONNREFUSED`, et la politique de redémarrage corrige la situation.

## Préparer les manifestes

Enregistre chaque bloc YAML des sections suivantes sous le nom de fichier indiqué à sa première ligne, dans un même répertoire. Modifie le Secret : remplace chaque espace réservé `<...>` et définis `HOST`, `SITE_URL`, `TLS_MODE` et `OBJECT_STORE_PUBLIC_ENDPOINT` pour ton adresse. Si cette adresse comporte un port non standard, reporte-le aussi dans `containerPort` et `hostPort` du proxy dans `30-proxy.yaml` ; Caddy écoute sur le port indiqué dans `SITE_URL`. Fixe ensuite une seule version pour toutes les images Tale, `0.5.31` au moment de la rédaction, et applique les fichiers dans l’ordre :

```bash
export VERSION=0.5.31
for f in 00-namespace.yaml 10-stores.yaml 20-application.yaml 30-proxy.yaml 40-sandbox.yaml; do
  envsubst '${VERSION}' < "$f" | kubectl apply -f -
done
```

`envsubst` ne remplace que `${VERSION}` ; toute autre valeur des fichiers est littérale. La même boucle réalise une mise à niveau : change `VERSION`, relance-la, et les Deployments basculent sur la nouvelle image.

## Créer l’environnement partagé

Le premier fichier contient le namespace, les valeurs communes au déploiement issues du `.env` de Compose, et le claim de configuration partagé. Génère chaque secret une seule fois et conserve-le ; `ENCRYPTION_SECRET_HEX` en particulier doit rester stable pour les valeurs déjà chiffrées. La [référence d’environnement](/fr/self-hosted/configuration/environment-reference) explique chaque variable.

```yaml
# 00-namespace.yaml
apiVersion: v1
kind: Namespace
metadata: { name: tale }
---
apiVersion: v1
kind: Secret
metadata: { name: tale-env, namespace: tale }
type: Opaque
stringData:
  HOST: tale.example.com
  SITE_URL: https://tale.example.com
  TLS_MODE: letsencrypt
  POSTGRES_USER: tale
  POSTGRES_DB: tale
  DB_PASSWORD: <generated>
  DATABASE_URL: postgresql://tale:<DB_PASSWORD>@db:5432/tale_app
  KNOWLEDGE_DB_NAME: tale_knowledge
  INSTANCE_SECRET: <openssl rand -hex 32>
  BETTER_AUTH_SECRET: <openssl rand -hex 32>
  ENCRYPTION_SECRET_HEX: <openssl rand -hex 32>
  TALE_AUDIT_SIGNING_KEY: <openssl rand -hex 32>
  TALE_AUDIT_PEPPER: <openssl rand -hex 32>
  SANDBOX_TOKEN: <openssl rand -hex 32>
  SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD: <generated>
  OBJECT_STORE_ACCESS_KEY: tale
  OBJECT_STORE_SECRET_KEY: <generated>
  OBJECT_STORE_BUCKET: tale-blobs
  OBJECT_STORE_ENDPOINT: http://object-store:9000
  OBJECT_STORE_REGION: us-east-1
  OBJECT_STORE_PUBLIC_ENDPOINT: https://tale.example.com
---
# Configuration des organisations : les rôles backend écrivent, platform et le spawner lisent.
# ReadWriteOnce suffit sur un nœud ; plusieurs nœuds exigent ReadWriteMany.
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: config-data, namespace: tale }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 2Gi } }
```

`DATABASE_URL` porte le même mot de passe que `DB_PASSWORD` ; la connexion de connaissances utilise par défaut `knowledge-db:5432/tale_knowledge` avec ce mot de passe. `SITE_URL` doit correspondre à l’adresse saisie dans le navigateur, port non standard compris.

## Exécuter les stockages

Le StatefulSet conserve le volume de données à travers les remplacements de Pod et donne à l’image l’arrêt qu’elle attend. MinIO s’exécute comme un Deployment unique sur son propre claim.

```yaml
# 10-stores.yaml
apiVersion: v1
kind: Service
metadata: { name: db, namespace: tale }
spec:
  selector: { app: db }
  ports: [{ name: pg, port: 5432, targetPort: 5432 }]
---
apiVersion: v1
kind: Service
metadata: { name: knowledge-db, namespace: tale }
spec:
  selector: { app: db }
  ports: [{ name: pg, port: 5432, targetPort: 5432 }]
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: db, namespace: tale }
spec:
  serviceName: db
  replicas: 1
  selector: { matchLabels: { app: db } }
  template:
    metadata: { labels: { app: db } }
    spec:
      enableServiceLinks: false
      terminationGracePeriodSeconds: 60
      containers:
        - name: postgres
          image: ghcr.io/tale-project/tale/tale-db:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          ports: [{ name: pg, containerPort: 5432 }]
          volumeMounts:
            - { name: data, mountPath: /var/lib/postgresql/data }
            - { name: shm, mountPath: /dev/shm }
          startupProbe:
            exec: { command: [sh, -c, 'pg_isready -U tale -d tale && [ -f /tmp/.db_ready ]'] }
            periodSeconds: 5
            failureThreshold: 36
          readinessProbe:
            exec: { command: [sh, -c, 'pg_isready -U tale -d tale && [ -f /tmp/.db_ready ]'] }
            periodSeconds: 5
          livenessProbe:
            exec: { command: [sh, -c, 'pg_isready -U tale -d tale'] }
            periodSeconds: 15
          resources:
            requests: { cpu: 250m, memory: 512Mi }
      volumes:
        - name: shm
          emptyDir: { medium: Memory, sizeLimit: 256Mi }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        resources: { requests: { storage: 20Gi } }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: object-store-data, namespace: tale }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 20Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: object-store, namespace: tale }
spec:
  selector: { app: object-store }
  ports: [{ name: s3, port: 9000, targetPort: 9000 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: object-store, namespace: tale }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: object-store } }
  template:
    metadata: { labels: { app: object-store } }
    spec:
      enableServiceLinks: false
      terminationGracePeriodSeconds: 30
      containers:
        - name: minio
          image: ghcr.io/tale-project/ops/minio:RELEASE.2025-04-22T22-12-26Z
          args: ['server', '/data', '--address', ':9000', '--console-address', ':9001']
          env:
            - name: MINIO_ROOT_USER
              valueFrom: { secretKeyRef: { name: tale-env, key: OBJECT_STORE_ACCESS_KEY } }
            - name: MINIO_ROOT_PASSWORD
              valueFrom: { secretKeyRef: { name: tale-env, key: OBJECT_STORE_SECRET_KEY } }
            - { name: MINIO_BROWSER, value: 'off' }
          ports: [{ name: s3, containerPort: 9000 }]
          volumeMounts: [{ name: data, mountPath: /data }]
          readinessProbe:
            exec: { command: [sh, -c, 'mc ready local'] }
            periodSeconds: 10
          resources:
            requests: { cpu: 100m, memory: 256Mi }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: object-store-data }
```

Pour un Postgres externe, définis `DATABASE_URL` et `KNOWLEDGE_DATABASE_URL` comme décrit dans [Connecter des stockages externes](/fr/self-hosted/install/own-compose#connecter-des-stockages-externes) et omets le StatefulSet et ses Services ; pour un bucket externe, définis les valeurs `OBJECT_STORE_*` et omets les objets MinIO.

## Exécuter les rôles applicatifs

Les trois rôles partagent l’image de la plateforme : l’API et le worker écrivent `config-data`, la couche web le lit. Le fichier contient aussi le fournisseur de jetons vidéo facultatif qu’utilise le worker ; retire ses deux objets si tu n’ingères pas de vidéos.

<Warning>

Les rôles backend s’exécutent sans `NET_ADMIN` et avec `TALE_SKIP_SSRF_FIREWALL=1`. Avec cette capability, l’image installe sa barrière de sortie iptables, qui n’accepte que les sous-réseaux directement connectés au Pod et rejette le reste de l’espace d’adressage privé. Sur un réseau de Pods, cela rejette aussi le DNS du cluster et chaque adresse de Service : le rôle échoue avec `getaddrinfo EAI_AGAIN db` et redémarre jusqu’à ce que tu retires la capability. La NetworkPolicy à la fin du fichier assure la barrière à la place : les rôles joignent chaque voisin du namespace, le DNS du cluster et l’internet public, jamais le service de métadonnées du cloud, les nœuds ni les réseaux privés. Étends sa dernière règle si tes fournisseurs de modèles ou tes connecteurs se trouvent sur une plage privée.

</Warning>

```yaml
# 20-application.yaml
apiVersion: v1
kind: Service
metadata: { name: backend-api, namespace: tale }
spec:
  selector: { app: backend-api }
  ports: [{ name: http, port: 3005, targetPort: 3005 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: backend-api, namespace: tale }
spec:
  replicas: 2
  selector: { matchLabels: { app: backend-api } }
  template:
    metadata: { labels: { app: backend-api, tale.tier: backend } }
    spec:
      enableServiceLinks: false
      terminationGracePeriodSeconds: 45
      containers:
        - name: backend-api
          image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          env:
            - { name: TALE_ROLE, value: api }
            - { name: PORT, value: '3005' }
            - { name: TALE_CONFIG_DIR, value: /app/data }
            - { name: SANDBOX_URL, value: http://sandbox:8003 }
            - { name: SANDBOX_HTTP_API_BASE_URL, value: http://backend-api:3005 }
            - { name: TALE_SKIP_SSRF_FIREWALL, value: '1' }
          ports: [{ name: http, containerPort: 3005 }]
          volumeMounts: [{ name: config-data, mountPath: /app/data }]
          startupProbe:
            httpGet: { path: /ping, port: 3005 }
            periodSeconds: 5
            failureThreshold: 60
          readinessProbe:
            httpGet: { path: /ready, port: 3005 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /ping, port: 3005 }
            periodSeconds: 10
          resources:
            requests: { cpu: 500m, memory: 1Gi }
      volumes:
        - name: config-data
          persistentVolumeClaim: { claimName: config-data }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: backend-worker, namespace: tale }
spec:
  replicas: 1
  selector: { matchLabels: { app: backend-worker } }
  template:
    metadata: { labels: { app: backend-worker, tale.tier: backend } }
    spec:
      enableServiceLinks: false
      terminationGracePeriodSeconds: 45
      containers:
        - name: backend-worker
          image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          env:
            - { name: TALE_ROLE, value: worker }
            - { name: TALE_CONFIG_DIR, value: /app/data }
            - { name: SANDBOX_URL, value: http://sandbox:8003 }
            - { name: SANDBOX_HTTP_API_BASE_URL, value: http://backend-api:3005 }
            - { name: TALE_SKIP_SSRF_FIREWALL, value: '1' }
          volumeMounts: [{ name: config-data, mountPath: /app/data }]
          resources:
            requests: { cpu: 500m, memory: 1Gi }
      volumes:
        - name: config-data
          persistentVolumeClaim: { claimName: config-data }
---
apiVersion: v1
kind: Service
metadata: { name: platform, namespace: tale }
spec:
  selector: { app: platform }
  ports: [{ name: http, port: 3000, targetPort: 3000 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: platform, namespace: tale }
spec:
  replicas: 1
  selector: { matchLabels: { app: platform } }
  template:
    metadata: { labels: { app: platform } }
    spec:
      enableServiceLinks: false
      terminationGracePeriodSeconds: 45
      containers:
        - name: platform
          image: ghcr.io/tale-project/tale/tale-platform:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          env:
            - { name: TALE_BACKEND_URL, value: http://backend-api:3005 }
            - { name: TALE_CONFIG_DIR, value: /app/data }
          ports: [{ name: http, containerPort: 3000 }]
          volumeMounts: [{ name: config-data, mountPath: /app/data, readOnly: true }]
          startupProbe:
            exec: { command: [sh, -c, 'curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]'] }
            periodSeconds: 5
            failureThreshold: 36
          readinessProbe:
            exec: { command: [sh, -c, 'curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]'] }
            periodSeconds: 5
          resources:
            requests: { cpu: 250m, memory: 512Mi }
      volumes:
        - name: config-data
          persistentVolumeClaim: { claimName: config-data }
---
apiVersion: v1
kind: Service
metadata: { name: bgutil-provider, namespace: tale }
spec:
  selector: { app: bgutil-provider }
  ports: [{ name: http, port: 4416, targetPort: 4416 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: bgutil-provider, namespace: tale }
spec:
  replicas: 1
  selector: { matchLabels: { app: bgutil-provider } }
  template:
    metadata: { labels: { app: bgutil-provider } }
    spec:
      enableServiceLinks: false
      automountServiceAccountToken: false
      containers:
        - name: provider
          image: brainicism/bgutil-ytdlp-pot-provider:1.3.1
          ports: [{ name: http, containerPort: 4416 }]
          readinessProbe:
            tcpSocket: { port: 4416 }
            periodSeconds: 30
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits: { memory: 512Mi }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: tale-backend-egress, namespace: tale }
spec:
  podSelector:
    matchLabels: { tale.tier: backend }
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector: {}
    - to:
        - namespaceSelector: {}
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 169.254.0.0/16
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
```

Les conteneurs de la plateforme démarrent en root, corrigent la propriété de `/app/data` puis passent à l’utilisateur applicatif ; ne leur impose pas `runAsNonRoot`.

## Exposer le proxy

Le proxy est le seul service public. Il occupe les `hostPort` 80 et 443 du nœud où il s’exécute ; fais pointer le nom public vers l’adresse de ce nœud. Caddy écoute sur le port indiqué dans `SITE_URL` : avec `https://tale.example.com:8443`, le Pod doit exposer 8443 au lieu de 443, tandis que le port 80 continue de servir la redirection vers HTTPS. La stratégie est `Recreate` : deux Pods de proxy ne peuvent partager ni un `hostPort` ni un volume `ReadWriteOnce`.

```yaml
# 30-proxy.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: caddy-data, namespace: tale }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: proxy, namespace: tale }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: proxy } }
  template:
    metadata: { labels: { app: proxy } }
    spec:
      enableServiceLinks: false
      containers:
        - name: caddy
          image: ghcr.io/tale-project/tale/tale-proxy:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          env:
            - { name: BACKEND_UPSTREAM, value: 'backend-api:3005' }
            - { name: OBJECT_STORE_UPSTREAM, value: 'object-store:9000' }
          ports:
            - { name: http, containerPort: 80, hostPort: 80 }
            - { name: https, containerPort: 443, hostPort: 443 }
          volumeMounts:
            - { name: caddy-data, mountPath: /data }
            - { name: caddy-config, mountPath: /config }
          readinessProbe:
            httpGet: { path: /health, port: 2020 }
            periodSeconds: 10
          resources:
            requests: { cpu: 50m, memory: 64Mi }
      volumes:
        - name: caddy-data
          persistentVolumeClaim: { claimName: caddy-data }
        - name: caddy-config
          emptyDir: {}
```

Deux alternatives conservent le même Pod :

- Un Service LoadBalancer sur 80 et 443 devant le proxy, à la place des entrées `hostPort`. `TLS_MODE=selfsigned` et `letsencrypt` fonctionnent tels quels ; le proxy sert aussi `docs.<HOST>` et obtient ce certificat.
- Un Ingress qui termine TLS. Définis `TLS_MODE=external` et `TRUSTED_PROXIES` sur la plage d’adresses de l’Ingress pour que les en-têtes transmis soient acceptés, comme décrit dans [TLS et domaines](/fr/self-hosted/configuration/tls-and-domains).

## Exécuter la couche sandbox

Le proxy de sortie a besoin du jeu de capabilities du contrat Compose et d’aucun sysctl : le script d’entrée installe le pare-feu IPv6 avec ip6tables lorsque le noyau du nœud le fournit, et désactive sinon IPv6 dans son propre espace de noms réseau. Un cluster qui refuse les deux bloque le Pod au démarrage ; autorise dans ce cas les sysctls `net.ipv6.conf.*` sur le kubelet. Le spawner crée les Pods de session, les Secrets et les claims de workspace via l’API Kubernetes ; il s’exécute donc avec une Role limitée au namespace et sans socket Docker.

```yaml
# 40-sandbox.yaml
apiVersion: v1
kind: Service
metadata: { name: sandbox-egress, namespace: tale }
spec:
  selector: { app: sandbox-egress }
  ports: [{ name: proxy, port: 3128, targetPort: 3128 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: sandbox-egress, namespace: tale }
spec:
  replicas: 1
  selector: { matchLabels: { app: sandbox-egress } }
  template:
    metadata: { labels: { app: sandbox-egress } }
    spec:
      enableServiceLinks: false
      automountServiceAccountToken: false
      containers:
        - name: egress
          image: ghcr.io/tale-project/tale/tale-sandbox-egress:${VERSION}
          securityContext:
            runAsUser: 0
            capabilities:
              drop: ['ALL']
              add: ['NET_ADMIN', 'DAC_OVERRIDE', 'CHOWN', 'SETUID', 'SETGID', 'NET_BIND_SERVICE', 'KILL']
          ports: [{ name: proxy, containerPort: 3128 }]
          readinessProbe:
            exec: { command: [sh, -c, "curl -sS -o /dev/null --max-time 3 --noproxy '*' http://127.0.0.1:3128/"] }
            periodSeconds: 10
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits: { memory: 512Mi }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: llm-gateway-data, namespace: tale }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: v1
kind: Service
metadata: { name: sandbox-llm-gateway, namespace: tale }
spec:
  selector: { app: sandbox-llm-gateway }
  ports: [{ name: http, port: 8080, targetPort: 8080 }]
---
apiVersion: v1
kind: Service
metadata: { name: llm-gateway, namespace: tale }
spec:
  selector: { app: sandbox-llm-gateway }
  ports: [{ name: http, port: 8080, targetPort: 8080 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: sandbox-llm-gateway, namespace: tale }
spec:
  replicas: 1
  strategy: { type: Recreate }
  selector: { matchLabels: { app: sandbox-llm-gateway } }
  template:
    metadata: { labels: { app: sandbox-llm-gateway } }
    spec:
      enableServiceLinks: false
      automountServiceAccountToken: false
      securityContext: { fsGroup: 1000 }
      containers:
        - name: gateway
          image: ghcr.io/tale-project/tale/tale-sandbox-llm-gateway:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          ports: [{ name: http, containerPort: 8080 }]
          volumeMounts: [{ name: data, mountPath: /app/data }]
          readinessProbe:
            httpGet: { path: /health, port: 8080 }
            periodSeconds: 10
          resources:
            requests: { cpu: 50m, memory: 128Mi }
            limits: { memory: 512Mi }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: llm-gateway-data }
---
apiVersion: v1
kind: ServiceAccount
metadata: { name: tale-sandbox-spawner, namespace: tale }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: tale-sandbox-spawner, namespace: tale }
rules:
  - apiGroups: ['']
    resources: ['pods']
    verbs: ['create', 'get', 'list', 'delete', 'patch']
  - apiGroups: ['']
    resources: ['secrets']
    verbs: ['create', 'delete', 'list']
  - apiGroups: ['']
    resources: ['persistentvolumeclaims']
    verbs: ['get', 'create', 'delete']
  - apiGroups: ['networking.k8s.io']
    resources: ['networkpolicies']
    verbs: ['create', 'update']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: tale-sandbox-spawner, namespace: tale }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: Role, name: tale-sandbox-spawner }
subjects: [{ kind: ServiceAccount, name: tale-sandbox-spawner, namespace: tale }]
---
apiVersion: v1
kind: Service
metadata: { name: sandbox, namespace: tale }
spec:
  selector: { app: sandbox }
  ports: [{ name: http, port: 8003, targetPort: 8003 }]
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: sandbox, namespace: tale }
spec:
  replicas: 1
  selector: { matchLabels: { app: sandbox } }
  template:
    metadata: { labels: { app: sandbox } }
    spec:
      enableServiceLinks: false
      serviceAccountName: tale-sandbox-spawner
      terminationGracePeriodSeconds: 30
      containers:
        - name: spawner
          image: ghcr.io/tale-project/tale/tale-sandbox:${VERSION}
          envFrom: [{ secretRef: { name: tale-env } }]
          env:
            - { name: SANDBOX_BACKEND, value: kubernetes }
            - { name: SANDBOX_K8S_NAMESPACE, value: tale }
            - { name: SANDBOX_RUNTIME_IMAGE, value: 'ghcr.io/tale-project/tale/tale-sandbox-runtime:${VERSION}' }
            - { name: NODE_EXTRA_CA_CERTS, value: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt }
            - { name: SANDBOX_RUNTIME, value: runc }
            - { name: SANDBOX_DOCKER_IN_CONTAINER, value: 'false' }
            - { name: SANDBOX_EGRESS_PROXY, value: 'http://sandbox-egress:3128' }
          ports: [{ name: http, containerPort: 8003 }]
          volumeMounts: [{ name: config-data, mountPath: /app/platform-config, readOnly: true }]
          startupProbe:
            httpGet: { path: /health, port: 8003 }
            periodSeconds: 5
            failureThreshold: 24
          readinessProbe:
            httpGet: { path: /health, port: 8003 }
            periodSeconds: 10
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { memory: 512Mi }
      volumes:
        - name: config-data
          persistentVolumeClaim: { claimName: config-data }
```

| Paramètre | Exigence |
| --- | --- |
| `SANDBOX_BACKEND` | `kubernetes`. Les chemins hôte et noms de bridges propres à Docker ne configurent pas ce backend. |
| `SANDBOX_K8S_NAMESPACE` | Le namespace où sont créés les Pods de session, les Secrets et les claims de workspace ; dans cette organisation, celui du spawner lui-même. `tale-sandbox` par défaut. |
| `SANDBOX_RUNTIME_IMAGE` | L’image du runtime sandbox Tale correspondante, accessible à chaque nœud. |
| `NODE_EXTRA_CA_CERTS` | Le fichier CA du cluster, généralement `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt` dans le spawner. C’est le seul mécanisme de confiance CA que le spawner respecte ; garde la vérification TLS active. |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT` | La taille de chaque claim de workspace `/agent`, `4Gi` par défaut ; limite aussi le stockage temporaire du Docker interne lorsqu’il est activé. |
| `SANDBOX_K8S_CACHE_STORAGECLASS` | La StorageClass des claims de workspace ; sans valeur, celle du cluster s’applique. |
| `SANDBOX_RUNTIME` / `SANDBOX_RUNTIME_CLASS` | Un niveau de runtime pris en charge et, si nécessaire, le nom de la RuntimeClass installée. |
| `SANDBOX_EGRESS_PROXY` | Le Service de sortie utilisé par les sessions, `http://sandbox-egress:3128` par défaut. |

Le spawner se met à l’échelle horizontalement. Chaque réplica retrouve une session qu’il n’a pas créée grâce au nom déterministe de son Pod et l’adopte ; exec, arrêt et destruction fonctionnent donc via le réplica que le Service choisit. `SANDBOX_MAX_SESSIONS` compte le namespace, mais des admissions simultanées sur plusieurs réplicas peuvent le dépasser brièvement ; une ResourceQuota fournit la limite stricte. Le [contrat Kubernetes des sandboxes](https://github.com/tale-project/tale/blob/main/services/sandbox/docs/kubernetes.md) documente la forme du Pod et les détails du runtime.

### Ce que le spawner impose

Au démarrage, le spawner applique la NetworkPolicy `tale-sandbox-session-egress` : les Pods de session peuvent joindre le DNS et les Pods de leur propre namespace, rien d’autre. Le service de métadonnées du cloud, les nœuds et les autres namespaces restent ainsi inaccessibles, même pour un processus qui ignore `HTTP_PROXY`. Les destinations publiques passent par `sandbox-egress`. Une permission `networkpolicies` absente est journalisée sans arrêter le spawner ; vérifie que la politique existe avant d’admettre des traitements.

Les Pods de session exécutent le runner avec l’uid 65534, toutes les capabilities retirées, un système de fichiers racine en lecture seule, sans jeton ServiceAccount, et avec le Secret de session monté uniquement comme environnement. Le workspace `/agent` est un claim qui survit à un arrêt sur inactivité ; seule une destruction explicite le supprime. Les opérations de session utilisent HTTP vers runnerd sur l’IP du Pod, port 8200 ; `pods/exec` n’intervient jamais.

<Note>

L’autorisation à l’échelle du namespace est plus large que le réseau Compose. Depuis un Pod de session, Postgres et le stockage d’objets répondent sur leurs ports de Service, même si la session ne détient aucun identifiant pour eux. Placer ces stockages dans un autre namespace resserrerait cette barrière ; cette organisation n’a pas été vérifiée et nécessite sa propre politique pour les rôles backend.

</Note>

Pour Docker dans les sessions, choisis explicitement un `SANDBOX_DIND_INNER_POOL` hors des plages Pod, Service et VPC et lis les [prérequis réseau du Docker interne](/fr/self-hosted/configuration/environment-reference#sandbox-infrastructure) ; un Pod ne peut pas découvrir tous les réseaux du cluster.

## Déployer et vérifier

Après la boucle d’application, attends que chaque Pod soit prêt et contrôle les signaux qui comptent :

```bash
kubectl -n tale get pods
kubectl -n tale logs -l 'app in (backend-api,backend-worker)' --tail=-1 | grep -c 'applying app migration'
kubectl -n tale get networkpolicy tale-sandbox-session-egress tale-backend-egress
curl -s https://tale.example.com/api/health
```

Le rôle backend qui démarre en premier applique les migrations sous un verrou consultatif ; le décompte provient donc des deux rôles réunis, et le journal de l’API se termine par `api listening on :3005` ; l’endpoint de santé répond `{"status":"ok","version":"0.5.31"}`. Ouvre ensuite le site, [crée le premier propriétaire](/fr/self-hosted/install/first-admin) et connecte un fournisseur.

Sous **Paramètres > Sandboxes**, la carte du déploiement porte le namespace comme périmètre dans son titre et n’affiche aucune mesure CPU ou mémoire de l’hôte ; c’est attendu sur ce backend. Assigne une tâche à un agent et attends son livrable : l’exécution crée dans le namespace un Pod de session nommé `tale-sbx-ses-<hash>`, accompagné d’un Secret `-spec` et d’un claim `-ws`.

Prouve la barrière depuis un Pod de session en cours :

```bash
POD=$(kubectl -n tale get pods -l tale.sandbox/role=session -o name | head -1)
kubectl -n tale exec $POD -c runner -- curl -m 5 http://169.254.169.254/
kubectl -n tale exec $POD -c runner -- curl -m 20 -s -o /dev/null -w '%{http_code}\n' https://example.com/
```

La première commande expire ; la seconde affiche `200`, obtenu via le proxy de sortie. Teste ensuite le cycle de vie tel que tu t’y fieras en exploitation : un redémarrage du runner conserve le Pod et le workspace, une session inactive s’arrête après `SANDBOX_SESSION_MAX_IDLE_MS` en laissant son claim, la tâche suivante la reprend avec ses fichiers intacts, et sa destruction supprime le Pod, le Secret et le claim. Avec deux réplicas du spawner, relance une tâche après la mise à l’échelle et confirme que le second réplica la sert.

Mets à jour l’API sans interruption en conservant deux réplicas et en redémarrant le Deployment :

```bash
kubectl -n tale rollout restart deploy/backend-api
kubectl -n tale rollout status deploy/backend-api
```

Les migrations s’exécutent au démarrage sous un verrou consultatif pendant que l’image précédente continue de servir ; l’endpoint de santé reste vert pendant toute la mise à jour. Fixe une seule `VERSION` pour toutes les images Tale et suis [Mettre à niveau et rétablir un déploiement](/fr/self-hosted/operate/upgrades) avant de la changer ; une version qui modifie l’image du proxy exige aussi de recréer le Pod du proxy.

Les snapshots, bascules bleu-vert et contrôles de rollback de la CLI ne s’exécutent pas sur Kubernetes. Sauvegarde les claims avec les snapshots de ton fournisseur de stockage et conserve avec eux le Secret, la clé de chiffrement et la configuration des organisations ; [Sauvegardes et restauration](/fr/self-hosted/operate/backups-and-restore) liste ce qu’une restauration exige.

## Périmètre vérifié

Ces cinq fichiers ont été appliqués tels quels, à l’exception des valeurs du Secret, sur un cluster kind neuf à un seul nœud, avec Kubernetes 1.36, kube-network-policies, la StorageClass local-path et Tale 0.5.31 : démarrage et migrations, point d’entrée public, création du premier propriétaire et carte Sandboxes, tâche d’agent avec livrable, cycle de vie des sessions avec arrêt sur inactivité, reprise et accès entre réplicas, les sondes de barrière ci-dessus et un redémarrage progressif de l’API à deux réplicas. La planification sur plusieurs nœuds avec un stockage de configuration `ReadWriteMany`, Docker dans les sessions sur une RuntimeClass sysbox ou kata, un Ingress avec `TLS_MODE=external` et des stockages hautement disponibles ne faisaient pas partie de cet essai.
