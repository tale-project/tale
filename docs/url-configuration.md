# URL Configuration Guide

This document explains how URLs are configured in the Tale Platform and how they're auto-derived from the `DOMAIN` environment variable.

## Architecture Overview

The Tale Platform has three types of URL configurations:

1. **Client-side URLs** (Browser → Services via Proxy)
2. **Backend-to-Backend URLs** (Platform Service → Convex Backend)
3. **Public URLs** (External access)

## URL Auto-Derivation from DOMAIN

### Setting the DOMAIN Variable

The `DOMAIN` environment variable is the single source of truth for all public URLs.

**Important**: Set `DOMAIN` to the full URL **including** the protocol (http:// or https://):

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

### Auto-Derived URLs

When you set `DOMAIN=https://demo.tale.dev`, the following URLs are automatically derived:

#### Client-Side URLs (Browser Access)

These are used by the browser to connect to services through the Caddy proxy:

```bash
NEXT_PUBLIC_APP_URL=https://demo.tale.dev
NEXT_PUBLIC_CONVEX_URL=https://demo.tale.dev/ws_api
NEXT_PUBLIC_CONVEX_SITE_URL=https://demo.tale.dev/http_api
NEXT_PUBLIC_DEPLOYMENT_URL=https://demo.tale.dev/ws_api
SITE_URL=https://demo.tale.dev
```

#### Backend-to-Backend URLs

These are used by the Platform service to connect to the Convex backend:

```bash
CONVEX_CLOUD_ORIGIN=${base_url}/ws_api
CONVEX_SITE_ORIGIN=${base_url}/http_api
```

**Important**: These use the same base URL with proxy paths (`/ws_api` and `/http_api`) for backend-to-backend communication, ensuring consistent routing through the proxy.

## Configuration Flow

### 1. Environment Variables in compose.yml

The `compose.yml` file passes the `DOMAIN` variable to the platform service:

```yaml
environment:
  DOMAIN: ${DOMAIN:-localhost}
```

### 2. URL Derivation in env.sh

The `services/platform/env.sh` script derives all URLs from the `DOMAIN` variable:

```bash
# Domain configuration - auto-derive URLs
local domain="${DOMAIN:-localhost}"
local protocol="http"

# Use HTTPS for non-localhost domains
if [ "$domain" != "localhost" ] && [ "$domain" != "127.0.0.1" ]; then
  protocol="https"
fi

local base_url="${protocol}://${domain}"

# Client-side URLs use the public domain with proxy paths
export NEXT_PUBLIC_CONVEX_URL="${NEXT_PUBLIC_CONVEX_URL:-${base_url}/ws_api}"
export NEXT_PUBLIC_CONVEX_SITE_URL="${NEXT_PUBLIC_CONVEX_SITE_URL:-${base_url}/http_api}"
export NEXT_PUBLIC_DEPLOYMENT_URL="${NEXT_PUBLIC_DEPLOYMENT_URL:-${base_url}/ws_api}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-${base_url}}"
export SITE_URL="${SITE_URL:-${base_url}}"

# Backend-to-backend URLs ALWAYS use internal Docker network
export CONVEX_CLOUD_ORIGIN="${CONVEX_CLOUD_ORIGIN:-http://127.0.0.1:3210}"
export CONVEX_SITE_ORIGIN="${CONVEX_SITE_ORIGIN:-http://127.0.0.1:3211}"
```

## Override Behavior

You can override any auto-derived URL by setting it explicitly in your `.env` file:

```bash
# Override the auto-derived URL
NEXT_PUBLIC_CONVEX_URL=https://custom.domain.com/ws_api
```

The override priority is:

1. Explicitly set environment variable (highest priority)
2. Auto-derived from DOMAIN
3. Default fallback value (lowest priority)

## Examples

### Local Development

```bash
# .env
DOMAIN=http://localhost
```

Results in:

- `NEXT_PUBLIC_APP_URL=http://localhost`
- `NEXT_PUBLIC_CONVEX_URL=http://localhost/ws_api`
- `SITE_URL=http://localhost`

### Production with Domain

```bash
# .env
DOMAIN=https://demo.tale.dev
```

Results in:

- `NEXT_PUBLIC_APP_URL=https://demo.tale.dev`
- `NEXT_PUBLIC_CONVEX_URL=https://demo.tale.dev/ws_api`
- `SITE_URL=https://demo.tale.dev`

### Production with IP Address

```bash
# .env
DOMAIN=http://203.0.113.10
```

Results in:

- `NEXT_PUBLIC_APP_URL=http://203.0.113.10`
- `NEXT_PUBLIC_CONVEX_URL=http://203.0.113.10/ws_api`
- `SITE_URL=http://203.0.113.10`

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
2. Check that `NEXT_PUBLIC_CONVEX_URL` is using the correct protocol (http/https)
3. Verify the proxy is running and accessible

### Issue: Platform service can't connect to Convex backend

**Check**:

1. Verify `CONVEX_CLOUD_ORIGIN` is set to `http://127.0.0.1:3210`
2. Check that the Convex backend is running
3. Verify the platform service can reach the backend on the internal network

### Issue: HTTPS not working

**Check**:

1. Verify `DOMAIN` is set to a valid domain name (not localhost or IP)
2. Check that DNS is pointing to your server
3. Verify ports 80 and 443 are open
4. Check Caddy logs for certificate provisioning errors

## Related Documentation

- [Convex Self-Hosted Setup](./convex-self-hosted-setup.md)
- [Configuration Guide](../CONFIGURATION.md)
