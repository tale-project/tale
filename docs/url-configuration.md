# URL Configuration Guide

This document explains how URLs are configured in the Tale Platform and how they're derived at runtime.

## Architecture Overview

The Tale Platform uses a **runtime URL derivation strategy** to avoid baking environment-specific values into Docker images:

1. **Client-side (Browser)**: Derives URLs from `window.location.origin` at runtime
2. **Server-side (Next.js)**: Uses `SITE_URL` environment variable
3. **Backend-to-Backend**: Uses internal Docker network addresses

**Key Principle**: No `NEXT_PUBLIC_*` environment variables are used. This ensures Docker images are portable across environments.

## URL Configuration

### Setting the DOMAIN Variable

The `DOMAIN` environment variable is the single source of truth for public URLs in Docker Compose:

```bash
# Local development (HTTP)
DOMAIN=http://localhost

# Production with domain name (HTTPS)
DOMAIN=https://demo.tale.dev

# Production with IP address (HTTP)
DOMAIN=http://203.0.113.10
```

If you omit the protocol, `http://` will be added automatically as the default.

### How Caddy Handles HTTPS

Caddy's automatic HTTPS behavior varies by domain type:

1. **localhost/127.0.0.1**:

   - Caddy serves with HTTPS using **self-signed certificates**
   - Requires trusting Caddy's root CA (Caddy will attempt to install it automatically)
   - If you set `DOMAIN=http://localhost`, clients connect via HTTP, but Caddy may redirect to HTTPS
   - You may see browser certificate warnings if Caddy's root CA is not trusted

2. **Domain names** (e.g., demo.tale.dev):

   - Caddy automatically obtains certificates from Let's Encrypt or ZeroSSL via ACME
   - Serves over HTTPS with valid, publicly-trusted certificates
   - Set `DOMAIN=https://demo.tale.dev` for production

3. **IP addresses** (e.g., 203.0.113.10):

   - Caddy automatically disables TLS (serves over HTTP)
   - ACME providers don't issue certificates for IP addresses
   - Set `DOMAIN=http://203.0.113.10`

**For local development**: If you want to avoid certificate warnings with localhost, you can either:

- Trust Caddy's root CA (run `caddy trust` as admin)
- Or modify the Caddyfile to use `http://localhost` explicitly to disable HTTPS

## Runtime URL Derivation

### Client-Side (Browser)

The Convex client derives URLs at runtime from `window.location.origin`:

```typescript
// services/platform/components/convex-auth-provider.tsx
function getConvexUrl(): string {
  return `${window.location.origin}/ws_api`;
}
```

This means:
- **No `NEXT_PUBLIC_*` variables needed**
- Docker images work in any environment without rebuild
- URLs automatically match the domain the user is accessing

### Server-Side (Next.js)

Server-side code uses the `SITE_URL` environment variable:

```typescript
// services/platform/lib/convex-next-server.ts
const rawSiteUrl = process.env.SITE_URL || 'http://localhost:3000';
const url = `${rawSiteUrl.replace(/\/+$/, '')}/ws_api`;
```

### Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `SITE_URL` | Server-side | Base URL for the platform (e.g., `https://demo.tale.dev`) |
| `DOMAIN` | Docker Compose | Passed to Caddy and derived to `SITE_URL` |

**Note**: `NEXT_PUBLIC_*` variables are intentionally NOT used to keep Docker images environment-agnostic.

## Configuration Flow

### 1. Environment Variables in compose.yml

The `compose.yml` file passes the `DOMAIN` variable to the platform service:

```yaml
environment:
  DOMAIN: ${DOMAIN:-localhost}
```

### 2. URL Derivation in env.sh

The `services/platform/env.sh` script derives `SITE_URL` from the `DOMAIN` variable:

```bash
# Domain configuration - auto-derive SITE_URL
local base_url="${DOMAIN:-http://localhost}"

# Ensure DOMAIN includes a protocol
if [[ ! "$base_url" =~ ^https?:// ]]; then
  base_url="http://${base_url}"
fi

# Site URL - the canonical base URL for the platform
export SITE_URL="${SITE_URL:-${base_url}}"
```

## Examples

### Local Development

```bash
# .env
DOMAIN=http://localhost
```

Results in:
- `SITE_URL=http://localhost:3000` (server-side)
- Browser automatically uses `http://localhost:3000/ws_api` for Convex

### Production with Domain

```bash
# .env
DOMAIN=https://demo.tale.dev
```

Results in:
- `SITE_URL=https://demo.tale.dev` (server-side)
- Browser automatically uses `https://demo.tale.dev/ws_api` for Convex

### Production with IP Address

```bash
# .env
DOMAIN=http://203.0.113.10
```

Results in:
- `SITE_URL=http://203.0.113.10` (server-side)
- Browser automatically uses `http://203.0.113.10/ws_api` for Convex

## Proxy Configuration

The Caddy proxy automatically handles:

1. **HTTP for localhost**: No TLS, direct HTTP access
2. **HTTPS for domains**: Automatic certificate provisioning via ACME
3. **HTTP for IP addresses**: No TLS (ACME doesn't support IP addresses)

The proxy routes are configured in `services/proxy/Caddyfile`:

```
{$DOMAIN:localhost} {
  # Convex WebSocket API
  handle_path /ws_api* {
    reverse_proxy http://platform:3210
  }

  # Convex HTTP Actions API
  handle_path /http_api* {
    reverse_proxy http://platform:3211
  }

  # Main application
  handle {
    reverse_proxy http://platform:3000
  }
}
```

## Troubleshooting

### Issue: Client can't connect to Convex

**Check**:

1. Verify `DOMAIN` is set correctly in `.env`
2. Verify the proxy is running and accessible
3. Check browser console for WebSocket connection errors
4. Ensure the `/ws_api` path is being proxied correctly

### Issue: Platform service can't connect to Convex backend

**Check**:

1. Verify `SITE_URL` is set correctly
2. Check that the Convex backend is running on port 3210
3. Verify Next.js rewrites are configured in `next.config.ts`

### Issue: HTTPS not working

**Check**:

1. Verify `DOMAIN` is set to a valid domain name (not localhost or IP)
2. Check that DNS is pointing to your server
3. Verify ports 80 and 443 are open
4. Check Caddy logs for certificate provisioning errors

## Why No NEXT_PUBLIC_* Variables?

Next.js injects `NEXT_PUBLIC_*` environment variables at **build time** into the client JavaScript bundle. This creates a problem for Docker deployments:

- Images built with `NEXT_PUBLIC_CONVEX_URL=https://staging.example.com` cannot be reused for production
- You would need to rebuild the image for each environment

By deriving URLs from `window.location.origin` at runtime, the same Docker image works in any environment.

## Related Documentation

- [Convex Self-Hosted Setup](./convex-self-hosted-setup.md)
- [Configuration Guide](../CONFIGURATION.md)
