---
title: Production deployment
description: Deploy Tale to a production server using the Tale CLI with zero-downtime blue-green deployments.
---

Production deployment is the canonical path for putting self-hosted Tale in front of a team — a Linux server with a real domain, real TLS certificates, and the blue-green topology that survives upgrades without a maintenance window. The `tale` CLI does the heavy lifting: it pulls the right images, runs migrations, starts the new containers alongside the old ones, and only swings traffic over after the new version passes its health checks. A failed deploy leaves the previous version serving and nothing user-visible breaks.

This guide assumes you've already evaluated Tale on a laptop. If you haven't, the [Local quickstart](/self-hosted/install/quickstart) takes minutes and uses the same CLI; come back here when the instance needs to be reachable outside your machine.

## Before you begin

- A Linux server with Docker Engine 24.0 or newer.
- At least 8 GB of RAM, 12 GB recommended so the blue-green deploy has headroom for both colors running side by side.
- Ports 80 and 443 open on the firewall; ACME validation needs both, and so does the production proxy.
- A domain name with an A record (or AAAA record) pointing at the server.
- An AI provider key — OpenRouter is the recommended default; any OpenAI-compatible endpoint works.

If your environment requires a managed Postgres instead of the bundled database, skim [Using an external database](#using-an-external-database) at the bottom of this page before you start — it changes a few of the `.env` values and adds one manual init step.

## Image sizes

Tale pulls multi-architecture images (amd64 + arm64) from GitHub Container Registry. The first pull is around 4.4 GB compressed total; subsequent updates only download changed layers.

| Service    | Image                                     | Compressed size |
| ---------- | ----------------------------------------- | --------------- |
| `proxy`    | `ghcr.io/tale-project/tale/tale-proxy`    | ~88 MB          |
| `platform` | `ghcr.io/tale-project/tale/tale-platform` | ~320 MB         |
| `convex`   | `ghcr.io/tale-project/tale/tale-convex`   | ~485 MB         |
| `rag`      | `ghcr.io/tale-project/tale/tale-rag`      | ~515 MB         |
| `crawler`  | `ghcr.io/tale-project/tale/tale-crawler`  | ~1.9 GB         |
| `db`       | `ghcr.io/tale-project/tale/tale-db`       | ~1.1 GB         |

## Install the CLI

The `tale` CLI is a single binary that drives every operation in this guide. The installer script writes to `/usr/local/bin/tale`:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

To pin a specific version instead of the latest release, set the `VERSION` environment variable on the installer:

```bash
VERSION=0.9.0 curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Or grab the binary directly from a release tag — the same multi-architecture binary is published for every release:

```bash
curl -fsSL https://github.com/tale-project/tale/releases/download/v0.9.0/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

The full list of releases is on the [GitHub Releases](https://github.com/tale-project/tale/releases) page.

## Step 1 — Initialise the deployment directory

Pick a directory on the server that will hold the `.env` file and any local config. The standard pattern is `~/tale`:

```bash
mkdir ~/tale && cd ~/tale
tale init
```

`tale init` writes a `.env` file with auto-generated secrets — `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`, `INSTANCE_SECRET`, and a `SOPS_AGE_KEY` for the SOPS-encrypted provider secrets mode. It also drops the example provider configs under `examples/providers/` and scaffolds `TALE_CONFIG_DIR`. The directory is the source of truth for this instance; everything `tale deploy` reads lives here or in `.env`.

## Step 2 — Configure your environment

Open `.env` and set the required values. The bare-minimum production set is five variables:

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
DB_PASSWORD=a-strong-database-password
```

`SITE_URL` must match the URL users actually reach in their browser. If your reverse proxy or load balancer terminates TLS on a non-standard port, include it (`https://yourdomain.com:8443`). The [Environment reference](/self-hosted/configuration/environment-reference) catalogues every variable Tale reads — domain, TLS, secrets, database, monitoring, SSO, trusted headers — with defaults from `.env.example`.

## Step 3 — Deploy

```bash
tale deploy
```

The first deploy pulls every image, starts the database and proxy, and brings the platform up once the dependencies are healthy. Subsequent deploys reuse the running database and proxy and only roll the application services. The CLI reports when each container passes its health check and when the platform answers `/api/health` from inside the network.

Add `--dry-run` to preview without applying; add `--all` to also update the infrastructure services (`db`, `proxy`) that the CLI ordinarily leaves alone after the initial install.

## Day-to-day operations

`tale deploy` is the workhorse, but a few other commands are part of the steady-state rhythm.

```bash
tale status                      # Active color (blue or green), running containers, health
tale logs platform               # Tail logs for one service
tale logs platform --follow      # Same, streaming
tale logs db --tail 100          # Last 100 lines from the database
tale cleanup                     # Remove inactive containers from the previous color
tale reset --force               # Remove every container (confirmation required)
```

### Upgrades

A version bump is two commands: update the CLI binary, then redeploy.

```bash
tale upgrade                     # Fetch the latest CLI release
tale deploy                      # Roll the new version out
```

To pin a specific version (up or down), pass `--version`:

```bash
tale upgrade --version 0.9.0
tale deploy
```

Read the release notes before upgrading. Breaking changes and migration notes live on the [GitHub Releases](https://github.com/tale-project/tale/releases) page, formatted per [Release notes format](/self-hosted/operate/release-notes/format). For production-critical instances, run the same `tale upgrade` plus `tale deploy` pair on a staging instance first; `tale init` in a separate directory on another host gives you an isolated stack.

### Rollback

```bash
tale rollback                    # Revert to the previous version
tale rollback --version 0.9.0    # Revert to a specific version
```

`tale rollback` swaps container images. It does not roll back Convex schema or data. See [Schema compatibility and rollback](#schema-compatibility-and-rollback) for the cases where that matters.

## Zero-downtime upgrades

The CLI deploys blue-green: the new color starts alongside the running color, the proxy waits for it to pass health checks, then swings traffic over and drains the old color. This is why the RAM recommendation jumps from 8 GB to 12 GB — both `platform`, `rag`, and `crawler` exist twice during the swap. The `db` and `proxy` services are shared and never duplicated.

```text
1. green starts.
2. green's containers pass their health checks.
3. proxy swings traffic from blue to green.
4. blue drains and stops.
```

If green never reports healthy, the proxy keeps routing to blue and `tale deploy` fails with the container logs attached. Nothing user-visible breaks.

## TLS

`TLS_MODE` is the single switch that picks how certificates get issued. Three values; pick the one that fits.

### Let's Encrypt (recommended for production)

```dotenv
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
```

Caddy issues and renews trusted certificates automatically. Ports 80 and 443 must be reachable from the public internet — ACME's HTTP-01 challenge runs on port 80, and HTTPS traffic answers on 443.

### Self-signed (development and demos)

```dotenv
TLS_MODE=selfsigned
```

Caddy generates a local certificate. Browsers show a "Your connection is not private" warning until you trust the certificate. To trust it on the host:

```bash
docker exec tale-proxy caddy trust
```

### External (behind an upstream reverse proxy)

```dotenv
TLS_MODE=external
```

Caddy listens on HTTP only. Your reverse proxy (nginx, Traefik, HAProxy, Cloudflare Tunnel) terminates TLS and forwards to Tale on port 80. The reverse proxy must also forward WebSocket upgrades because Convex's realtime channel runs over WS.

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

## Subpath deployment

If your reverse proxy serves Tale under a path prefix (`https://yourdomain.com/tale/`), set `BASE_PATH` so the SPA emits the right asset URLs:

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=external
BASE_PATH=/tale
```

Caddy strips the prefix internally — your upstream proxy forwards the full path as-is. No trailing slash on `proxy_pass`:

```nginx
location /tale/ {
    proxy_pass http://tale-server:80;
    # ... same headers and WebSocket config as above ...
}
```

The Convex Dashboard at `/convex-dashboard` is not currently reachable under a subpath deployment.

## Using an external database

The bundled `db` container ships ParadeDB (Postgres 16 + pgvector + pg_search) and works out of the box. If you need a managed database, data residency in a specific cluster, or an existing Postgres pool, the four database-using services can connect to any external Postgres instance instead.

The external instance must meet a few requirements:

| Requirement                 | Detail                                                          |
| --------------------------- | --------------------------------------------------------------- |
| Postgres version            | 16 or newer                                                     |
| `pgvector` extension        | Required for vector / semantic search                           |
| `pg_search` extension       | Optional — BM25 full-text search degrades gracefully without it |
| Databases                   | `tale` (platform) and `tale_knowledge` (RAG and crawler)        |
| Schemas in `tale_knowledge` | `public_web` (crawler) and `private_knowledge` (RAG)            |

Point Tale at the external instance from `.env`:

```dotenv
POSTGRES_URL=postgresql://tale:your-password@your-db-host:5432
```

`POSTGRES_URL` is the base URL without a database name. Convex appends `tale` and the Python services derive `tale_knowledge` from the same base. If a service needs a different host (the RAG service on a read replica, for example), override per service:

```dotenv
RAG_DATABASE_URL=postgresql://tale:your-password@rag-replica:5432/tale_knowledge
CRAWLER_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
```

The bundled `db` container runs its init scripts on first boot; an external instance never sees them, so you have to apply them manually before the first `tale deploy`:

```bash
for f in services/db/init-scripts/*.sql; do
  psql -h your-db-host -U postgres -f "$f"
done
```

Then run the dbmate migrations against `tale_knowledge`:

```bash
# With dbmate installed locally (brew install dbmate on macOS):
dbmate -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" \
  -d services/db/migrations/db/migrations up

# Or one-shot via Docker:
docker run --rm -v "$PWD/services/db/migrations/db/migrations:/db/migrations" \
  amacneil/dbmate \
  -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" up
```

Finally, prevent the bundled `db` container from starting by dropping a `compose.override.yml` next to your `.env`:

```yaml
services:
  db:
    profiles: ['disabled']
```

The override keeps the service definition (so `depends_on` references still resolve) but never starts the container.

## Schema compatibility and rollback

Tale deployments are not automatically rollback-safe when your code change modifies the Convex schema. Convex data persists independently of the application image, and `tale rollback` only swaps containers — never the data.

### Safe changes

- Adding optional fields to existing tables.
- Adding new tables.
- Adding new indexes.
- Adding new queries, mutations, or actions.
- Removing fields the old code already tolerated as optional.

### Risky changes

- Adding a required field to an existing table.
- Renaming a field.
- Changing a field's type.
- Removing a required field the new code depends on.
- Restructuring denormalised documents.

### Expand-contract

For any risky change, ship two releases.

The first release **expands**: it adds the new shape alongside the old one, writes code that handles both, and migrates existing data to the new shape via a one-shot backfill. Both shapes work, so the release is safely rollback-friendly. The second release **contracts**: once production has run on the expanded release long enough to confirm stability, the follow-up removes the old shape. By that point the data is guaranteed to be in the new shape, so the contract release can be forward-only.

### Blue-green transient window

The deploy step pushes the new Convex function set atomically. For a short window — around 10 to 30 seconds — open sessions on the old color may call function signatures that match the new shape:

```text
1. green platform starts, runs `bunx convex deploy` against the convex service.
2. Convex now serves V2 functions to every client, including open blue sessions.
3. The proxy notices green is healthy and swings traffic.
4. Browser clients reconnect and pick up the new platform code.
```

If V2 removes or renames functions, blue's connected clients see errors during the window. Treat "remove or rename a function" as a risky change and follow expand-contract.

## Vulnerability scanning

Every Tale image is scanned with [Trivy](https://trivy.dev/) on the CI release pipeline; results are uploaded to the GitHub Security tab against the release tag. To run the scan locally against the images on your host:

```bash
bun run docker:test:vulnerability
```

Reports land in `trivy-reports/`. The image-level checks (OCI labels, non-root user, size budgets, no secrets in layers) are covered by `bun run docker:test:image`. The [Contributing Docker guide](/develop/contributing-docker) lists every check the CI runs.

## Image versioning

Images are published with two tags. Version tags (`1.2.0`) are immutable and point at a specific build; `latest` is mutable and follows the most recent release. Both carry multi-architecture manifests for amd64 and arm64.

```bash
docker pull ghcr.io/tale-project/tale/tale-platform:1.2.0
docker pull ghcr.io/tale-project/tale/tale-platform:latest
```

To pin one service to a specific version without upgrading the rest of the stack — for testing a single image, or rolling forward only the crawler — drop a `compose.override.yml` next to `.env`:

```yaml
services:
  platform:
    image: ghcr.io/tale-project/tale/tale-platform:1.2.0
```

`tale deploy` merges the override automatically.

## Convex Dashboard

The bundled Convex backend ships a dashboard for inspecting the database, viewing function logs, and managing background jobs. It listens behind the proxy at `/convex-dashboard` and requires an admin key for every session.

To generate the admin key:

```bash
tale convex admin
```

Paste the key into the dashboard when prompted. The dashboard gives direct read and write access to every collection in Convex, so only share admin keys with trusted operators.

## Where this fits

Production deployment is the canonical path for self-hosted Tale. After the instance is reachable, the [Environment reference](/self-hosted/configuration/environment-reference) catalogues every knob touched here and every knob this guide left at its default; [Authentication](/self-hosted/admin/authentication) wires the instance to your identity provider; [Operations](/self-hosted/operate/observability/operations) covers what to scrape, log, and alert on once traffic starts flowing. For everything end users do once they sign in, [Platform](/platform) reads the same on Cloud and self-hosted.
