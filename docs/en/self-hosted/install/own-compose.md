---
title: Run Compose yourself
description: The production compose contract — networks, aliases, probes, volumes — so you can write the stack without the CLI.
---

This page is what a stack must reproduce when you write Compose or Kubernetes yourself instead of running `tale deploy`: which services hold state, the DNS names, the probes, the volumes. The CLI path stays in [Quickstart](/self-hosted/install/quickstart) and [Upgrades](/self-hosted/operate/upgrades).

## When this path is the right one

Use the CLI when you can run it. Use this page when you write Compose, or when you map the same contract onto Kubernetes.

| Use this page when | Use the CLI when |
| ------------------ | ---------------- |
| You write production Compose, or a cluster mapping — air-gap, existing automation, no CLI on the host | [Quickstart](/self-hosted/install/quickstart) plus `tale deploy` when you want blue-green, `tale backup`, and `tale rollback` |

There is no official Helm chart.

## Stateful and stateless

Ten services, two kinds. Stateful services hold disks and fixed identity — recreate them and you lose data or break DNS. Stateless services are interchangeable replicas of one image; recreate them in place on upgrade. One compose file is the default. Split files or Kubernetes is yours, as long as the DNS names, the isolated sandbox network, and the boot order stay.

```mermaid
flowchart TB
  subgraph stateful [Stateful]
    proxy[proxy]
    db[db]
    store[object-store]
    sandbox[sandbox]
    egress[sandbox-egress]
    gw[sandbox-llm-gateway]
    bg[bgutil-provider]
  end
  subgraph stateless [Stateless]
    platform[platform]
    api[backend-api]
    worker[backend-worker]
  end
  proxy --> platform
  proxy --> api
  api --> db
  api --> store
  api --> sandbox
  api --> gw
  worker --> db
  worker --> bg
  sandbox --> egress
  sandbox --> gw
```

`sandbox-llm-gateway` is the harness path: the api provisions it, and a session container reaches it as `llm-gateway`. `bgutil-provider` is the worker's YouTube PO-token sidecar and is best-effort — video-link ingest degrades without it.

The three stateless services share one image (`ghcr.io/tale-project/tale/tale-platform:<version>`). `TALE_ROLE` picks `api` or `worker` at boot; the web tier is the same image without that role. Pin every `tale-*` image to the same release tag so the wire contracts cannot skew.

| Kind | Services |
| ---- | -------- |
| Stateful | `proxy`, `db`, `object-store`, `sandbox`, `sandbox-egress`, `sandbox-llm-gateway`, `bgutil-provider` |
| Stateless | `platform`, `backend-api`, `backend-worker` |

## The images

Every `tale-*` image is published on the GitHub Container Registry under the same release tag, so one version number pins the whole stack. Two services run upstream images with versions of their own.

| Service | Image |
| ------- | ----- |
| `platform`, `backend-api`, `backend-worker` | `ghcr.io/tale-project/tale/tale-platform:<version>` |
| `proxy` | `ghcr.io/tale-project/tale/tale-proxy:<version>` |
| `db` | `ghcr.io/tale-project/tale/tale-db:<version>` |
| `sandbox` | `ghcr.io/tale-project/tale/tale-sandbox:<version>` |
| `sandbox-egress` | `ghcr.io/tale-project/tale/tale-sandbox-egress:<version>` |
| `sandbox-llm-gateway` | `ghcr.io/tale-project/tale/tale-sandbox-llm-gateway:<version>` |
| `object-store` | `minio/minio:RELEASE.2025-04-22T22-12-26Z` |
| `bgutil-provider` | `brainicism/bgutil-ytdlp-pot-provider:1.3.1` |

One image is not a compose service. The spawner creates every session container from `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`, and its built-in default is the local tag the development stack builds — a host that never built it must name the registry image in `SANDBOX_RUNTIME_IMAGE`, or `Run code`, web render, and document generation all fail with an image-not-found. Pull that image yourself before the first `up`. The spawner warms it at boot and does not start answering on `:8003` until the pull finishes, so on a cold host the sandbox sits in `starting` for as long as several gigabytes take to arrive — `tale deploy` pulls it ahead of the stack for exactly this reason.

Every example below reads its tag from one variable, so a stack cannot end up with a 0.5.11 api beside a 0.5.9 proxy:

```bash
# .env — the one line that pins all seven tale-* images
VERSION=0.5.11
```

