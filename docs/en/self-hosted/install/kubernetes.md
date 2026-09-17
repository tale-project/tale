---
title: Deploy on Kubernetes
description: Apply a complete set of Kubernetes manifests for Tale, run the sandbox spawner on its native backend, and verify isolation, session lifecycle, and rollouts before you admit users.
---

Tale runs on Kubernetes when you translate the [service contract](/self-hosted/install/own-compose) into Deployments, Services, and volumes and switch the sandbox spawner to `SANDBOX_BACKEND=kubernetes`. There is no official Helm chart. This guide carries a complete manifest set for one namespace, verified end to end with Tale 0.5.31 on a single-node cluster, together with the checks that prove the result. You own the cluster, its storage, its public entry point, and the rollout procedure.

## Check the prerequisites

| Requirement | Why it matters |
| --- | --- |
| A CNI that enforces NetworkPolicy, such as Calico, Cilium, or kube-network-policies | The sandbox egress fence and the backend fence are NetworkPolicy objects. Every API server accepts them; only the CNI makes them block traffic. |
| A default StorageClass whose `ReadWriteOnce` volumes re-bind where a Pod is scheduled | The database, the object store, the proxy certificates, the gateway state, and every sandbox workspace live on PersistentVolumeClaims. |
| `ReadWriteMany` storage, or a single node, for the organization configuration | The backend roles write `config-data`; the web tier and the spawner read it. `ReadWriteOnce` is enough on one node. Several nodes need `ReadWriteMany` or a node pin for those Pods. |
| Nodes that grant `NET_ADMIN` and provide ip6tables, or allow the IPv6 sysctls | The egress proxy installs its firewall at start and refuses to start without it. |
| Ports 80 and 443 reachable at the public address | Caddy obtains certificates itself in `selfsigned` and `letsencrypt` mode. Behind an Ingress that terminates TLS, set `TLS_MODE=external`. |
| Pull access to `ghcr.io/tale-project/tale/*` on every node, including the sandbox runtime image | Session Pods start from `SANDBOX_RUNTIME_IMAGE`. A node that cannot pull it fails the first session scheduled there. |
| A sysbox or kata RuntimeClass if agents need Docker inside their sandbox | Without one, keep `SANDBOX_DOCKER_IN_CONTAINER=false`. The `runc` tier would need privileged Pods. |
| `kubectl` and `envsubst` on the machine that applies the manifests | The manifests carry one `${VERSION}` variable that kubectl does not expand. |

