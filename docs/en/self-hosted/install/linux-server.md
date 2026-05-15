---
title: Production deployment
description: Deploy Tale to a production server using the Tale CLI with zero-downtime blue-green deployments.
---

This guide is the production path: a Linux server with a real domain, real TLS, and the blue-green deployment topology that makes upgrades survive without a maintenance window. The `tale` CLI does the heavy lifting — it pulls the Docker images, runs the migrations, and switches traffic only after the new containers pass their health checks. If a deploy fails to come up, the previous version stays serving and nothing user-visible breaks.

If you just want to try Tale locally, [Quickstart](/self-hosted/install/quickstart) is shorter and runs in minutes. Come back here when you're ready to expose the instance to your team.

## Prerequisites

- A Linux server with Docker Engine 24.0+ installed
- At least 8 GB of RAM (12 GB recommended for zero-downtime deployments)
- Ports 80 and 443 open on your firewall
- A domain name pointing to your server

## Image sizes

Tale pulls pre-built images from GitHub Container Registry. Here are the current image sizes:

| Service  | Image                                     | Size    |
| -------- | ----------------------------------------- | ------- |
| Platform | `ghcr.io/tale-project/tale/tale-platform` | ~320 MB |
| Convex   | `ghcr.io/tale-project/tale/tale-convex`   | ~485 MB |
| Crawler  | `ghcr.io/tale-project/tale/tale-crawler`  | ~1.9 GB |
| RAG      | `ghcr.io/tale-project/tale/tale-rag`      | ~515 MB |
| DB       | `ghcr.io/tale-project/tale/tale-db`       | ~1.1 GB |
| Proxy    | `ghcr.io/tale-project/tale/tale-proxy`    | ~88 MB  |

> **Tip:** First pull downloads ~4.4 GB total (compressed). Subsequent updates only download changed layers.

## Installing the Tale CLI

