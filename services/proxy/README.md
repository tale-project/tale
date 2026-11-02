# Tale reverse proxy

Traefik terminates TLS and routes a deployment's public requests to the platform, backend, blob
store, sandbox device hub and optional docs service. Each service declares its own routes in
container labels: [`compose.yml`](../../compose.yml), and
[`traefik-labels.ts`](../../tools/cli/src/lib/compose/services/traefik-labels.ts) for
`tale deploy`. What belongs to the edge rather than to one service is rendered at boot from the
deployment environment by [`render/config.js`](render/config.js): the hosts it serves, the subpath,
the refusals that run before any route, the metrics gate, and the answers while a service is
absent or failing.

## One image, two roles

The command picks the role ([`tale-proxy`](tale-proxy)):

| Command | Role |
| --- | --- |
| `edge` (default) | Renders the configuration ([`render/main.js`](render/main.js), run with njs), issues the self-signed certificates ([`render/pki.js`](render/pki.js)), then runs Traefik and the responder: a loopback nginx that writes the edge's own answers. Publishes `80` and `443`. |
| `docker-api` | The read-only Docker API proxy ([`docker-api/nginx.conf`](docker-api/nginx.conf)), the one way Traefik reads the labels. It alone mounts the Docker socket, read-only, and listens on `2375` of an `internal` network it shares with the edge only. |
| `health` | The image's health check, for either role. |

The Docker API proxy answers `GET` and `HEAD` on the version, ping, container list, container
inspect and events endpoints, and refuses every other method and path with `403`. Traefik routes
only a container that carries `traefik.enable=true` and belongs to one of the Compose projects in
`TALE_PROXY_PROJECTS`, which `compose.yml` and `tale deploy` set; the edge refuses to start
without it.

## Follow a request

| Destination | Traffic |
| --- | --- |
| `platform:3000` | Pages, static assets, the platform's machine doors and its WebSocket, and `/api/health` |
| `backend-api:3005` | Application/auth/REST APIs, events, WebDAV, SCIM, identity and webhooks |
| `object-store:9000` | `/<OBJECT_STORE_BUCKET>/*`, forwarded verbatim for presigned URLs |
| `docs:3002` | Prose documentation on the separate `DOCS_URL` host, when that service is deployed |
| `sandbox:<SANDBOX_HUB_PORT>` | `/sandbox/tunnel` only: the WebSocket each connected sandbox device keeps open to the spawner's device hub |
| Internal health entrypoint on `2020` | Proxy health checks |

The platform origin's `/docs` route is the interactive API reference; it is not a mount for the
prose docs site. `/openapi.json` serves the same-origin API schema. Only the development chain runs
the `docs` service; without it the docs host answers `502`. Setting `DOCS_URL` alone does not add
that service.

Routers run by priority, highest first: the edge's refusals, the blob store and the tunnel, the
platform's health probe, the edge's answer to that probe while the platform is absent, the
backend's lanes, the platform's machine doors and pages, and last the edge's answers while a
service is absent. A new machine API must match a backend lane
(`BACKEND_LANES` in `traefik-labels.ts`, kept equal to the edge's absent-backend rule by
[`render/config.test.ts`](render/config.test.ts)) so it keeps machine-readable failure responses.

Public ports are `80` and `443`. With `METRICS_BEARER_TOKEN` set, `/metrics/platform`,
`/metrics/sla-rules` and `/metrics/backend` answer a request that carries it as a bearer token;
every other `/metrics` request answers `401`. See the
[operator monitoring guide](../../docs/en/self-hosted/operate/observability/prometheus-grafana.md).

## Configure TLS and public paths

- `SITE_URL`: the canonical public origin, such as `https://tale.example.com`.
- `DOCS_URL`: the separate documentation origin, defaulting to `https://docs.<HOST>`.
- `ADDITIONAL_SITE_URLS`: other origins served by the same platform deployment.
- `TLS_MODE`: `selfsigned` for the proxy's own root certificate, `letsencrypt` for public ACME, or
  `external` behind an upstream TLS terminator.
- `TLS_EMAIL`: contact address for ACME notifications.
- `TRUSTED_PROXIES`: with `TLS_MODE=external`, the address ranges of the TLS-terminating proxy
  whose forwarded headers the edge accepts: CIDR ranges separated by whitespace, or
  `private_ranges` (the default). The other modes ignore it.
- `BASE_PATH`: an optional deployment subpath.

The proxy keeps its state in `/data` (the `proxy-data` volume): the ACME account and certificates
in `acme.json`, and the self-signed root and leaf in `pki/`. The leaf names every site host and the
docs host, and is issued again within 30 days of its end. With `letsencrypt`, the proxy asks for a
host's certificate again once the host's DNS points at this server.

Behind an external TLS terminator, the edge serves plain HTTP on the published port 80 and learns
the browser's scheme and address only from the terminator's `X-Forwarded-Proto` and
`X-Forwarded-For`, which it accepts from trusted peers alone. Send both and keep the original
`Host`: the platform recognizes each configured origin from that pair. The edge refuses to start on
a `TRUSTED_PROXIES` entry that is neither a CIDR range nor `private_ranges`. Keep port 80 reachable
from the terminator only, and narrow `TRUSTED_PROXIES` to the terminator's own range where you can:
any client inside a trusted range could otherwise claim an HTTPS connection it never made.

For the self-signed mode, copy the root certificate out of the container
(`bun run --filter @tale/proxy trust-certs` writes `./tale-root.crt`) and install it in each client
device's trust store after verifying its origin. Follow the
[TLS and domains guide](../../docs/en/self-hosted/configuration/tls-and-domains.md) for the
appropriate deployment path; do not use disabled certificate checking as the normal client
configuration.

## Diagnose upstream failures

While the platform answers `502`, `503` or `504`, browser navigation gets the maintenance page and
the platform's machine doors get JSON with `UPSTREAM_UNAVAILABLE`, the original status,
`Retry-After: 5` and `X-Request-Id`. While no platform or backend container is routed at all, the
same answers come with `503`. The backend's own `502`, `503` and `504` pass through unchanged,
since they carry meaning, and a backend that is routed but not answering gets Traefik's plain
`502`. Edge-generated errors have no `X-Tale-Api-Version`, because the application did not produce
them.

On either public host, `/health` is the edge's own `OK` response. It stays green while the
platform restarts. On the platform origin, use `/api/health` for platform liveness or
`/status.json` for its public dependency report; check the response body, since an unknown
frontend path can return an app shell with `200`.

Inspect the failing upstream and its health before restarting the proxy. A working TLS connection
proves the public listener is reachable; it does not prove the backend or its database is ready.
A route that is missing altogether usually means its container lacks its labels or runs outside
the Compose projects in `TALE_PROXY_PROJECTS`: compare `docker inspect` of the container with both.

From the repository root, with the intended Compose deployment configured:

```bash
bun run --filter @tale/proxy logs
bun run --filter @tale/proxy docker:build
bun run --filter @tale/proxy test
```

For container inspection use `docker compose exec proxy sh` from the deployment directory.