Reserve memory for the application roles plus one agent session per concurrent task; `SANDBOX_AGENT_MEMORY` and the other session limits are in the [environment reference](/self-hosted/configuration/environment-reference#sandbox-infrastructure).

## Lay out the namespace

Every service runs in one namespace, `tale`. Session Pods must reach `backend-api` and `sandbox-llm-gateway` directly, and the egress fence the spawner installs allows only the namespace it runs in, so the application roles belong there too. The Service names equal the Compose service names: the images resolve `db`, `knowledge-db`, `object-store`, `backend-api`, `platform`, `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` with its `llm-gateway` alias, and `bgutil-provider` by name.

<Warning>

Every Pod below sets `enableServiceLinks: false`. Kubernetes otherwise injects Docker-style variables for each Service in the namespace, such as `SANDBOX_PORT=tcp://10.96.6.49:8003` and `DB_PORT=tcp://10.96.150.113:5432`. The spawner reads `SANDBOX_PORT` as its listen port and exits at start, and the platform image derives its database URL from `DB_PORT`.

</Warning>

| Compose service | Kubernetes objects | Notes |
| --- | --- | --- |
| `db` with the `knowledge-db` alias | StatefulSet `db`; Services `db` and `knowledge-db` selecting the same Pod | `TALE_DB_ROLE` stays unset: the image creates both databases and applies the knowledge migrations, and the backend migrates the application schema at boot. An in-memory `emptyDir` of 256 MiB serves `/dev/shm`. The image stops on `SIGINT` within 60 seconds of grace. |
| `object-store` | Deployment with strategy `Recreate`, PVC at `/data`, Service on 9000 | The backend creates the bucket at boot. |
| `platform` | Deployment; Service on 3000 | `config-data` read-only, `TALE_BACKEND_URL=http://backend-api:3005`. |
| `backend-api` | Deployment with two replicas; Service on 3005 | `config-data` read-write. Two replicas give a rollout without a gap. |
| `backend-worker` | Deployment | No Service and no HTTP probe. |
| `proxy` | Deployment with strategy `Recreate`; `hostPort` 80 and 443; PVC for `/data` | The certificate store survives restarts on the PVC. |
| `sandbox` | ServiceAccount, Role, RoleBinding, Deployment; Service on 8003 | `SANDBOX_BACKEND=kubernetes`; `config-data` read-only at `/app/platform-config`. No Docker socket. |
| `sandbox-egress` | Deployment; Service on 3128 | The shipped capability set, no sysctls. |
| `sandbox-llm-gateway` | Deployment with strategy `Recreate`, PVC at `/app/data`; Services `sandbox-llm-gateway` and `llm-gateway` on 8080 | The image runs as uid 1000; `fsGroup: 1000` lets it write its state. |
| `bgutil-provider` | Deployment; Service on 4416 | Optional video-token provider. |

The probes translate the Compose health checks:

| Service | Startup probe | Readiness probe | Liveness probe |
| --- | --- | --- | --- |
| `backend-api` | `GET /ping` on 3005, allow five minutes for migrations | `GET /ready` on 3005 | `GET /ping` on 3005 |
| `platform` | `curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]`, allow three minutes | the same command | none |
| `db` | `pg_isready -U tale -d tale && [ -f /tmp/.db_ready ]`, allow three minutes | the same command | `pg_isready -U tale -d tale` |
| `object-store` | none | `mc ready local` | none |
| `proxy` | none | `GET /health` on 2020 | none |
| `sandbox` | `GET /health` on 8003 | `GET /health` on 8003 | none |
| `sandbox-egress` | none | TCP socket 3128 | none |
| `sandbox-llm-gateway` | none | `GET /health` on 8080 | none |

Kubernetes has no `depends_on`. A backend role that starts before Postgres answers exits once with `ECONNREFUSED`, and the restart policy heals it.

## Prepare the manifests

Save each YAML block in the following sections as the file named in its first line, in one directory. Edit the Secret: replace every `<...>` placeholder and set `HOST`, `SITE_URL`, `TLS_MODE`, and `OBJECT_STORE_PUBLIC_ENDPOINT` for your address. If that address carries a non-standard port, also set it as the proxy's `containerPort` and `hostPort` in `30-proxy.yaml`; Caddy listens on the port in `SITE_URL`. Then pin one release for every Tale image, `0.5.31` at the time of writing, and apply the files in order:

```bash
export VERSION=0.5.31
for f in 00-namespace.yaml 10-stores.yaml 20-application.yaml 30-proxy.yaml 40-sandbox.yaml; do
  envsubst '${VERSION}' < "$f" | kubectl apply -f -
done
```

`envsubst` replaces only `${VERSION}`; every other value in the files is literal. The same loop applies an upgrade: change `VERSION`, run it again, and the Deployments roll to the new image.

## Create the shared environment

The first file holds the namespace, the deployment-wide values from the Compose `.env`, and the shared configuration claim. Generate each secret once and keep it; `ENCRYPTION_SECRET_HEX` in particular must stay stable for existing encrypted values. The [environment reference](/self-hosted/configuration/environment-reference) explains every variable.

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
# Organization configuration: backend roles write, platform and spawner read.
# ReadWriteOnce is enough on one node; several nodes need ReadWriteMany.
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: config-data, namespace: tale }
spec:
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 2Gi } }
```

`DATABASE_URL` carries the same password as `DB_PASSWORD`; the knowledge connection defaults to `knowledge-db:5432/tale_knowledge` with that password. `SITE_URL` must match the address in the browser, including a non-standard port.

## Run the stores

The StatefulSet keeps the data volume across Pod replacements and gives the image the shutdown it expects. MinIO runs as a single Deployment on its own claim.

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
          image: quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z
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

For an external Postgres, set `DATABASE_URL` and `KNOWLEDGE_DATABASE_URL` as described in [Connect external stores](/self-hosted/install/own-compose#connect-external-stores) and drop the StatefulSet and its Services; for an external bucket, set the `OBJECT_STORE_*` values and drop the MinIO objects.

## Run the application roles

The three roles share the platform image: the API and the worker write `config-data`, the web tier reads it. The file also carries the optional video-token provider the worker uses; remove its two objects if you do not ingest videos.

<Warning>

The backend roles run without `NET_ADMIN` and with `TALE_SKIP_SSRF_FIREWALL=1`. With that capability the image installs its iptables egress fence, which accepts only the subnets the Pod is directly connected to and rejects the rest of the private address space. On a Pod network that rejects the cluster DNS and every Service address, so the role fails with `getaddrinfo EAI_AGAIN db` and restarts until you remove the capability. The NetworkPolicy at the end of the file provides the fence instead: the roles reach every peer in the namespace, the cluster DNS, and the public internet, and never the cloud metadata service, the nodes, or private networks. Extend its last rule when your model providers or connectors live on a private range.

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

The platform containers start as root, fix the ownership of `/app/data`, and drop to the application user; do not set `runAsNonRoot` on them.

## Expose the proxy

The proxy is the only public service. It binds `hostPort` 80 and 443 on the node it runs on, so point the public name at that node's address. Caddy listens on the port named in `SITE_URL`: with `https://tale.example.com:8443` the pod must expose 8443 instead of 443, while port 80 keeps serving the redirect to HTTPS. The strategy is `Recreate`: two proxy Pods cannot share one `hostPort` or one `ReadWriteOnce` volume.

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

