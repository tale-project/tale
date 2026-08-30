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

| Name        | Default             | Description                                                                                                               |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `HOST`      | `localhost`         | **Required.** Hostname without protocol. Used for Docker networking and outbound email.                                   |
| `SITE_URL`  | `https://localhost` | **Required.** Full canonical URL including scheme and any non-standard port. Auth callbacks and external links use this.  |
| `BASE_PATH` | unset               | **Optional.** Path prefix for subpath deployments behind a reverse proxy (e.g. `/app`). Leave unset for root deployments. |

The `SITE_URL` must match what the user types in the browser exactly. A trailing slash, a missing port, or `http` instead of `https` will break the auth callback and produce sign-in loops.

## TLS

| Name        | Default      | Description                                                                                                                       |
| ----------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | One of `selfsigned`, `letsencrypt`, `external`. See [TLS and domains](/self-hosted/configuration/tls-and-domains) for trade-offs. |
| `TLS_EMAIL` | unset        | Contact email for Let's Encrypt notifications. Optional but recommended in production.                                            |

`selfsigned` runs Caddy with a generated cert — the browser warns, fine for development. `letsencrypt` requires a real domain and ports 80/443 reachable from the public Internet. `external` makes Caddy serve plain HTTP; an upstream reverse proxy terminates TLS.

## Security secrets (required)

| Name                    | Default                       | Description                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`    | example value in shipped file | **Required.** Base64 secret for the Better Auth session signer. Generate with `openssl rand -base64 32`. Rotating invalidates every session.                                                                                                                  |
| `ENCRYPTION_SECRET_HEX` | example value in shipped file | **Required.** 32-byte hex key. AES-256 key for OAuth and connector credentials and HKDF input for the guardrails secret box. Generate with `openssl rand -hex 32`. Rotating invalidates every DB-stored ciphertext; operators must re-enter affected secrets. |
| `INSTANCE_SECRET`       | example value in shipped file | **Required.** Used to derive the Convex admin key for `tale deploy`. Deploy fails if unset.                                                                                                                                                                   |

Replace the values that ship in `.env.example` before exposing the instance — they are intentionally insecure placeholders.

## Database

Tale runs two Postgres databases: the operational store (`db`, port 5432) behind the Convex backend, and the knowledge corpus (`knowledge-db`, port 5433) that holds document chunks, embeddings, and crawled pages. Both are ParadeDB and share `DB_PASSWORD`, but they are independent — point either at external infrastructure on its own.

| Name                     | Default                                                             | Description                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD`            | `tale_password_change_me`                                           | **Required.** Password for the self-hosted Postgres user. Change before production. Used by both database containers.                                                                                 |
| `POSTGRES_URL`           | constructed from `DB_PASSWORD`                                      | **Optional.** Override the auto-constructed operational-database URL. Use when pointing at an external Postgres or a non-standard host/port.                                                          |
| `KNOWLEDGE_DATABASE_URL` | `postgresql://tale:${DB_PASSWORD}@knowledge-db:5432/tale_knowledge` | **Optional.** Connection URL the Convex backend uses for the knowledge corpus. Override to relocate the corpus to your own managed ParadeDB — the data-residency-sensitive store moves independently. |
| `KNOWLEDGE_DB_NAME`      | `tale_knowledge`                                                    | **Optional.** Name of the knowledge database. The bundled `knowledge-db` container creates this database on first boot.                                                                               |

The auto-constructed operational form is `postgresql://tale:${DB_PASSWORD}@db:5432`. Convex expects this URL without a database name; the name is derived from the instance configuration. The knowledge corpus lives in `tale_knowledge` with the `private_knowledge` and `public_web` schemas; the **Settings > Data residency** UI writes a richer per-store config than these raw variables, covered in [Data residency](/self-hosted/configuration/data-residency).

## Observability

