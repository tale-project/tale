---
title: Run Compose yourself
description: Assemble Tale's images, stores, networks, secrets, and health probes when your team owns the orchestration.
---

Use this reference when your team maintains the deployment files and rollout process. The [CLI quickstart](/self-hosted/install/quickstart) is the shorter path when you want Tale to generate those files and coordinate upgrades. There is no official Helm chart. The sandbox spawner supports Docker and Kubernetes backends; choose the matching runtime and network configuration.

This is a deployment contract with an application-tier example, not a complete Compose file ready to start. Assemble and validate the storage, proxy, and sandbox services before using that example.

## Choose the service layout

| Group | Services | Lifecycle |
| --- | --- | --- |
| Replicable application | `platform`, `backend-api`, `backend-worker` | Same image and release. Keep shared wire contracts compatible during replacement. |
| Persistent stores and edge | `db`, `object-store`, `proxy` | Preserve volumes, credentials, certificates, and stable network names when replacing containers. |
| Shared execution services | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` | Coordinate active sessions before replacement; the spawner needs the Docker daemon and matching workspace paths. |
| Optional video support | `bgutil-provider` | Best-effort token provider; its failure can affect video retrieval. |

The packaged layout keeps `tale_app` and `tale_knowledge` in one Postgres service with a `knowledge-db` alias. Separate database services or managed databases are also possible; configure their connections and backup coverage explicitly. Recreating a stateful container does not inherently destroy its data, but removing or replacing its volume can.

## Pin compatible images

Set `VERSION` in Compose's `.env` to the Tale release you have reviewed and tested. Export that same value in your shell when running the separate runtime-image pull below. Keep Tale images on one release; the two upstream services have their own pinned versions.

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

Session containers use the additional image `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`. Set `SANDBOX_RUNTIME_IMAGE` on the spawner and pull it before startup. Its default local development tag is not sufficient on a host that never built it. If you enable Docker-in-container or shared build caching, also provision the compatible runtime and cache images described in the [environment reference](/self-hosted/configuration/environment-reference).

## Prepare secrets and public addresses

Generate unique values before the first start, and persist them in your secret-management system. Do not copy the sample credentials from a development environment into a production stack.

| Value | Requirement |
| --- | --- |
| `BETTER_AUTH_SECRET` | Stable, high-entropy authentication secret. |
| `ENCRYPTION_SECRET_HEX` | A 32-byte hex value, for example generated with `openssl rand -hex 32`; preserve it for existing encrypted database values. |
| `DB_PASSWORD` or external database credentials | Match the database role the backend actually uses. |
| `SANDBOX_TOKEN` | The same high-entropy token in backend and spawner. |
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | Stable gateway management credential shared with the backend; the username defaults to `admin`. |
| `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY` | Credentials valid for the chosen store. Map them to `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` on bundled MinIO. |
| `OBJECT_STORE_PUBLIC_ENDPOINT` | The browser-reachable endpoint, usually `SITE_URL` when Tale's proxy forwards the bundled store. |
| SOPS age identity | Required to decrypt the configuration sidecars you have encrypted; see [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops). |

The backend reconciles an environment-managed default object-store connection at startup. A `managedBy: operator` file is deliberately left alone. Changing storage credentials does not move or inherently orphan blobs, but the store and backend must agree before reads and writes work. The gateway retains its established password hash; restore the matching secret or follow its credential-rotation procedure rather than deleting its volume as routine troubleshooting.

Set `HOST`, `SITE_URL`, and `TLS_MODE` for the public path. [TLS and domains](/self-hosted/configuration/tls-and-domains) covers certificates, additional origins, and subpaths.

## Assemble the application tier

The three roles share an image. `TALE_ROLE=api` and `TALE_ROLE=worker` select backend roles; keep that variable unset for the web service. Do not put a fixed `container_name` on roles you intend to scale.

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

Explicit `environment` entries override `env_file`. The fragment therefore preserves external database and object-store overrides instead of silently forcing bundled addresses. Add health-based dependencies in a single Compose project, or enforce startup ordering in your orchestrator when services live in separate projects.

## Preserve network names and isolation

| Address | Target and network requirement |
| --- | --- |
| `platform` | Web replicas on the internal application network. They reach the backend at `TALE_BACKEND_URL`, `http://backend-api:3005` unless you set it. |
| `backend-api` | API replicas on the application and sandbox networks, reachable on port 3005. |
| `knowledge-db` | The knowledge Postgres target, or use `KNOWLEDGE_DATABASE_URL`. |
| `object-store` | Bundled MinIO on the application network. |
| `sandbox` | Spawner reachable by the backend on port 8003. |
| `sandbox-egress` | Egress proxy reachable by sandbox sessions on port 3128. |
| `sandbox-llm-gateway` / `llm-gateway` | Gateway reachable from backend and sandbox sessions on port 8080. |
| `bgutil-provider` | Token sidecar reachable by the worker on port 4416. |

