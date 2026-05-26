---
title: Environment reference
description: Every environment variable Tale reads at boot, the default, and the surface in the product the variable controls. The complete operator reference for `.env`.
i18nLintExclude:
  - terminology-loanword
  - prose-exclamation
  - style-numbers
---

Tale reads its configuration from a single `.env` file at the repo root. About a dozen variables are mandatory at first boot; the rest tune behaviour. This page lists every variable the [`.env.example`](https://github.com/tale-project/tale/blob/main/.env.example) ships with, what it defaults to, and which surface in the product consumes it.

Groups are ordered by when you first need them: domain identity, TLS, secrets, database, instance, observability, provider encryption. If a variable changes value, restart the platform container (`docker compose restart tale-platform tale-convex`) for it to take effect.

## How to read this page

Each group is a `Name | Default | Description` table. Variables marked **Required** must be set before `docker compose up` succeeds. Variables marked **Optional** can be left unset; the column's description names what disabling the feature does.

The `.env.example` file ships with inline comments that explain each variable in context; this page is the structured, grouped reference for the same set.

## Domain identity (required at first boot)

| Name        | Default              | Description                                                                                                               |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `HOST`      | `tale.local`         | **Required.** Hostname without protocol. Used for Docker networking and outbound email.                                   |
| `SITE_URL`  | `https://tale.local` | **Required.** Full canonical URL including scheme and any non-standard port. Auth callbacks and external links use this.  |
| `BASE_PATH` | unset                | **Optional.** Path prefix for subpath deployments behind a reverse proxy (e.g. `/app`). Leave unset for root deployments. |

The `SITE_URL` must match what the user types in the browser exactly. A trailing slash, a missing port, or `http` instead of `https` will break the auth callback and produce sign-in loops.

## TLS

| Name        | Default      | Description                                                                                                                       |
| ----------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | One of `selfsigned`, `letsencrypt`, `external`. See [TLS and domains](/self-hosted/configuration/tls-and-domains) for trade-offs. |
| `TLS_EMAIL` | unset        | Contact email for Let's Encrypt notifications. Optional but recommended in production.                                            |

`selfsigned` runs Caddy with a generated cert — the browser warns, fine for development. `letsencrypt` requires a real domain and ports 80/443 reachable from the public Internet. `external` makes Caddy serve plain HTTP; an upstream reverse proxy terminates TLS.

## Security secrets (required)

| Name                    | Default                       | Description                                                                                                                                                                                                                                                     |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | example value in shipped file | **Required.** Base64 secret for the Better Auth session signer. Generate with `openssl rand -base64 32`. Rotating invalidates every session.                                                                                                                    |
| `ENCRYPTION_SECRET_HEX` | example value in shipped file | **Required.** 32-byte hex key. AES-256 key for OAuth and integration credentials and HKDF input for the guardrails secret box. Generate with `openssl rand -hex 32`. Rotating invalidates every DB-stored ciphertext; operators must re-enter affected secrets. |
| `INSTANCE_SECRET`       | example value in shipped file | **Required.** Used to derive the Convex admin key for `tale deploy`. Deploy fails if unset.                                                                                                                                                                     |

Replace the values that ship in `.env.example` before exposing the instance — they are intentionally insecure placeholders.

## Database

| Name           | Default                        | Description                                                                                                                        |
| -------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`  | `tale_password_change_me`      | **Required.** Password for the self-hosted Postgres user. Change before production. Used by every service in compose.              |
| `POSTGRES_URL` | constructed from `DB_PASSWORD` | **Optional.** Override the auto-constructed connection URL. Use when pointing at an external Postgres or a non-standard host/port. |

The auto-constructed form is `postgresql://tale:${DB_PASSWORD}@db:5432`. Convex expects the URL without a database name; the name is derived from the instance configuration.

## Observability

| Name                        | Default | Description                                                                                                                            |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | unset   | Sentry DSN for error tracking. Leave unset to disable. Compatible with self-hosted GlitchTip and Bugsink.                              |
| `SENTRY_TRACES_SAMPLE_RATE` | unset   | Optional sample rate for performance traces (`0.0`–`1.0`). Default behaviour depends on the deployment.                                |
| `METRICS_BEARER_TOKEN`      | unset   | Bearer token required to access the Prometheus `/metrics/*` endpoints. Leave unset to keep metrics endpoints unreachable from outside. |

Setting `METRICS_BEARER_TOKEN` exposes four endpoints behind the token: `/metrics/crawler`, `/metrics/rag`, `/metrics/platform`, and `/metrics/convex` (Convex's 261 built-in metrics). See [Observability config](/self-hosted/configuration/observability-config) for the scrape config.

## Provider secrets encryption

| Name                | Default | Description                                                                                                                                        |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOPS_AGE_KEY`      | unset   | Inline age secret key. Encrypts `providers/*.secrets.json`. Default mode after `tale init`. Multiple keys are not supported inline.                |
| `SOPS_AGE_KEY_FILE` | unset   | Path to a file with one or more age keys (one per line; `#` comments allowed). Required for key rotation. Mutually exclusive with the inline form. |

When both are unset, Tale stores `providers/*.secrets.json` as plaintext JSON at mode 0600. Reach this mode only when the host disk is encrypted at rest or the files are produced by external tooling (a Kubernetes Secret mount, a Vault template). Rotating an age key is appending the new key, re-saving each provider in the UI, then dropping the old key. See [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops) for the full rotation walk.

## Feature flags

Optional toggles for features not enabled by default. Each flag turns one feature on or off at boot; toggling requires a restart of the platform container.

| Name                      | Default | Description                                                                     |
| ------------------------- | ------- | ------------------------------------------------------------------------------- |
| `MICROSOFT_AUTH_ENABLED`  | `false` | Enables the Microsoft Entra sign-in option.                                     |
| `TRUSTED_HEADERS_ENABLED` | `false` | Enables the trusted-headers auth mode (identity supplied by the reverse proxy). |
| `FILE_EVENTS_ENABLED`     | `false` | Enables file-watching events for the OneDrive-sync integration.                 |

## Versioning

| Name           | Default       | Description                                                                                     |
| -------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `TALE_VERSION` | latest stable | The image tag pulled by `docker compose pull`. Pin to a specific tag for reproducible upgrades. |

## Where this fits

The variables here are the operator's contact surface; the UI surface that consumes most of them lives under [Platform admin](/platform/admin/overview). Provider keys are the one half-and-half: the keys themselves live in `providers/*.secrets.json`, but the UI under **Settings > Providers** is how you add and rotate them in practice. The next read worth queuing is [Providers](/self-hosted/configuration/providers) — it covers the file form, the SOPS modes, and the resolve-and-failover behaviour.