| Name                        | Default | Description                                                                                                                            |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | unset   | Sentry DSN for error tracking. Leave unset to disable. Compatible with self-hosted GlitchTip and Bugsink.                              |
| `SENTRY_TRACES_SAMPLE_RATE` | unset   | Optional sample rate for performance traces (`0.0`–`1.0`). Default behaviour depends on the deployment.                                |
| `METRICS_BEARER_TOKEN`      | unset   | Bearer token required to access the Prometheus `/metrics/*` endpoints. Leave unset to keep metrics endpoints unreachable from outside. |

Setting `METRICS_BEARER_TOKEN` exposes two endpoints behind the token: `/metrics/platform` and `/metrics/convex` (Convex's 261 built-in metrics, which now carry the RAG and crawl timings as well). See [Observability config](/self-hosted/configuration/observability-config) for the scrape config.

## Provider secrets encryption

| Name                | Default | Description                                                                                                                                        |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOPS_AGE_KEY`      | unset   | Inline age secret key. Encrypts `providers/*.secrets.json`. Default mode after `tale init`. Multiple keys are not supported inline.                |
| `SOPS_AGE_KEY_FILE` | unset   | Path to a file with one or more age keys (one per line; `#` comments allowed). Required for key rotation. Mutually exclusive with the inline form. |

When both age vars are unset, Tale stores `providers/*.secrets.json` as plaintext JSON at mode 0600. Reach this mode only when the host disk is encrypted at rest or the files are produced by external tooling (a Kubernetes Secret mount, a Vault template). Rotating an age key is appending the new key, re-saving each provider in the UI, then dropping the old key. See [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops) for the full rotation walk.

The env-var key source needs no environment-level switch: a provider credential can hold the _name_ of an environment variable instead of a stored key, as long as that name carries the reserved `TALE_PROVIDER_KEY_` prefix. The gate is fail-closed — any other name is rejected, so the field can never point at an unrelated deployment secret — and names are capped at 40 characters. Define the variable here or in your secret manager so both the platform and the Convex backend can read it; the full mechanism is documented in [Providers](/self-hosted/configuration/providers). A subscription-broker credential has a second, separate namespace for the secret Tale presents **to the broker**: that field takes an environment-variable name under the reserved `TALE_TOKEN_SOURCE_` prefix, capped at 60 characters. The two prefixes stay distinct on purpose — a broker secret is not a provider API key, and neither field can name a variable outside its own namespace.

## Connector OAuth apps

OAuth connectors (Gmail, Google Drive, Outlook, Teams, Slack, …) read their vendor app credentials only from the environment. For each connector slug:

| Name                                   | Default | Description                                                                                             |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID`     | unset   | OAuth client ID for that connector. Slug is upper-cased with dashes as underscores (`gmail` → `GMAIL`). |
| `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET` | unset   | Matching client secret.                                                                                 |

Register `${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback` on the vendor app. Details: [Connectors (develop)](/develop/connectors).

## Knowledge cloud import (Documents)

Per-user OneDrive / Google Drive authorizations for **Knowledge → Documents** are separate from org connectors and from login. Register this redirect URI on the Microsoft (or Google) app:

`${SITE_URL}${BASE_PATH}/api/cloud-import/oauth2/callback`

Credential resolution for OneDrive (first match wins):

| Name                                           | Description                                 |
| ---------------------------------------------- | ------------------------------------------- |
| `CLOUD_IMPORT_MICROSOFT_CLIENT_ID` / `_SECRET` | Dedicated Knowledge import app (preferred). |
| `CLOUD_IMPORT_MICROSOFT_TENANT_ID`             | Directory (tenant) ID for that app.         |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET`       | Login Microsoft app.                        |
| `AUTH_MICROSOFT_ENTRA_ID_TENANT_ID`            | Directory (tenant) ID for the login app.    |

Single-tenant Entra app registrations must use a tenant-specific authorize URL — `/common` fails with AADSTS50194. Set the tenant ID (or `organizations` / `common` for a multi-tenant app). When unset, Tale falls back to the org's Entra SSO issuer tenant if configured.

The Microsoft consent screen requests Graph **Files.Read** and **Sites.Read.All** (list/download OneDrive and SharePoint), **User.Read** (account label), and **offline_access** (refresh token for sync). That grant is intentional and per user — it is not attached by signing in to Tale.

Google Drive uses a dedicated app only (no login-app fallback):

| Name                                              | Description                        |
| ------------------------------------------------- | ---------------------------------- |
| `CLOUD_IMPORT_GOOGLE_DRIVE_CLIENT_ID` / `_SECRET` | Knowledge Google Drive import app. |

Register the same cloud-import callback URI on the Google OAuth client. Consent requests **drive.readonly** and **userinfo.email**.

## Feature flags

Optional toggles for features not enabled by default. Each flag turns one feature on or off at boot; toggling requires a restart of the platform container.

| Name                            | Default | Description                                                                                                                     |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED_HEADERS_ENABLED`       | `false` | Enables the trusted-headers auth mode (identity supplied by the reverse proxy).                                                 |
| `FILE_EVENTS_ENABLED`           | `false` | Enables file-watching events for the OneDrive-sync connector.                                                                   |
| `TALE_DEPLOYMENT_CONFIG_ADMINS` | unset   | Comma-separated email allowlist of operators allowed to edit deployment data residency. Empty/unset = read-only for all admins. |

## RAG retrieval tuning

Optional knobs for knowledge-base search. The in-process RAG path (Convex node-actions) re-scores results with a cross-encoder when re-ranking is on. All carry the `RAG_` prefix and are read by the `platform` and `convex` containers at boot; after changing one, run `docker compose restart platform convex` for it to take effect.

| Name                         | Default                                | Description                                                                                                                                                                    |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RAG_RERANKING_ENABLED`      | `false`                                | Re-scores the merged BM25 + vector candidates with a cross-encoder before results are returned. Improves precision at the cost of per-query latency.                           |
| `RAG_RERANKING_MODEL`        | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Cross-encoder model identifier passed to the rerank provider.                                                                                                                  |
| `RAG_RERANKING_PROVIDER`     | `local`                                | Must be set to `api` to enable re-ranking — it posts the candidates to an external `/rerank` endpoint (Cohere/Jina-compatible). `local` is no longer supported and fails fast. |
| `RAG_RERANKING_TOP_K`        | `10`                                   | Maximum number of results the reranker returns. The response never exceeds the request's own `top_k`.                                                                          |
| `RAG_RERANKING_CANDIDATES`   | `30`                                   | Size of the candidate pool fed to the reranker. A wider pool improves re-scoring quality and costs proportionally more time per query.                                         |
| `RAG_RERANKING_API_BASE_URL` | unset                                  | Base URL for the rerank provider; the platform calls `{base_url}/rerank`. Required when re-ranking is enabled.                                                                 |
| `RAG_RERANKING_API_KEY`      | unset                                  | Bearer token sent to the external rerank endpoint. Leave unset for unauthenticated endpoints.                                                                                  |

Re-ranking ships disabled because it adds per-query latency and depends on an external endpoint. Enable it — by setting `RAG_RERANKING_PROVIDER=api` and pointing `RAG_RERANKING_API_BASE_URL` at a hosted rerank service — when retrieval precision matters more than response time. There is no in-process model to download or cache; with re-ranking off, search returns the plain merged BM25 + vector ranking.

## Sessions

| Name                           | Default | Description                                                                                                                                                                                              |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | unset   | **Optional.** Sign a session out after this many minutes of inactivity (`1`–`1440`). The window slides on activity and is enforced server-side across email/password, SSO, and trusted-headers sessions. |

Leave it unset to keep the default session lifetime. When set, an idle session expires server-side once the window elapses, while an active one keeps sliding forward on each request. Org admins can tighten the effective window per organisation — never loosen it past this cap — via the [session idle timeout governance policy](/platform/admin/governance/policies-and-limits); idle sessions under that policy are revoked by a sweep that runs about every five minutes.

## Video-link ingestion (yt-dlp)

When Tale ingests a video link, it fetches the transcript for the agent. YouTube blocks automated access from datacenter/server IPs, so this can fail on a cloud deployment. The deployment ships a PO-token provider wired up by default (see [Video ingestion](/self-hosted/configuration/video-ingestion) for the full picture); the options below are optional overrides and escalations. None guarantees a bypass — a clean egress IP is the single biggest lever. Read by the `convex` container and re-read on each ingestion, so a change takes effect without a restart.

| Name                             | Default                               | Description                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VIDEO_INGEST_PROXY_URL`         | unset                                 | Route yt-dlp egress through a proxy (a residential/ISP IP works best; datacenter proxies are usually flagged too). Schemes: `http`, `https`, `socks4`, `socks4a`, `socks5`, `socks5h` — prefer `socks5h://` so DNS resolves at the proxy.                                                                |
| `VIDEO_INGEST_POT_PROVIDER_URL`  | `http://bgutil-provider:4416` (baked) | Base URL of the PO-token provider supplying the GVS tokens that dissolve YouTube's bot wall. Defaults to the `bgutil-provider` compose sidecar when the baked plugin is present — set only to point at a provider on another host.                                                                       |
| `VIDEO_INGEST_FETCH_POT`         | `always` when a provider is wired     | When yt-dlp requests PO tokens from the provider (`never`/`auto`/`always`). yt-dlp's own `auto` never fetches a token for the player request — exactly where the bot wall hits — so Tale defaults to `always` alongside a provider. `never` bypasses a misbehaving provider.                             |
| `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` | `/opt/yt-dlp/plugins` (baked)         | Directory yt-dlp loads plugins from — each plugin nested one level down (`<dir>/<name>/yt_dlp_plugins/…`). Defaults to the baked-in bgutil plugin dir when present; override only to add your own plugins.                                                                                               |
| `VIDEO_INGEST_COOKIES_FILE`      | unset                                 | Path to a Netscape cookie jar. Guest cookies from an incognito session raise the rate limit with no ban risk; account cookies unlock gated content but risk the account.                                                                                                                                 |
| `VIDEO_INGEST_PLAYER_CLIENT`     | `default,tv_simply`                   | Comma-separated YouTube player-client fallback list. When a PO-token provider is wired the default widens to `default,mweb,tv_simply` (mweb needs a GVS token); set explicitly to force a list.                                                                                                          |
| `VIDEO_INGEST_PO_TOKEN`          | unset                                 | Manually pinned PO token (`CLIENT.CONTEXT+TOKEN`). Mainly for testing — tokens are video-ID-bound and short-lived; prefer the provider.                                                                                                                                                                  |
| `VIDEO_INGEST_IMPERSONATE`       | unset                                 | Browser TLS/JA3 impersonation target (e.g. `safari`). Requires `curl_cffi` in the image; leave unset unless you know it's available.                                                                                                                                                                     |
| `VIDEO_INGEST_BIN_DIR`           | unset                                 | Directory prepended to the yt-dlp/ffmpeg child's `PATH` so a self-provisioned `yt-dlp` (and its Deno runtime) installed outside the image's pinned bin dirs is found first. The `convex` image bakes yt-dlp into `PATH`, so leave it unset there; set it on a host or dev box running its own toolchain. |
| `VIDEO_INGEST_FFMPEG_LOCATION`   | `/usr/bin/ffmpeg`                     | Absolute path to the ffmpeg yt-dlp uses for post-processing (subtitle conversion, audio extraction). Override when ffmpeg lives elsewhere — e.g. Homebrew's `/opt/homebrew/bin/ffmpeg` on a macOS dev box.                                                                                               |

None of these guarantees success against YouTube's adversarial detection. Ordinary public videos, less aggressive platforms, or a residential-IP/self-hosted deployment typically work without any of them.

## Where this fits

The variables here are the operator's contact surface; the UI surface that consumes most of them lives under [Platform admin](/platform/admin/overview). Provider keys are the one half-and-half: the keys themselves live in `providers/*.secrets.json`, but the UI under **Settings > AI providers** is how you add and rotate them in practice. The next read worth queuing is [Providers](/self-hosted/configuration/providers) — it covers the shipped connector files and the reserved variables that hold provider keys.