Two alternatives keep the same Pod:

- A LoadBalancer Service on 80 and 443 in front of the proxy instead of the `hostPort` entries. `TLS_MODE=selfsigned` and `letsencrypt` work unchanged; the proxy also serves `docs.<HOST>` and obtains that certificate.
- An Ingress that terminates TLS. Set `TLS_MODE=external` and `TRUSTED_PROXIES` to the Ingress address range so forwarded headers are accepted, as described in [TLS and domains](/self-hosted/configuration/tls-and-domains).

## Run the sandbox tier

The egress proxy needs the capability set from the Compose contract and no sysctls: the entrypoint installs the IPv6 firewall with ip6tables when the node kernel offers it, and otherwise disables IPv6 in its own network namespace. A cluster that denies both blocks the Pod at start; allow the `net.ipv6.conf.*` sysctls on the kubelet in that case. The spawner creates session Pods, Secrets, and workspace claims through the Kubernetes API, so it runs with a namespaced Role and no Docker socket.

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
            tcpSocket: { port: 3128 }
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

| Setting | Requirement |
| --- | --- |
| `SANDBOX_BACKEND` | `kubernetes`. Docker-only host paths and bridge names do not configure this backend. |
| `SANDBOX_K8S_NAMESPACE` | The namespace the session Pods, Secrets, and workspace claims are created in; the spawner's own namespace in this layout. Defaults to `tale-sandbox`. |
| `SANDBOX_RUNTIME_IMAGE` | The matching Tale sandbox runtime image, available to every node. |
| `NODE_EXTRA_CA_CERTS` | The cluster CA file, normally `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt` inside the spawner. It is the only CA-trust mechanism the spawner honors; keep TLS verification on. |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT` | The size of each `/agent` workspace claim, default `4Gi`; also bounds the inner Docker temporary store when that is enabled. |
| `SANDBOX_K8S_CACHE_STORAGECLASS` | The StorageClass for workspace claims; unset uses the cluster default. |
| `SANDBOX_RUNTIME` / `SANDBOX_RUNTIME_CLASS` | A supported runtime tier and, when needed, the installed RuntimeClass name. |
| `SANDBOX_EGRESS_PROXY` | The egress Service the sessions use, default `http://sandbox-egress:3128`. |

