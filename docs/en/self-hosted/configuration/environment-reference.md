---
title: Environment reference
description: Complete reference of all environment variables for configuring Tale.
---

The environment reference catalogues every variable Tale reads at container start. Operators consult this page when a knob needs changing — a domain, a TLS mode, an SSO tenant — and again when something the runtime expected to find isn't there. The source of truth is `.env.example` and the per-service env loaders; the tables below are grouped by surface so the variables that govern one concern stay near each other.

Every variable lives in `.env` at the project root. `tale init` provisions the file with sensible defaults; production deployments override domain, TLS, and database values, and most installs touch nothing else.

## How to read this page

Variables are grouped by what they control — domain, TLS, secrets, database, monitoring, SSO, trusted headers, retention, deployment. Each group opens with a sentence or two naming what the group governs, then a `Name | Default | Description` table. Variables without a default are unset by default; missing required ones cause the container to refuse to start with the message named on the [Troubleshooting](/self-hosted/operate/observability/troubleshooting) page.

Changes take effect at container start, so editing `.env` requires `tale deploy` (production) or `tale start` (local) to pick up. A running stack never re-reads `.env`.

## Domain

`HOST` is the hostname Docker uses for internal routing and email; `SITE_URL` is the full URL users type into a browser, including any non-standard port. `BASE_PATH` is only set when an upstream proxy serves Tale under a subpath.

| Name        | Default              | Description                                                                                 |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `HOST`      | `tale.local`         | Hostname without protocol. Used for Docker network aliases and outbound email headers.      |
| `SITE_URL`  | `https://tale.local` | Full canonical URL with protocol. Used for external links and auth callbacks.               |
| `BASE_PATH` | _(empty)_            | Subpath when behind a path-prefixing proxy (e.g. `/app`). Leave empty for root deployments. |

`SITE_URL` must match the URL users actually reach. If your reverse proxy listens on `:8443`, include it: `SITE_URL=https://example.com:8443`. The proxy uses this value to build OAuth callback URLs and the password-reset link, so a mismatch silently breaks both flows.

## TLS

Three modes cover the certificate options. `selfsigned` is the local default; `letsencrypt` is the production default; `external` is for deployments where an upstream proxy already terminates TLS.

| Name        | Default      | Description                                                                             |
| ----------- | ------------ | --------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | Certificate handling: `selfsigned`, `letsencrypt`, or `external`.                       |
| `TLS_EMAIL` | _(empty)_    | Contact email for Let's Encrypt ACME notifications. Recommended whenever `letsencrypt`. |

Self-signed certificates trigger a browser warning until you run `docker exec tale-proxy caddy trust` on the host. Let's Encrypt needs ports 80 and 443 reachable from the public internet for the ACME challenge. External mode runs Caddy on HTTP only; the upstream proxy handles TLS and forwards WebSocket upgrades for the Convex realtime channel.

## Security secrets

These are the secrets the platform refuses to start without. `tale init` generates each one; rotating them invalidates anything previously encrypted with the old value.

| Name                    | Default   | Description                                                                                                                           |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | _(unset)_ | Signing key for auth sessions. Generate with `openssl rand -base64 32`. Required.                                                     |
| `ENCRYPTION_SECRET_HEX` | _(unset)_ | 32-byte hex key for the in-database secret box. Generate with `openssl rand -hex 32`. Rotating invalidates stored guardrails secrets. |
| `INSTANCE_SECRET`       | _(unset)_ | Seed for the Convex admin key `tale deploy` derives. Generate with `openssl rand -hex 32`.                                            |
| `SOPS_AGE_KEY`          | _(unset)_ | Inline age secret key for SOPS encryption of `providers/*.secrets.json`. `tale init` provisions this by default.                      |
| `SOPS_AGE_KEY_FILE`     | _(unset)_ | Path to a file containing one or more age keys, one per line. Use this form for key rotation.                                         |