The sandbox network must be isolated from direct outbound access. The generated stack names it `tale-sandbox-net`; if you choose another name, keep `SANDBOX_EGRESS_NETWORK` and the actual network consistent. Egress must still go through `sandbox-egress`.

Configure `BACKEND_UPSTREAM=backend-api:3005` on the proxy. For bundled file storage, set `OBJECT_STORE_UPSTREAM=object-store:9000` and use the same `OBJECT_STORE_BUCKET` on proxy and backend. Publish the public proxy's ports 80/443; keep databases, store administration, gateway, and sandbox APIs private. Preserve trusted client forwarding if another proxy sits upstream.

## Mount persistent state and required capabilities

| Resource | Required mounts or settings |
| --- | --- |
| Organization configuration | `config-data:/app/data` read-write on backend roles, read-only on `platform`; read-only at `/app/platform-config` on the spawner. |
| Application and bundled knowledge data | `db-data:/var/lib/postgresql/data`; separate knowledge service needs its own persistent volume. |
| Bundled object storage | `object-store-data:/data` and MinIO `command: server /data`. |
| Proxy certificates and state | `caddy-data:/data`, `caddy-config:/config`. |
| Gateway state | `llm-gateway-data:/app/data`. |
| Spawner | `/var/run/docker.sock` and `/var/lib/tale-sandbox` mounted at the same host/container paths. Docker-socket access gives control over the host daemon. |
| Backend roles | `cap_add: [NET_ADMIN]` for the shipped entrypoint's network fence. |
| Egress service | The shipped restricted capability set after dropping all others: `NET_ADMIN`, `DAC_OVERRIDE`, `CHOWN`, `SETUID`, `SETGID`, `NET_BIND_SERVICE` and `KILL`. Without `KILL` the root supervisor cannot signal tinyproxy after it has dropped to `nobody`, so a stop waits out the grace period and ends in exit 137 instead of draining. |
| Egress IPv6 | `sysctls` with `net.ipv6.conf.all.disable_ipv6: '1'` and `net.ipv6.conf.default.disable_ipv6: '1'`, as in the shipped stack. The egress firewall fails closed: it needs working IPv6 firewall support or IPv6 disabled for the default and every interface, and a container cannot write those sysctls itself through a read-only `/proc/sys`. Without them the proxy refuses to start on a kernel without the `ip6_tables` module; see [Sandbox infrastructure](/self-hosted/configuration/environment-reference#sandbox-infrastructure). |
| Postgres shutdown | `stop_signal: SIGINT`, `stop_grace_period: 60s`, `shm_size: 256mb` in the reference stack. |
| Web and spawner shutdown | Allow the web tier's 45-second and spawner's 30-second stop grace; coordinate active work before stopping. |

Keep `db-backup` if your database tooling writes to `/var/lib/postgresql/backup`; mounting it alone does not create a backup schedule. Older `convex-data` configuration volumes need a deliberate transfer into `config-data`, not deletion. Preserve the old copy until verified.

## Use the right health probes

| Service | Probe | Meaning |
| --- | --- | --- |
| `backend-api` | `curl -sf http://localhost:3005/ping` | Process liveness; stays available during drain. |
| `backend-api` | `GET /ready` on port 3005 | Whether the backend is accepting new work; separate from external-store health. |
| `platform` | `curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]` | Web service startup completed. |
| `backend-worker` | Disable the image's web healthcheck. | No HTTP server; monitor jobs and worker progress separately. |
| `proxy` | `curl -sf http://127.0.0.1:2020/health` | Proxy process responds. |
| `db` | `pg_isready -U tale && [ -f /tmp/.db_ready ]` | Postgres and initialization are ready; adapt the user to your configuration. |
| `object-store` | `mc ready local` | Bundled MinIO readiness. |
| `sandbox` | `curl -fsS http://127.0.0.1:8003/health` | Spawner readiness after runtime-image preparation. |
| `sandbox-egress` | `nc -z 127.0.0.1 3128` | Local proxy port, independent of a third-party website. |
| `sandbox-llm-gateway` | `wget -q -O /dev/null http://127.0.0.1:8080/health` | Use the image's available client; it does not ship `curl`. |

Give cold starts enough time: downloading the sandbox runtime can take longer than a warm-host probe budget. A successful readiness probe does not prove file access, model credentials, or an entire user task. Check those separately.

## Connect external stores

External application Postgres replaces `DATABASE_URL`; external knowledge uses `KNOWLEDGE_DATABASE_URL`. The latter needs pgvector and, for full hybrid search, pg_search. Supply a session-compatible connection and any required `POSTGRES_CA_FILE`. Do not assume a transaction pooler preserves the session behavior Tale needs.

For external S3-compatible storage, set the `OBJECT_STORE_*` values and browser endpoint explicitly. AWS S3 can use an empty custom endpoint; other stores may need path-style addressing. Provision object permissions and browser CORS, then test an actual upload and download. Remove only the bundled services you no longer use, along with their `depends_on` references; keep old volumes until migration is verified.

Changing URLs does not migrate existing rows or files. [Data residency](/self-hosted/configuration/data-residency) describes the per-organization and deployment-wide choices. External stores require their own coordinated backups, outside `tale backup`'s volume archives.

## Start and accept the installation

Bring stores up before dependent services and use restart policies such as `unless-stopped`. Prepare `VERSION` in the shell as described above, then validate your complete Compose file:

```bash
docker compose config --quiet
docker pull "ghcr.io/tale-project/tale/tale-sandbox-runtime:$VERSION"
docker compose up -d
docker compose ps
docker compose logs --tail=100 backend-api backend-worker
```

Confirm healthy services, successful backend migrations, and worker progress. Open the public URL, follow [First administrator](/self-hosted/install/first-admin), configure a provider and embedding model, and test a controlled chat, file upload/download, and knowledge query. If harnesses are required, verify a sandbox session too.

Database migrations run at backend boot. Your deployment procedure must keep compatible versions serving during that work, stop on migration failures, drain active work before replacement, and retain a recovery record. The CLI's blue-green coordination, pending-flip recovery, automatic snapshots, and rollback checks do not happen merely because you copied its service layout.

## Map the contract to Kubernetes

Use Deployments and stable Services for the application roles, with a shared configuration volume whose storage supports the required writes and locks. Use persistent volumes or external services for stores. Configure the sandbox spawner with `SANDBOX_BACKEND=kubernetes`: it creates session Pods and workspace PVCs through the Kubernetes API instead of the host Docker socket.

### Prepare the sandbox namespace

Keep the session Pods, egress proxy, and model gateway in the intended sandbox namespace. Provide a StorageClass that can preserve and reattach workspace volumes where resumed Pods schedule.

| Setting | Requirement |
| --- | --- |
| `SANDBOX_BACKEND` | `kubernetes`. Docker-only host paths and bridge names do not configure this backend. |
| `SANDBOX_K8S_NAMESPACE` | Session namespace; defaults to `tale-sandbox`. |
| `SANDBOX_RUNTIME_IMAGE` | The matching Tale sandbox runtime image, available to cluster nodes. |
| `NODE_EXTRA_CA_CERTS` | Cluster CA file, normally `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt` inside the spawner. Preserve TLS verification. |
| `SANDBOX_K8S_WORKSPACE_SIZE_LIMIT` | Workspace PVC size, default `4Gi`; also bounds the inner Docker temporary store when enabled. |
| `SANDBOX_K8S_CACHE_STORAGECLASS` | Workspace StorageClass; unset uses the cluster default. |
| `SANDBOX_RUNTIME` / `SANDBOX_RUNTIME_CLASS` | A supported runtime tier and, when needed, the installed RuntimeClass name. |
| `SANDBOX_EGRESS_PROXY` | Reachable egress service, default `http://sandbox-egress:3128`. |

The spawner ServiceAccount needs these permissions in that namespace:

| Resource | Verbs |
| --- | --- |
| `pods` | `create`, `get`, `list`, `delete`, `patch` |
| `secrets` | `create`, `delete`, `list` |
| `persistentvolumeclaims` | `get`, `create`, `delete` |
| `networkpolicies` in `networking.k8s.io` | `create`, `update` |

Session operations use HTTP to runnerd on the Pod IP, port 8200. They do not need `pods/exec`, and session Pods do not receive a ServiceAccount token. Allow the spawner's required control-plane and runner connections in your policies. The [sandbox Kubernetes contract](https://github.com/tale-project/tale/blob/main/services/sandbox/docs/kubernetes.md) contains the namespaced Role and runtime details.

### Prove isolation and lifecycle

The spawner applies an egress NetworkPolicy for session Pods, allowing DNS and the sandbox namespace. Your CNI must enforce NetworkPolicy. Failure to create the policy is logged but does not stop spawner startup: verify that the effective policy exists and actually blocks an unapproved destination before admitting workloads. Proxy environment variables alone do not enforce isolation.

Check the egress proxy's IPv6 protection and the [inner Docker network prerequisites](/self-hosted/configuration/environment-reference#sandbox-infrastructure). For nested Docker, choose an explicit `SANDBOX_DIND_INNER_POOL` outside the cluster's Pod, Service, and VPC ranges; a Pod cannot discover every cluster network.

A stopped session keeps its workspace PVC for resume; explicit destruction removes it. `SANDBOX_MAX_SESSIONS` counts namespace sessions but is best effort across simultaneous replica admissions. Use ResourceQuota and measured CPU/memory limits for hard cluster bounds.

Test create, execution, runner restart, idle stop, resume with files intact, and explicit destruction. With multiple spawner replicas, test cross-replica access too. Map application readiness and drain behavior deliberately and observe in-flight requests during an update. The CLI's Docker rollout coordination does not operate a Kubernetes deployment for you.
