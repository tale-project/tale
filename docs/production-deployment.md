---
title: Production deployment
description: Deploy Tale to a production server with Docker Compose, zero-downtime deployments, and reverse proxy configurations.
---

## Docker Compose deployment

For a single-server production setup, update your `.env` with these values:

```dotenv
HOST=yourdomain.com
SITE_URL=https://yourdomain.com
TLS_MODE=letsencrypt
TLS_EMAIL=admin@yourdomain.com
PULL_POLICY=always
VERSION=latest
```

Make sure ports 80 and 443 are open on your server firewall. Let's Encrypt will issue and renew TLS certificates automatically.

Then start in detached mode:

```bash
docker compose up -d
```

## Zero-downtime deployment

For production environments where downtime is not acceptable, Tale ships with a blue-green deployment script. It runs two versions of stateless services at the same time, checks that the new version is healthy, then switches traffic over.

```bash
# Deploy a specific version with no downtime
./scripts/deploy.sh deploy v1.2.0

# Deploy latest version
./scripts/deploy.sh deploy latest

# Roll back to the previous version
./scripts/deploy.sh rollback

# Check which version is currently live
./scripts/deploy.sh status
```

> **Note:** Zero-downtime deployment requires at least 12 GB of RAM on the server because both versions run at the same time during the switchover. The database and proxy are shared and are not duplicated.

For CLI-based deployments, see the [Tale CLI documentation](../tools/cli/README.md).

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

## Updating Tale

### Using the Tale CLI (recommended for production)

```bash
tale deploy              # Deploy with interactive version selection
tale deploy v1.0.0       # Deploy a specific version
tale status              # Check current deployment status
tale rollback            # Rollback to the previous version
```

### From source (development)

```bash
git pull
docker compose down
docker compose up --build -d
```

### Using pre-built images

```bash
docker compose down
docker compose pull
docker compose up -d
```

## Convex dashboard access

Tale includes an embedded Convex backend. The Convex Dashboard lets you inspect the database, view function logs, and manage background jobs.

1. Run this to generate an admin key:

```bash
docker exec tale-platform /app/generate-admin-key.sh
```

2. Copy the key from the output.
3. Open https://tale.local/convex-dashboard in your browser.
4. Paste the admin key when prompted.

> **Note:** The Convex Dashboard gives direct read and write access to all data. Only share admin keys with trusted team members.