The `.env.example` file ships placeholder secrets. Replace every one before starting the stack, even for local development; the placeholders are public on GitHub and an attacker who can reach the instance can forge auth tokens with them. The SOPS modes — encrypted, plaintext, key rotation — are covered on [Providers](/self-hosted/configuration/providers#provider-secrets-storage).

## Database

`DB_PASSWORD` is the password for the bundled Postgres container. The override variables only matter when pointing Tale at an external Postgres instance — the full pattern is on [Production deployment](/self-hosted/install/linux-server#using-an-external-database).

| Name                   | Default   | Description                                                                                                                       |
| ---------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`          | _(unset)_ | Password for the bundled Postgres. Required when using the `db` container.                                                        |
| `POSTGRES_URL`         | _(unset)_ | Override the auto-built connection URL. Format `postgresql://user:pass@host:port` without a database name. Convex appends `tale`. |
| `RAG_DATABASE_URL`     | _(unset)_ | Per-service override for RAG. Include the database name (`/tale_knowledge`).                                                      |
| `CRAWLER_DATABASE_URL` | _(unset)_ | Per-service override for the crawler. Include the database name (`/tale_knowledge`).                                              |

Without `POSTGRES_URL`, Tale constructs the URL as `postgresql://tale:${DB_PASSWORD}@db:5432`. The two service-specific URLs override the base URL only for the named service, which is what makes read replicas and per-service routing possible.

## Error tracking

Tale's error reporting speaks the Sentry DSN format. Set the variable to a Sentry, GlitchTip, or Bugsink DSN; leave it unset to keep errors in Docker logs only.

| Name                        | Default   | Description                                                                                 |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | _(unset)_ | DSN endpoint for crash and error reporting. Compatible with Sentry, GlitchTip, and Bugsink. |
| `SENTRY_TRACES_SAMPLE_RATE` | `1.0`     | Fraction of transactions sampled for performance tracing. Set to `0.0` to disable.          |

## Monitoring

Each service exposes a Prometheus text-format `/metrics` endpoint on the internal Docker network. To expose them through the proxy, set a bearer token:

| Name                   | Default   | Description                                                                                                             |
| ---------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `METRICS_BEARER_TOKEN` | _(unset)_ | Bearer token required to read `/metrics/<service>` through the proxy. When unset, every metrics endpoint returns `401`. |

The full endpoint list and a sample Prometheus scrape config are on [Operations](/self-hosted/operate/observability/operations#monitoring).

## Service URLs

Docker Compose wires service-to-service traffic automatically, so the URLs below rarely need overriding. The variables exist for custom topologies — running RAG on a separate host, scaling the crawler horizontally, etc.

| Name          | Default               | Description                                         |
| ------------- | --------------------- | --------------------------------------------------- |
| `CRAWLER_URL` | `http://crawler:8002` | Crawler service endpoint, consumed by the platform. |
| `RAG_URL`     | `http://rag:8001`     | RAG service endpoint, consumed by the platform.     |

## Docker

These control how `docker compose` and `tale deploy` pull images.

| Name          | Default  | Description                                                                     |
| ------------- | -------- | ------------------------------------------------------------------------------- |
| `PULL_POLICY` | `build`  | `build` for local development; `always` to pull prebuilt images from GHCR.      |
| `VERSION`     | `latest` | Image version tag. Combine with `PULL_POLICY=always` to pin a specific release. |

## Microsoft Entra SSO

These three variables only matter when configuring SSO from `.env` instead of the in-app **Settings > Integrations** screen. Most operators use the UI; the env-var form is useful for infrastructure-as-code setups where the SSO config lives in the same repo as `.env`.

| Name                                | Default   | Description                              |
| ----------------------------------- | --------- | ---------------------------------------- |
| `AUTH_MICROSOFT_ENTRA_ID_ID`        | _(unset)_ | Microsoft Entra application (client) ID. |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET`    | _(unset)_ | Microsoft Entra client secret.           |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID` | _(unset)_ | Microsoft Entra directory (tenant) ID.   |

The end-to-end SSO flow lives on [Authentication](/self-hosted/admin/authentication#microsoft-entra-id-sso).

## Trusted headers

For deployments behind an authenticating reverse proxy — Authelia, Authentik, oauth2-proxy — Tale reads the user's identity from HTTP headers the proxy sets, then provisions an account on first request.

| Name                              | Default        | Description                                                                              |
| --------------------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `TRUSTED_HEADERS_ENABLED`         | `false`        | Set to `true` to enable trusted-header auth. The login page is bypassed when this is on. |
| `TRUSTED_HEADERS_INTERNAL_SECRET` | _(unset)_      | Shared secret the convex endpoint validates before honouring headers. Defense-in-depth.  |
| `TRUSTED_EMAIL_HEADER`            | `Remote-Email` | HTTP header name carrying the user's email address.                                      |
| `TRUSTED_NAME_HEADER`             | `Remote-Name`  | HTTP header name carrying the user's display name.                                       |
| `TRUSTED_ROLE_HEADER`             | `Remote-Role`  | HTTP header name carrying the role (`admin`, `developer`, `editor`, or `member`).        |
| `TRUSTED_TEAMS_HEADER`            | `Remote-Teams` | HTTP header name carrying a comma-separated `id:name` team list.                         |

Only enable trusted headers when the upstream proxy strips these headers from external requests. If external clients can set them directly, they can impersonate any user. The full configuration walk-through is on [Authentication](/self-hosted/admin/authentication#trusted-headers).

## Retention

The retention bounds for every data category come from JSON files under `TALE_CONFIG_DIR/retention/`. The environment variables below only tighten those bounds — they cannot widen what the file declares. The full layered model is on [Retention](/self-hosted/configuration/retention).

A handful of variables touch the audit-log floor and the legal-hold flow rather than per-category bounds:

| Name                                     | Default   | Description                                                                        |
| ---------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `TALE_RETENTION_DISABLED`                | `false`   | Set to `true` to no-op the nightly cleanup. Operator kill-switch for migrations.   |
| `TALE_AUDIT_PEPPER`                      | _(unset)_ | Secret of 16+ chars. Enables HMAC-SHA256 hashing of email and IP in audit rows.    |
| `TALE_AUDIT_SIGNING_KEY`                 | _(unset)_ | Signs `auditLogCheckpoints` rows to distinguish retention scrubs from tampering.   |
| `TALE_LEGAL_HOLD_RELEASE_COOLDOWN_HOURS` | `24`      | Hours between approval and effective release of a legal hold.                      |
| `TALE_LEGAL_HOLD_SINGLE_ADMIN_OK`        | `false`   | Set to `true` to allow single-admin instances to self-approve legal-hold releases. |

The per-category `_MIN` / `_MAX` overrides are listed in full on [Retention — Environment variables](/self-hosted/configuration/retention#environment-variables-tightening-overlay).

## AI providers

Provider API keys, base URLs, and model definitions are not environment variables — they live in JSON files under `TALE_CONFIG_DIR/providers/`. The on-disk schema, the SOPS encryption modes, and the rules for forwarding provider-specific options are on [Providers](/self-hosted/configuration/providers).

## Where this fits

The environment reference is the operator's API to Tale. Anything the runtime needs that isn't shipped in code or set through the UI lives in one of the variables above, and most of them have sensible defaults — the production-grade install pages only override domain, TLS, secrets, and the database. The UI counterparts for the values surfaced in the app live under **Settings > Governance**, **Settings > Providers**, and **Settings > Branding**; reach for [Governance](/platform/admin/governance), [Providers](/self-hosted/configuration/providers), and [Branding](/platform/admin/branding) when you need the per-feature reference.

When the runtime expects a variable that isn't there, the boot log says so on stderr. [Troubleshooting](/self-hosted/operate/observability/troubleshooting) catalogues the most common environment-misconfiguration failure modes; the [Release notes format](/self-hosted/operate/release-notes/format) page covers how deprecations land.
