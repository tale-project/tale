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