The Tale CLI is the recommended way to manage production deployments. Install it with:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Or download the binary directly from [GitHub Releases](https://github.com/tale-project/tale/releases):

```bash
curl -fsSL https://github.com/tale-project/tale/releases/latest/download/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

### Pin to a specific version

To install a specific CLI version instead of the latest release, set the `VERSION` environment variable on the installer:

```bash
VERSION=0.9.0 curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Or download the binary directly with the version tag in the URL:

```bash
curl -fsSL https://github.com/tale-project/tale/releases/download/v0.9.0/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

Available versions are listed on the [GitHub Releases](https://github.com/tale-project/tale/releases) page.

## Initial setup

### Step 1: Initialize your deployment directory

```bash
mkdir ~/tale && cd ~/tale
tale init
```

This creates your `.env` file with secure generated secrets.

### Step 2: Configure your environment

Open `.env` and set the required values:

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
DB_PASSWORD=a-strong-database-password
```

See the [environment reference](/self-hosted/configuration/environment-reference) for all available options.

### Step 3: Deploy

```bash
tale deploy
```

The CLI pulls pre-built images, starts all services, waits for health checks, and reports when the platform is ready. On first deploy it also starts the database and proxy.

## Managing deployments

### Upgrade to a new version

`tale deploy` always deploys the version of the CLI binary you are running, so an upgrade is two steps:

```bash
tale upgrade            # 1. Update the CLI to the latest release
tale deploy             # 2. Roll the new version out
```

#### Migrate or downgrade to a specific version

```bash
tale upgrade --version 0.9.0       # Switch the CLI to v0.9.0 (up or down)
tale deploy                        # Then roll that version out
```

`--version` accepts `0.9.0` or `v0.9.0`. Downgrades are allowed but **forward-only schema changes still apply** — see [Schema compatibility and rollback](#schema-compatibility-and-rollback). Available versions are listed on the [GitHub Releases](https://github.com/tale-project/tale/releases) page.

#### Before upgrading

- Read the [release notes](https://github.com/tale-project/tale/releases) for breaking changes and migration notes.
- Back up the database — the Postgres volume holds all platform data and uploaded files.
- If the instance is production-critical, test the upgrade on a staging instance first. Running `tale init` in a separate directory on another host gives you an isolated stack.

### Deploy

```bash
tale deploy             # Deploy the current CLI version
tale deploy --dry-run   # Preview changes without deploying
tale deploy --all       # Also update infrastructure services (db, proxy)
```

### Check status

```bash
tale status
```

Shows the active deployment color (blue or green), running containers, and health.

### View logs

```bash
tale logs platform
tale logs platform --follow
tale logs db --tail 100
```

### Rollback

```bash
tale rollback                       # Roll back to the previous version
tale rollback --version 0.9.0       # Roll back to a specific version
```

> **Forward-only schema changes.** `tale rollback` reverts container images only; it does **not** roll back Convex data or indexes. See [Schema compatibility and rollback](#schema-compatibility-and-rollback) for what to watch out for.

### Cleanup

```bash
tale cleanup            # Remove inactive containers
tale reset --force      # Remove ALL containers (requires confirmation)
```

## Zero-downtime deployment

The CLI uses a blue-green deployment strategy. When you deploy a new version:

1. New containers start alongside the current ones
2. Health checks confirm the new version is ready
3. Traffic switches to the new version
4. Old containers are drained and removed

This requires at least **12 GB of RAM** because both versions run simultaneously during the switchover. The database and proxy are shared and not duplicated.

## TLS configuration

### Let's Encrypt (recommended)

```dotenv
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
```

Caddy automatically issues and renews trusted TLS certificates. Ports 80 and 443 must be publicly accessible.

### Self-signed (development)

```dotenv
TLS_MODE=selfsigned
```

Generates a self-signed certificate. Browsers will show a security warning. To trust it on the host:

```bash
docker exec tale-proxy caddy trust
```

### External TLS (behind a reverse proxy)

```dotenv
TLS_MODE=external
```

Caddy listens on HTTP only (port 80). Your reverse proxy handles TLS termination.

## Behind a reverse proxy

If Tale runs behind a TLS-terminating reverse proxy (e.g., nginx, Traefik, Cloudflare Tunnel):

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=external
```

`SITE_URL` must match the URL users access in their browser. If your reverse proxy uses a non-standard port, include it (e.g., `SITE_URL=https://yourdomain.com:8443`).

Caddy will listen on HTTP only (port 80). Your reverse proxy must:

- Terminate TLS and forward all traffic (including WebSocket) to Tale on port 80
- Set `X-Forwarded-Proto` and `X-Forwarded-For` headers

Example nginx configuration:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl;
    server_name yourdomain.com;

    # ... your TLS certificate config ...

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

If your reverse proxy serves Tale under a subpath (e.g., `https://yourdomain.com/tale/`), set the `BASE_PATH` environment variable:

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=external
BASE_PATH=/tale
```

Caddy handles stripping the subpath prefix internally — your reverse proxy does **not** need to strip it. Simply forward all traffic under the subpath as-is (note: no trailing slash on `proxy_pass`):

```nginx
location /tale/ {
    proxy_pass http://tale-server:80;
    # ... same headers and WebSocket config as above ...
}
```

**Known limitations:**

- Convex Dashboard (`/convex-dashboard`) is not accessible under subpath deployments

## Using an external database

Tale ships a bundled ParadeDB (PostgreSQL 16 + pgvector + pg_search) container, but the architecture supports connecting to any external PostgreSQL instance instead. This is useful when your organization requires a managed database, needs to comply with data residency policies, or wants to use an existing PostgreSQL cluster.

### Requirements

Your external PostgreSQL instance must meet these requirements:

| Requirement                    | Details                                                                |
| ------------------------------ | ---------------------------------------------------------------------- |
| PostgreSQL version             | 16+                                                                    |
| pgvector extension             | Required for vector/semantic search                                    |
| pg_search extension (ParadeDB) | Optional — BM25 full-text search is disabled gracefully if unavailable |
| Databases                      | `tale` (platform data) and `tale_knowledge` (RAG + crawler data)       |
| Schemas in `tale_knowledge`    | `public_web` (crawler) and `private_knowledge` (RAG)                   |

### Configuration

Set `POSTGRES_URL` in your `.env` to point all services at the external database:

```dotenv
POSTGRES_URL=postgresql://tale:your-password@your-db-host:5432
```

You can also override individual service connections if needed:

| Variable               | Service | Description                                                            |
| ---------------------- | ------- | ---------------------------------------------------------------------- |
| `POSTGRES_URL`         | All     | Base connection URL (without database name)                            |
| `RAG_DATABASE_URL`     | RAG     | Full URL including database name, overrides `POSTGRES_URL` for RAG     |
| `CRAWLER_DATABASE_URL` | Crawler | Full URL including database name, overrides `POSTGRES_URL` for Crawler |

When using service-specific URLs, include the database name:

```dotenv
RAG_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
CRAWLER_DATABASE_URL=postgresql://tale:your-password@your-db-host:5432/tale_knowledge
```

### Database initialization

The bundled DB container runs initialization scripts automatically on first start. With an external database, you must run them manually. The scripts are in `services/db/init-scripts/` and are numbered to execute in order:

```bash
for f in services/db/init-scripts/*.sql; do
  psql -h your-db-host -U postgres -f "$f"
done
```

Then apply any pending migrations. Install [dbmate](https://github.com/amacneil/dbmate) locally (`brew install dbmate` on macOS, see the repo's README for Linux/Windows), or run it via Docker if you'd rather not install it:

```bash
# With dbmate installed locally:
dbmate -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" -d services/db/migrations/db/migrations up

# Or via Docker (no local install needed):
docker run --rm -v "$PWD/services/db/migrations/db/migrations:/db/migrations" \
  amacneil/dbmate \
  -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" up
```

### Disabling the bundled DB container

After configuring the external database, you can prevent the bundled `db` container from starting. Create a `compose.override.yml` in your deployment directory:

```yaml
services:
  db:
    profiles: ['disabled']
```

This keeps the service definition (so `depends_on` references don't break) but prevents it from starting unless you explicitly request the `disabled` profile.

## Schema compatibility and rollback

Tale deployments are not automatically rollback-safe if your code change
modifies the Convex schema. Convex data persists independently of the
application code, and `tale rollback` only swaps container images — not
database state.

### Safe changes (roll-back friendly)

- Adding new **optional** fields to existing tables
- Adding new tables
- Adding new indexes
- Adding new queries/mutations/actions
- Removing fields that the old code already tolerated as optional

### Risky changes (forward-only)

- Adding a **required** field to an existing table
- Renaming a field
- Changing a field's type
- Removing a required field the new code relies on
- Restructuring denormalised documents

### Recommended pattern: expand-contract

For any change in the "risky" category, release it in **two versions**:

1. **Expand** — Add the new shape alongside the old one. Write code that
   handles both forms. Migrate existing data to the new shape (one-shot
   backfill mutation). Safe to roll back because both shapes work.
2. **Contract** — Once production has run on the expand release long
   enough to confirm stability, release a follow-up that removes the old
   shape. This release is forward-only, but at this point the data is
   guaranteed to be in the new shape.

### Blue-green transient window

Because `convex deploy` replaces the function set atomically, there is a
brief (~10–30s) window during a blue/green cutover where the old
platform color's users may call the new function signatures:

1. `green` platform starts, pushes functions V2 to convex.
2. Convex now serves V2 to everyone — including open sessions on `blue`.
3. Caddy's health check detects `green` healthy and swings traffic
   over; `blue` drains.
4. Browser clients reconnect and pick up the new platform code.

If V2 removes or renames functions, the `blue` users see errors during
the window — so treat "remove/rename a function" as a risky change and
follow the expand-contract pattern above.

## Vulnerability scanning

All Tale images are scanned for vulnerabilities during the CI/CD release pipeline using [Trivy](https://trivy.dev/). Scan results are uploaded to the GitHub Security tab for each release.

To run a local vulnerability scan:

```bash
bun run docker:test:vulnerability
```

Reports are saved to the `trivy-reports/` directory. See the [container architecture](/self-hosted/operate/container-architecture) page for image details.

## Image versioning

Images are published to GitHub Container Registry with two tags:

- **Version tag** (e.g., `1.2.0`) — Immutable, points to a specific build
- **`latest`** — Mutable, always points to the most recent release

Both tags include multi-architecture manifests (amd64 + arm64).

```bash
# Pull a specific version
docker pull ghcr.io/tale-project/tale/tale-platform:1.2.0

# Pull the latest release
docker pull ghcr.io/tale-project/tale/tale-platform:latest
```

### Pin a specific image version

`tale deploy` selects images based on the CLI version. To lock individual service images independently — for example, to test a single new image without upgrading the whole stack — create `compose.override.yml` next to your `.env`:

```yaml
services:
  platform:
    image: ghcr.io/tale-project/tale/tale-platform:1.2.0
```

`tale deploy` merges the override automatically.

## Convex dashboard access

Tale includes an embedded Convex backend. The Convex Dashboard lets you inspect the database, view function logs, and manage background jobs.

1. Generate an admin key:

```bash
./scripts/get-admin-key.sh
```

2. Copy the key from the output.
3. Open `https://yourdomain.com/convex-dashboard` in your browser.
4. Paste the admin key when prompted.

> **Note:** The Convex Dashboard gives direct read and write access to all data. Only share admin keys with trusted team members.

## Where this fits

Linux-server install is the canonical production path for self-hosted Tale. After the instance is up, the [environment reference](/self-hosted/configuration/environment-reference) catalogues every knob the install touched and every knob it didn't; [Authentication](/self-hosted/admin/authentication) wires the instance to your identity provider; [Operations](/self-hosted/operate/observability/operations) covers what to scrape and alert on once traffic starts flowing. For end-user work inside the running app, [Platform](/platform) is the next destination.
