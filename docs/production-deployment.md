---
title: Production deployment
description: Deploy Tale to a production server using the Tale CLI with zero-downtime blue-green deployments.
---

## Prerequisites

- A Linux server with Docker Engine 24.0+ installed
- At least 8 GB of RAM (12 GB recommended for zero-downtime deployments)
- Ports 80 and 443 open on your firewall
- A domain name pointing to your server

## Image sizes

Tale pulls pre-built images from GitHub Container Registry. Here are the current image sizes:

| Service | Image                                      | Size     |
|---------|--------------------------------------------|---------|
| Platform | `ghcr.io/tale-project/tale/tale-platform` | ~2.6 GB  |
| Crawler  | `ghcr.io/tale-project/tale/tale-crawler`  | ~1.9 GB  |
| RAG      | `ghcr.io/tale-project/tale/tale-rag`      | ~515 MB  |
| DB       | `ghcr.io/tale-project/tale/tale-db`       | ~1.1 GB  |
| Proxy    | `ghcr.io/tale-project/tale/tale-proxy`    | ~88 MB   |

> **Tip:** First pull downloads ~4.2 GB total (compressed). Subsequent updates only download changed layers.

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

See the [environment reference](/environment-reference) for all available options.

### Step 3: Deploy

```bash
tale deploy
```

The CLI pulls pre-built images, starts all services, waits for health checks, and reports when the platform is ready. On first deploy it also starts the database and proxy.

## Managing deployments

### Deploy a new version

```bash
# Interactive version selection
tale deploy

# Deploy a specific version
tale deploy 1.2.0

# Preview changes without deploying
tale deploy 1.2.0 --dry-run

# Also update infrastructure services (db, proxy)
tale deploy 1.2.0 --all
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
# Rollback to the previous version
tale rollback

# Rollback to a specific version
tale rollback --version 0.9.0
```

> **Forward-only schema changes.** `tale rollback` reverts container
> images only; it does **not** roll back Convex data or indexes. See
> [Schema compatibility and rollback](#schema-compatibility-and-rollback)
> for what to watch out for.

### Cleanup

```bash
# Remove inactive containers
tale cleanup

# Remove ALL containers (requires confirmation)
tale reset --force
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

| Requirement | Details |
|-------------|---------|
| PostgreSQL version | 16+ |
| pgvector extension | Required for vector/semantic search |
| pg_search extension (ParadeDB) | Optional — BM25 full-text search is disabled gracefully if unavailable |
| Databases | `tale` (platform data) and `tale_knowledge` (RAG + crawler data) |
| Schemas in `tale_knowledge` | `public_web` (crawler) and `private_knowledge` (RAG) |

### Configuration

Set `POSTGRES_URL` in your `.env` to point all services at the external database:

```dotenv
POSTGRES_URL=postgresql://tale:your-password@your-db-host:5432
```

You can also override individual service connections if needed:

| Variable | Service | Description |
|----------|---------|-------------|
| `POSTGRES_URL` | All | Base connection URL (without database name) |
| `RAG_DATABASE_URL` | RAG | Full URL including database name, overrides `POSTGRES_URL` for RAG |
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

Then apply any pending migrations:

```bash
dbmate -u "postgresql://tale:your-password@your-db-host:5432/tale_knowledge" -d services/db/migrations/db/migrations up
```

### Disabling the bundled DB container

After configuring the external database, you can prevent the bundled `db` container from starting. Create a `compose.override.yml` in your deployment directory:

```yaml
services:
  db:
    profiles: ["disabled"]
```

This keeps the service definition (so `depends_on` references don't break) but prevents it from starting unless you explicitly request the `disabled` profile.

## Upgrading from v0.2.x

v0.3.0 splits the Convex backend into its own `convex` service. Existing
deployments store Convex data in the `platform-data` volume; new deployments
(and v0.2.x installations after upgrade) use a dedicated `convex-data`
volume. The one-time migration is scripted:

```bash
tale upgrade                          # Pull new CLI + images
tale migrate split-convex --dry-run   # Preview the plan
tale migrate split-convex             # Perform the copy
tale start                            # Bring the split stack back up
```

What `tale migrate split-convex` does:

1. **Detect** — looks for `${projectId}_platform-data` (prod) and/or
   `${projectId}-dev_platform-data` (dev) with data in them, and confirms
   the corresponding `convex-data` volume is empty or absent.
2. **Plan** — prints source/destination, estimated size, and which
   containers will be stopped.
3. **Stop** — `docker compose stop platform convex` + `docker wait` to
   ensure processes have fully exited (SQLite safety).
4. **Copy** — `docker run --rm --user 1001:1001 -v src:/src:ro -v dst:/dst
   alpine sh -c "cp -a /src/. /dst/ && touch /dst/.tale-migration-complete"`.
5. **Verify** — compares file counts between source and destination.
6. **Report** — prints a summary; the legacy volume is **preserved** so you
   can downgrade if needed.

### Safety notes

- The migration does **not** delete or alter the legacy `platform-data`
  volume. After verifying the new setup works end-to-end, reclaim disk
  space manually:

  ```bash
  docker volume rm <projectId>_platform-data
  docker volume rm <projectId>-dev_platform-data   # if you use dev mode
  ```

- If anything goes wrong mid-copy, re-run the command — the
  `.tale-migration-complete` sentinel file is checked before any copy,
  and partial destinations are automatically wiped and retried.
- Running the command after migration succeeds is a no-op.

### Rolling back a failed upgrade

If v0.3.x misbehaves and you need to return to v0.2.x, **do not delete
the legacy `platform-data` volume**:

```bash
tale rollback --version 0.2.<last-known-good>
# Or downgrade the CLI itself:
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/v0.2.x/scripts/install-cli.sh | bash
tale start
```

The old image expects `platform-data:/app/data`; as long as that volume
is still intact, the rollback is clean.

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

Reports are saved to the `trivy-reports/` directory. See the [container architecture](/container-architecture) page for image details.

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
