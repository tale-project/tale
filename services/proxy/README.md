# Tale reverse proxy

Caddy terminates TLS and routes a deployment's public requests to the platform,
backend and optional docs service. The entrypoint renders the checked-in
[`Caddyfile`](Caddyfile) from the deployment environment before starting Caddy.

## Follow a request

| Destination | Traffic |
| --- | --- |
| `platform:3000` | Frontend/static assets and the platform health endpoint |
| `BACKEND_UPSTREAM` (default `backend-api:3005`) | Application/auth/REST APIs, events, WebDAV, SCIM, identity, webhooks and configured object-store paths |
| `docs:3002` | Prose documentation on the separate `DOCS_URL` host, when that service is deployed |
| Internal health listener on `2020` | Proxy health checks |

The platform origin’s `/docs` route is the interactive API reference; it is not a mount for the prose docs site. `/openapi.json` serves the same-origin API schema. The docs host uses passive health checks because production CLI stacks do not include `docs` by default; the host setting alone does not add that service.

The entrypoint inserts backend routes before the frontend catch-all. Read the
rendered route list when adding an endpoint: a new machine API must reach the
backend and retain machine-readable failure responses.

Public ports are `80` and `443`. `/metrics/*` is token-gated; the configured
upstreams determine which metrics endpoints are available. See the
[operator monitoring guide](../../docs/en/self-hosted/operate/observability/prometheus-grafana.md).

## Configure TLS and public paths

- `SITE_URL`: the canonical public origin, such as `https://tale.example.com`.
- `DOCS_URL`: the separate documentation origin, defaulting to `https://docs.<HOST>`.
- `ADDITIONAL_SITE_URLS`: other origins served by the same platform deployment.
- `TLS_MODE`: `selfsigned` for Caddy’s internal CA, `letsencrypt` for public ACME, or `external` behind an upstream TLS terminator.
- `TLS_EMAIL`: contact address for ACME notifications.
- `BASE_PATH`: an optional deployment subpath.
- `BACKEND_UPSTREAM`: backend host and port reachable from this container.

For an internal CA, install the CA certificate in each client device's trust
store after verifying its origin. Running `caddy trust` **inside the container**
does not install trust on the host or another user's computer. Follow the
[TLS and domains guide](../../docs/en/self-hosted/configuration/tls-and-domains.md)
for the appropriate deployment path; do not use disabled certificate checking
as the normal client configuration.

## Diagnose upstream failures

A backend `502`, `503` or `504` gives browser navigation a maintenance page.
Machine routes receive JSON with `UPSTREAM_UNAVAILABLE`, the original HTTP
status, `Retry-After: 5` and `X-Request-Id`. These edge-generated errors have no
`X-Tale-Api-Version`, because the application did not produce them.

Malformed request bodies need a sender fix:

| Error | Cause |
| --- | --- |
| `400 BODY_LENGTH_MISMATCH` | An HTTP/2 body ended before its declared `Content-Length`. |
| `400 BODY_CHUNK_MALFORMED` | HTTP/1.1 chunk framing is invalid, such as a non-hexadecimal size or missing CRLF. |

The `handle_errors` rules apply these body refusals on every path. Retrying the
same malformed request with backoff will not repair it.

On either public host, `/health` is Caddy’s own `OK` response. It stays green while the platform restarts. On the platform origin, use `/api/health` for platform liveness or `/status.json` for its public dependency report; check the response body, since an unknown frontend path can return an app shell with `200`.

Inspect the failing upstream and its health before restarting the proxy. A
working TLS connection proves the public listener is reachable; it does not
prove the backend or its database is ready.

From the repository root, with the intended Compose deployment configured:

```bash
bun run --filter @tale/proxy logs
bun run --filter @tale/proxy docker:build
```

For container inspection use `docker compose exec proxy sh` from the deployment
directory. The workspace's legacy `trust-certs` helper runs only inside that
container and therefore does not complete client trust setup.