The spawner scales horizontally. Any replica resolves a session it did not create by its deterministic Pod name and adopts it, so exec, stop, and destroy work through whichever replica the Service picks. `SANDBOX_MAX_SESSIONS` counts the namespace, but simultaneous admissions on several replicas can exceed it briefly; use a ResourceQuota for a hard bound. The [sandbox Kubernetes contract](https://github.com/tale-project/tale/blob/main/services/sandbox/docs/kubernetes.md) documents the Pod shape and runtime details.

### What the spawner enforces

At start the spawner applies the NetworkPolicy `tale-sandbox-session-egress`: session Pods may reach DNS and the Pods of their own namespace and nothing else, so the cloud metadata service, the nodes, and other namespaces stay unreachable even for a process that ignores `HTTP_PROXY`. Public destinations pass through `sandbox-egress`. A missing `networkpolicies` permission is logged and does not stop the spawner; verify that the policy exists before you admit workloads.

Session Pods run the runner as uid 65534 with all capabilities dropped, a read-only root filesystem, no ServiceAccount token, and the session Secret mounted only as environment. The `/agent` workspace is a claim that survives an idle stop; only an explicit destroy deletes it. Session operations use plain HTTP to runnerd on the Pod IP, port 8200; no `pods/exec` is involved.

<Note>

The namespace-wide allowance is broader than the Compose network. From a session Pod, Postgres and the object store answer on their Service ports, although the session holds no credentials for them. Keeping those stores in another namespace would tighten this; that layout was not verified and needs its own policy for the backend roles.

</Note>

For Docker inside sessions, choose an explicit `SANDBOX_DIND_INNER_POOL` outside the Pod, Service, and VPC ranges and read the [inner Docker network prerequisites](/self-hosted/configuration/environment-reference#sandbox-infrastructure); a Pod cannot discover every cluster network.

## Roll out and verify

After the apply loop, wait for every Pod to become ready and check the signals that matter:

```bash
kubectl -n tale get pods
kubectl -n tale logs -l 'app in (backend-api,backend-worker)' --tail=-1 | grep -c 'applying app migration'
kubectl -n tale get networkpolicy tale-sandbox-session-egress tale-backend-egress
curl -s https://tale.example.com/api/health
```

Whichever backend role boots first applies the migrations under an advisory lock, so the count comes from both roles together and the API log ends with `api listening on :3005`; the health endpoint answers `{"status":"ok","version":"0.5.31"}`. Then open the site, [create the first owner](/self-hosted/install/first-admin), and connect a provider.

Under **Settings > Sandboxes**, the deployment card carries the namespace scope in its title and shows no host CPU or memory figures; that is expected on this backend. Assign a task to an agent and wait for its deliverable: the run creates a session Pod named `tale-sbx-ses-<hash>` in the namespace, together with a `-spec` Secret and a `-ws` claim.

Prove the fence from a live session Pod:

```bash
POD=$(kubectl -n tale get pods -l tale.sandbox/role=session -o name | head -1)
kubectl -n tale exec $POD -c runner -- curl -m 5 http://169.254.169.254/
kubectl -n tale exec $POD -c runner -- curl -m 20 -s -o /dev/null -w '%{http_code}\n' https://example.com/
```

The first command times out; the second prints `200`, reached through the egress proxy. Then test the lifecycle the way an operator would rely on it: a runner restart keeps the Pod and the workspace, an idle session stops after `SANDBOX_SESSION_MAX_IDLE_MS` and leaves its claim behind, the next task resumes it with the files intact, and destroying it removes the Pod, the Secret, and the claim. With two spawner replicas, repeat a task after scaling and confirm that the second replica serves it.

Roll the API without a gap by keeping two replicas and restarting the Deployment:

```bash
kubectl -n tale rollout restart deploy/backend-api
kubectl -n tale rollout status deploy/backend-api
```

Migrations run at boot under an advisory lock while the previous image keeps serving, so the health endpoint stays green through the roll. Pin one `VERSION` across all Tale images and follow [Upgrade and recover a deployment](/self-hosted/operate/upgrades) before changing it; a release that changes the proxy image needs the proxy Pod recreated too.

The CLI's snapshots, blue-green flips, and rollback checks do not run on Kubernetes. Back up the claims with your storage provider's snapshots and keep the Secret, the encryption key, and the organization configuration with them; [Backups and restore](/self-hosted/operate/backups-and-restore) lists what a restore needs.

## Verified scope

These five files were applied unchanged, apart from the Secret values, to a fresh single-node kind cluster with Kubernetes 1.36, kube-network-policies, the local-path StorageClass, and Tale 0.5.31: boot and migrations, the public edge, the first-owner setup and the Sandboxes card, an agent task with a deliverable, the session lifecycle including idle stop, resume, and cross-replica access, the fence probes above, and a rolling restart of the API with two replicas. Multi-node scheduling with `ReadWriteMany` configuration storage, Docker inside sessions on a sysbox or kata RuntimeClass, an Ingress with `TLS_MODE=external`, and highly available stores were not part of that run.
