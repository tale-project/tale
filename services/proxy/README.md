# Tale Proxy (Caddy)

**OPTIONAL SERVICE** - Only needed for production HTTPS deployments.

Caddy reverse proxy that terminates TLS and forwards requests to the Platform app. Supports automatic HTTPS via ACME (Let's Encrypt by default) and basic security headers.

## When to Use

**Local Development:** ❌ NOT needed

- Run: `docker compose up`
- Access: http://localhost:3000 (direct to platform)
- The proxy will NOT start by default

**Production with HTTPS:** ✅ Required

- Run: `docker compose --profile production up`
- Access: https://yourdomain.com (via proxy)
- Automatic SSL certificate management

## Ports

- 80 (HTTP) - ACME challenges and HTTP→HTTPS redirect
- 443 (HTTPS) - Main application traffic

## Configuration

Set these in your root .env file:

```bash
# Required for production
DOMAIN=https://yourdomain.com
ACME_EMAIL=you@example.com

# Optional: Use Let's Encrypt staging for testing
# ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
```

## Behavior

- HTTP on :80 serves ACME challenges and redirects to HTTPS
- HTTPS on :443 proxies to platform:3000 with health checks at /api/health
- Certificates and state persist in volumes `caddy-data` and `caddy-config`
- Automatic certificate renewal (Let's Encrypt)

## Running

**Production mode (with proxy):**
```bash
docker compose --profile production up -d
```

**Local development (without proxy):**
```bash
docker compose up
# Proxy will NOT start - access platform directly at http://localhost:3000
```

Once a valid domain resolves to your host and ports 80/443 are open, Caddy will obtain certificates automatically.

## Troubleshooting

- **Check logs:** `docker logs -f tale-proxy`
- **Staging certificates:** Set `ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory` for testing
- **DNS issues:** Ensure your domain resolves to your server's IP
- **Firewall:** Ensure ports 80 and 443 are open
- **Certificate errors:** Check that ACME_EMAIL is set and valid