`0.5.11` is the release this page happened to be written against, not a recommendation. Install the current one: its number is on the [latest release](https://github.com/tale-project/tale/releases/latest) page, and that is what belongs in `VERSION`. Compose substitutes it from the `.env` in the project directory — the same file that carries your secrets.

## The stateless services

Below are the three stateless roles — aliases, `/ping` as liveness, `TALE_ROLE`, `NET_ADMIN`. Put the stateful services in the same file or elsewhere; the tables on this page are what they must still do. Pin the image tag and fill `.env` from the [Environment reference](/self-hosted/configuration/environment-reference).

```yaml
# Stateless app tier. No container_name: --scale needs free names.
# Add db, proxy, sandbox, … in this file or another — your call. In one file,
# add depends_on: { db: { condition: service_healthy }, … } as well.
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
      DATABASE_URL: postgresql://tale:${DB_PASSWORD}@db:5432/tale_app
      SANDBOX_URL: http://sandbox:8003
      SANDBOX_HTTP_API_BASE_URL: http://backend-api:3005
      OBJECT_STORE_ENDPOINT: http://object-store:9000
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
      DATABASE_URL: postgresql://tale:${DB_PASSWORD}@db:5432/tale_app
      SANDBOX_URL: http://sandbox:8003
      SANDBOX_HTTP_API_BASE_URL: http://backend-api:3005
      OBJECT_STORE_ENDPOINT: http://object-store:9000
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

There is no checked-in production compose to copy. The CLI generates a split file pair and deletes it after `up`. Your file does not have to look like that.

## Secrets you generate before the first boot

`tale init` mints every secret and writes the `.env`; without the CLI that job is yours. The [Environment reference](/self-hosted/configuration/environment-reference) marks what each variable does — the five below are the ones a hand-rolled stack most often ships without, because the example file leaves them commented for the CLI to fill.

| Variable | Value | What breaks without it |
| -------- | ----- | ---------------------- |
| `SANDBOX_TOKEN` | `openssl rand -hex 32` | The spawner exits at startup. It holds the host docker socket and answers every session container, so it has no unsigned mode; the backend signs every spawner call with the same value. |
| `OBJECT_STORE_ACCESS_KEY` | `tale`, or a name of your own | The backend logs `object store (skipped)` at boot and refuses every upload. There is no image default for it — the store's root user must carry the same value. |
| `OBJECT_STORE_SECRET_KEY` | `openssl rand -hex 32` | Same skip, same silence. Rotating it later orphans every blob already written under the old credential. |
| `OBJECT_STORE_PUBLIC_ENDPOINT` | your `SITE_URL` | Uploads fail in the browser with a network error: the presigned URL the backend hands out points at the internal `http://object-store:9000`, which no browser can reach. |
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | `openssl rand -hex 32` | Every agent run fails with "the agent run could not start". The gateway's management API is dual-homed onto the sandbox network, so the backend refuses to call it anonymously — and no management call means no session virtual key, so no harness turn ever starts. The username defaults to `admin` (`SANDBOX_LLM_GATEWAY_ADMIN_USERNAME`). |

The public endpoint is the one to get right before you start, not after. The backend seeds the deployment-default blob connection into the config volume on its first boot (`default/object-storage/connection.json`) and never rewrites a default that already exists, so setting the variable on an instance that has already booted changes nothing. To repair such an instance, add `"publicEndpoint": "<your SITE_URL>"` to that file and restart the backend.

The gateway password is the other one to get right the first time. The gateway hashes it into its own `llm-gateway-data` volume on first use and verifies against that hash from then on, so a value changed later leaves the backend with a 401 it cannot talk its way out of — recover by wiping that volume, which also throws away every virtual key it holds.

## Networks and DNS names

Two Docker networks carry every hop. An ordinary compose network is enough for the internal plane. The sandbox bridge must be named `tale-sandbox-net` and marked `internal` so the spawner can `docker run --network tale-sandbox-net` and a session container cannot reach the internet without going through `sandbox-egress`. A bridge without `internal` is an open path out.

| Name the process resolves | Who answers | Networks |
| ------------------------- | ----------- | -------- |
| `backend-api` | Every healthy api replica still attached | `internal`, `sandbox` |
| `platform` | Every healthy web-tier replica still attached | `internal` |
| `knowledge-db` | The `db` service (production folds the corpus into the same Postgres) | `internal` |
| `object-store` | MinIO | `internal` |
| `sandbox` | The sandbox spawner | `internal`, `sandbox` |
| `sandbox-egress` | The egress proxy | `internal`, `sandbox` |
| `llm-gateway` | `sandbox-llm-gateway` | `internal`, `sandbox` |
| `bgutil-provider` | The worker's YouTube PO-token sidecar, which it reaches at `http://bgutil-provider:4416` by default | `internal` |
| `HOST` (your public hostname) | `proxy`, so a container can hairpin to the public URL | `internal` |

Workers have no shared alias. Nothing addresses a worker by name; they only claim jobs from the queue. Colour-suffixed aliases (`backend-api-blue`, `platform-green`) are only for a blue-green while two versions are up at once.

The proxy sends app API lanes to `backend-api:3005` (`BACKEND_UPSTREAM`). It sends `/api/health` and the SPA to `platform:3000`, and it health-checks `platform` on `/api/health`. Fail that probe on a draining web replica and Caddy marks the whole site down.

## Volumes

Name these logical volumes in your compose. One file can let compose create them. Mark them external only if something outside this file must mount the same disks.

| Volume | Who mounts it | What it holds |
| ------ | ------------- | ------------- |
| `config-data` | Backend read-write, platform read-only, sandbox read-only at `/app/platform-config` | Org config: agents, skills, providers, governance, SSO, branding |
| `db-data` | `db` at `/var/lib/postgresql/data` | `tale_app` and `tale_knowledge` |
| `db-backup` | `db` at `/var/lib/postgresql/backup` | In-container Postgres backup target |
| `object-store-data` | `object-store` at `/data` | Blobs |
| `caddy-data`, `caddy-config` | `proxy` at `/data` and `/config` | Certificates and Caddy state |
| `llm-gateway-data` | `sandbox-llm-gateway` at `/app/data` | Per-session virtual keys |

Instances upgraded from before 0.5.11 may still have a `convex-data` volume beside `config-data`. The CLI copies the store across once and never deletes the old volume. A hand-rolled first boot on a fresh host does not need `convex-data`.

## Health probes

Liveness and readiness are different questions. Mixing them cuts a draining replica out of DNS before in-flight work finishes, or keeps an unready replica in the pool.

The command column is what the shipped stack runs — each one uses a client that exists in that image.

| Service | Probe | What it means |
| ------- | ----- | ------------- |
| `backend-api` | `curl -sf http://localhost:3005/ping` | Liveness. Stays 200 while the replica drains. Docker and Caddy use this. |
| `backend-api` | `GET /ready` on `:3005` | Readiness. 503 once this replica is draining. The deploy asks this; Docker and Caddy do not. |
| `platform` | `curl -sf http://localhost:3000/api/health && [ -f /tmp/platform-ready ]` | Ready to serve the SPA. Keep this 200 while the replica still holds the `platform` alias. |
| `backend-worker` | None | The worker exposes no HTTP. Disable the image's baked web healthcheck or the replica reads permanently unhealthy. |
| `proxy` | `curl -sf http://127.0.0.1:2020/health` | Caddy admin health. |
| `db` | `pg_isready -U tale && [ -f /tmp/.db_ready ]` | Postgres accepts connections and init finished (the knowledge database and extensions). `start_period` 120s. Stop the container with `SIGINT`, not `SIGTERM`. |
| `object-store` | `mc ready local` | MinIO is accepting writes. |
| `sandbox` | `curl -fsS http://127.0.0.1:8003/health` | Spawner is up. `start_period` 15s once the runtime image is on the host — long enough to cover the pull if it is not. Do not publish this port on a public host. |
| `sandbox-egress` | `nc -z 127.0.0.1 3128` | tinyproxy is bound. Do not probe an external host. |
| `sandbox-llm-gateway` | `wget -q -O /dev/null http://127.0.0.1:8080/health` | Gateway is up. The image ships busybox `wget` and no `curl`. |

Two of these punish the obvious guess, and both fail in a way that points at the wrong container. A `curl` probe on the gateway exits 127 (`/bin/sh: curl: not found`) and the container never leaves `starting`, even though it is serving the whole time — and because `sandbox` and `backend-api` wait on it with `condition: service_healthy`, `docker compose up` aborts with `dependency failed to start` on a stack where nothing is actually broken. The sandbox has the same shape for a different reason: it stays silent on `:8003` while it warms the runtime image, so a `start_period` sized for a warm host marks it unhealthy on the first boot of a cold one.

## Environment the compose must inject

The [Environment reference](/self-hosted/configuration/environment-reference) is every variable the process reads from `.env`. The rows below are what the compose file itself must set — image defaults point the process at the wrong host.

| Name | Value on a production stack |
| ---- | --------------------------- |
| `TALE_ROLE` | `api` on `backend-api`, `worker` on `backend-worker`. Unset on `platform`. |
| `PORT` | `3005` on the api. The proxy's `BACKEND_UPSTREAM` default is `backend-api:3005`. |
| `TALE_CONFIG_DIR` | `/app/data` |
| `DATABASE_URL` | `postgresql://tale:${DB_PASSWORD}@db:5432/tale_app` — or a Postgres of your own, see [Stores you already have](#stores-you-already-have). |
| `SANDBOX_URL` | `http://sandbox:8003` |
| `SANDBOX_HTTP_API_BASE_URL` | `http://backend-api:3005` |
| `OBJECT_STORE_ENDPOINT` | `http://object-store:9000` — or your own S3 endpoint; leave it unset for AWS S3 proper. |
| `SANDBOX_EGRESS_NETWORK` | `tale-sandbox-net` |
| `SANDBOX_EGRESS_PROXY` | `http://sandbox-egress:3128` |
| `SANDBOX_TOKEN` | The same value everywhere. `sandbox` refuses to start without it; the backend signs its spawner calls with it. |
| `SANDBOX_RUNTIME_IMAGE` | `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>` on `sandbox`. The default is a local build tag that a production host does not have. |
| `BACKEND_UPSTREAM` | `backend-api:3005` on `proxy`. |
| `OBJECT_STORE_UPSTREAM` | `object-store:9000` on `proxy`, so presigned URLs are forwarded at `/<bucket>/*`. |
| `OBJECT_STORE_BUCKET` | `tale-blobs` by default. Rename it and the same name has to reach `proxy` and both backend roles. |
| `OBJECT_STORE_ACCESS_KEY`, `OBJECT_STORE_SECRET_KEY` | No image default. With either missing the backend configures no blob store at all and refuses every upload. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | On `object-store`: the store reads its own names, so map `OBJECT_STORE_ACCESS_KEY` and `OBJECT_STORE_SECRET_KEY` onto them. |
| `TALE_DB_ROLE` | Unset on the folded `db`. The default role creates `tale_knowledge` and applies the corpus migrations; `platform` skips them and leaves the corpus tableless. |

## Stores you already have

Writing the compose yourself is also how you run Tale against a database and an object store you
already operate. Three variables decide it, all read on every start, so each of these is an `.env`
change plus a restart of `backend-api` and `backend-worker` — never a rebuild.

| Store | Variable | Drop the service? |
| ----- | -------- | ----------------- |
| Application database | `DATABASE_URL` | Yes — `db` disappears, along with `db-data` and `db-backup`. |
| Knowledge corpus | `KNOWLEDGE_DATABASE_URL` | Only together with the application database: on the single-host stack both live in the one `db` service. |
| Blobs | `OBJECT_STORE_*` | Yes — `object-store` and `object-store-data` disappear, and `proxy` no longer needs `OBJECT_STORE_UPSTREAM`. |

Drop a service and you must also drop the `depends_on` entries pointing at it, or compose refuses
to start the tier that waits for a container that no longer exists.

<Steps>

<Step title="Prepare the databases">

The application database needs no extensions and no superuser — a database and a role that may
create schemas is enough; the backend migrates it at boot. The knowledge corpus needs `pgvector`
already installed, because Tale creates schemas and tables but never extensions:

```sql
CREATE DATABASE tale_app;
CREATE DATABASE tale_knowledge;
\c tale_knowledge
CREATE EXTENSION IF NOT EXISTS vector;
-- Optional. Without it hybrid search degrades to vector-only instead of failing.
CREATE EXTENSION IF NOT EXISTS pg_search;
```

Point Tale at the database's own port, never at a transaction-mode pooler — the job queue holds
`LISTEN` connections, the boot migrator holds a session-scoped advisory lock, and queries use
prepared statements.

</Step>

<Step title="Prepare the bucket">

Create the bucket, or let Tale create it: it probes with `HeadBucket` first and only creates what
is absent, so a key restricted to `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on a bucket
you provisioned is enough.

Presigned uploads and downloads run in the browser, so the bucket needs a CORS policy allowing your
`SITE_URL` origin with `GET`, `PUT` and `HEAD`.

</Step>

<Step title="Point the backend at them">

```bash .env
DATABASE_URL=postgresql://tale:...@postgres.internal:5432/tale_app?sslmode=verify-full
KNOWLEDGE_DATABASE_URL=postgresql://tale:...@postgres.internal:5432/tale_knowledge?sslmode=verify-full
POSTGRES_CA_FILE=/run/secrets/postgres-ca.pem

# Leave OBJECT_STORE_ENDPOINT unset for AWS S3 proper.
OBJECT_STORE_ENDPOINT=https://minio.internal
OBJECT_STORE_BUCKET=tale-blobs
OBJECT_STORE_ACCESS_KEY=...
OBJECT_STORE_SECRET_KEY=...
OBJECT_STORE_PUBLIC_ENDPOINT=https://minio.example.com
```

`OBJECT_STORE_PUBLIC_ENDPOINT` is where the *browser* reaches the bucket. Set it when that differs
from the endpoint the backend uses; for a bucket the browser can already reach, leave it unset and
drop the proxy's `/<bucket>/*` forwarding with it.

Mount the CA bundle into both backend services if you asked for `sslmode=verify-ca` or
`verify-full` — managed providers usually sign with roots Node does not ship, and without the
bundle the backend refuses the connection at boot rather than downgrading silently.

</Step>

<Step title="Confirm it took">

The boot log states what the object-store variables did — `seeded` on a fresh config volume,
`reconciled` after a change, `skipped` when no credential pair is set:

```bash
docker compose logs backend-api | grep 'object store'
```

Then read the reachability gauge, which is `1` per store only when the backend can actually talk to
it:

```bash
curl -s http://backend-api:3005/metrics | grep tale_backend_store_up
```

</Step>

</Steps>

<Warning>

`tale backup` snapshots Docker volumes. It announces blobs that live in an external bucket and
skips that volume, but it has no equivalent awareness of an external **database**: with
`DATABASE_URL` or `KNOWLEDGE_DATABASE_URL` pointed off the box, a snapshot looks complete and
contains none of that data. Back those databases up with your provider's own tooling — see
[Backups and restore](/self-hosted/operate/backups-and-restore).

</Warning>

## Capabilities and mounts that break if omitted

These look optional and fail closed when they are missing.

| Service | Must have | What breaks without it |
| ------- | --------- | ---------------------- |
| `backend-api`, `backend-worker` | `cap_add: [NET_ADMIN]` | The entrypoint cannot install the SSRF iptables fence (IMDS, link-local, RFC1918). |
| `sandbox-egress` | `cap_drop: [ALL]` then `NET_ADMIN`, `DAC_OVERRIDE`, `CHOWN`, `SETUID`, `SETGID`, `NET_BIND_SERVICE` | No IMDS/RFC1918 fence; tinyproxy cannot bind or drop privileges. |
| `sandbox` | `/var/run/docker.sock` and `/var/lib/tale-sandbox` bind-mounted 1:1 | The spawner cannot create session containers; workspace paths the daemon mounts will not match. |
| `db` | `stop_signal: SIGINT`, `stop_grace_period: 60s`, `shm_size: 256mb` | A `SIGTERM` wait-for-clients stop ends in `SIGKILL` and can leave the BM25 index with a zeroed page. |
| `platform` | `stop_grace_period: 45s` | Docker's default 10s grace `SIGKILL`s the web tier mid-drain and cuts in-flight HTTP/SSE. |
| `object-store` | `command: server /data` | The image's entrypoint prints its usage and exits, so the container never serves and `mc ready local` never passes. |
| `object-store` | No published ports | Presigned URLs go through the proxy. Publishing MinIO is an extra public surface. |

Publish only `80` and `443` on `proxy`. Everything else stays on the internal network.

## Boot order

Bring the stores up first, then the sandbox plane, then the app tier. An api that starts before `db` and `object-store` are healthy crash-loops on `ENOTFOUND` and on a missing database. In one file, `depends_on` with `service_healthy` is enough.

```bash
# The pull is not a compose command, so it needs the tag .env pins in this
# shell too.
VERSION=$(sed -n 's/^VERSION=//p' .env)

# Not a compose service, and the spawner blocks on it at boot — pull it first so
# the sandbox probe is not waiting on several gigabytes.
docker pull "ghcr.io/tale-project/tale/tale-sandbox-runtime:$VERSION"

docker compose up -d
# Wait until db, object-store, proxy, sandbox, sandbox-egress, sandbox-llm-gateway
# report healthy. bgutil-provider is best-effort — YouTube ingest degrades without it.
```

Give every service a restart policy (`restart: unless-stopped`). Nothing else brings a container back after a host reboot or an OOM kill, and a stack that boots once but never again is the failure operators find weeks later.

Schema migrations run inside the backend at boot, under an advisory lock. There is no separate migrate step. A replica that cannot apply a migration fails to start; leave the previous api running until the new one is healthy.

## Kubernetes

There is no Helm chart and no official manifest. Map the Docker contract; do not invent a second architecture.

| Docker | Cluster |
| ------ | ------- |
| Stateless `platform`, `backend-api`, `backend-worker` | Deployments. Same image; `TALE_ROLE` picks the process. Scale these. |
| Stateful `db`, `object-store`, `proxy`, sandbox plane | StatefulSets (or equivalent) plus the volumes on this page. Do not run two writers against one disk. |
| Compose DNS names (`backend-api`, `platform`, `knowledge-db`, `sandbox`, `llm-gateway`, …) | Services with those names. The proxy and the sandbox resolve them. |
| `tale-sandbox-net` marked `internal` | A NetworkPolicy (or isolated CNI) that blocks a session pod from the internet except through `sandbox-egress`. |
| `GET /ping` on the api | Liveness. Stays 200 while the replica drains. |
| `GET /ready` on the api | Your rollout's readiness question. Do not point the Service at `/ready` if you drain. |
| Sandbox `docker.sock` and `/var/lib/tale-sandbox` bind-mounted 1:1 | The hard part. The spawner creates session containers; the workspace path the daemon mounts must match the path inside the spawner. A cluster that cannot offer a Docker socket (or an equivalent) cannot run the sandbox plane. |
| `cap_add: [NET_ADMIN]` on the backend | The SSRF iptables fence. Without it the entrypoint cannot lock IMDS and RFC1918. |

Publish only 80 and 443. Leave Postgres, MinIO, and the sandbox port off the public Service list.

In-place recreate of the stateless Deployments is the default. Zero-downtime is a rolling update you own.

## What you give up without the CLI

`tale deploy` is not a compose up. The commands below have no equivalent in a file you maintain.

| CLI behaviour | What you do instead |
| ------------- | ------------------- |
| Blue-green flip: start the idle colour, wait for every replica, drain the old api, then `docker network disconnect` | In-place recreate, or implement the flip yourself. Disconnect severs live connections — drain first. |
| `tale backup` / `tale rollback` | Your own volume snapshots. Rollback of a minor or major is a snapshot restore, not a down-migration. |
| Flip-pending resume after a killed deploy | Your own record of which colour is live. |
| Config-volume copy from `convex-data` on a pre-0.5.11 host | Copy the store yourself, or start fresh. |
| Sandbox `/v1/drain` before an in-place spawner roll | `SIGTERM` plus a 30s stop grace is the backstop; in-flight runs still die if you recreate without draining. |

An in-place recreate of the stateless services is the default. Zero-downtime is the part you reimplement.

## What production must not do

These look local and break a public instance.

| Don't | Why |
| ----- | --- |
| Publish `5432`, `8003`, or MinIO | Extra public surface. Presigned URLs go through the proxy. |
| Run a second Postgres for the corpus | Production folds `tale_knowledge` into `db` and aliases that service `knowledge-db`. |
| Pin names on the app tier | Replicas cannot share a container name. |
| Build from source on a public host | Pin `ghcr.io/tale-project/tale/<image>:<tag>`. |
| Ship placeholder secrets | Generate them before the first up. |
| Give session containers a path to the internet | The sandbox network (or its NetworkPolicy) must be isolated. |

## Where this fits

You now have the contract: which services hold state, two networks, the DNS names the proxy and the sandbox resolve, the probes that must not be swapped, and what Kubernetes must still do. [Environment reference](/self-hosted/configuration/environment-reference) is every variable the containers read. [Container architecture](/self-hosted/operate/container-architecture) is what each container owns when one of them dies. Most teams still want the [quickstart](/self-hosted/install/quickstart) and `tale deploy` — this page is the path when that wrapper is the thing you cannot run.
