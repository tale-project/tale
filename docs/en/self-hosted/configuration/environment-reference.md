---
title: Environment reference
description: Deployment variables, defaults, secret injection, and the services that need each setting.
i18nLintExclude:
  - terminology-loanword
  - prose-exclamation
  - style-numbers
---

Use this reference to find a deployment variable, its default and the process that needs it. The project `.env` is one way to supply values; container environment settings and secret-manager injection are also deployment inputs. The [example environment file](https://github.com/tale-project/tale/blob/main/.env.example) carries the corresponding source configuration.

After changing an environment value, recreate the consuming services through your deployment workflow. `docker compose restart` retains the container’s existing environment. File-based organization configuration has a separate lifecycle.

## How to read this page

Tables list names, defaults, and purpose. Required values must reach the consuming service; deployment tooling may generate some of them. Optional values can remain unset. A documented default can come from the shipped Compose configuration rather than the process itself.

Use the example file alongside this reference and inspect your effective service environment before diagnosing a missing value.

## Domain identity (required at first boot)

| Name        | Default             | Description                                                                                                               |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `HOST`      | `localhost`         | **Required.** Hostname without protocol. Used for Docker networking and outbound email.                                   |
| `SITE_URL`  | `https://localhost` | **Required.** Full canonical URL including scheme and any non-standard port. Auth callbacks and external links use this.  |
| `ADDITIONAL_SITE_URLS` | unset      | **Optional.** Other origins the same deployment answers on, comma- or whitespace-separated (e.g. `https://a.example,https://b.example`). Each is a full entry point. See [TLS and domains](/self-hosted/configuration/tls-and-domains#several-domains-at-once). |
| `BASE_PATH` | unset               | **Optional.** Path prefix for subpath deployments behind a reverse proxy (e.g. `/app`). Leave unset for root deployments. |
| `DOCS_URL` | `https://docs.<HOST>` | Public origin for the proxy’s separate documentation host. The deployment must also include the docs service. |

`SITE_URL` identifies the canonical public origin. Keep scheme, hostname, and port consistent with the browser address and registered callbacks; `BASE_PATH` supplies a deployment path prefix. A trailing slash is normalized by the proxy. Additional addresses belong in `ADDITIONAL_SITE_URLS` as bare origins. Invalid additional origins stop backend startup.

The prose documentation uses its own origin. On the platform origin, `/docs` opens the interactive API reference and `/openapi.json` serves its schema. `DOCS_URL` changes the proxy’s docs host; it does not install the docs service or rewrite links in existing client bundles. The SEO tooling’s `TALE_DOCS_URL` and the docs service’s build/runtime path prefix `DOCS_BASE_URL` are separate settings.

## TLS

| Name        | Default      | Description                                                                                                                       |
| ----------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `TLS_MODE`  | `selfsigned` | One of `selfsigned`, `letsencrypt`, `external`. See [TLS and domains](/self-hosted/configuration/tls-and-domains) for trade-offs. |
| `TLS_EMAIL` | unset        | Contact email for Let's Encrypt notifications. Optional but recommended in production.                                            |
| `TRUSTED_PROXIES` | `private_ranges` | With `TLS_MODE=external`, the addresses whose forwarded headers the proxy accepts: CIDR ranges separated by spaces, or `private_ranges`. The other modes ignore it. See [TLS and domains](/self-hosted/configuration/tls-and-domains). |

`selfsigned` runs Caddy with a generated cert — the browser warns, fine for development. `letsencrypt` requires a real domain and ports 80/443 reachable from the public Internet. `external` makes Caddy serve plain HTTP; an upstream reverse proxy terminates TLS.

## Security secrets (required)

| Name                    | Default                       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | example value in shipped file | Authentication secret shared by backend replicas. Generate a high-entropy value, for example with `openssl rand -base64 32`. Keep it stable; changing it can invalidate sessions and active sign-in flows. |
| `ENCRYPTION_SECRET_HEX` | example value in shipped file | 32-byte hex encryption root for stored secrets; generate with `openssl rand -hex 32`. Preserve the value matching existing encrypted data. Replacing it does not migrate ciphertext: restore the matching key or re-enter affected secrets through their supported flow. |
| `INSTANCE_SECRET`       | example value in shipped file | **Required.** The instance's root secret: 64 hex chars, generated by `tale init` (`openssl rand -hex 32` by hand). At boot the WebDAV app-password HMAC key (`WEBDAV_APP_PASSWORD_HMAC_KEY`) is derived from it unless you set that key yourself, and the short-lived tokens sandbox sessions use to fetch blobs are signed with a subkey of the same derivation. Keep it stable across deploys: rotating it re-derives that key and invalidates every WebDAV app-password. |
| `SANDBOX_TOKEN`         | example value in shipped file | **Required.** Shared HMAC secret between the backend and the sandbox spawner: the backend signs every spawner call with it, and the spawner rejects unsigned ones. The spawner refuses to start without it — it holds the host docker socket, so there is no unsigned mode. `tale init` and `bun run dev` mint it; a stack you compose yourself sets it (`openssl rand -hex 32`) before the first boot. Rotating it means restarting the backend and the spawner together — they must agree. |
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | unset | **Required for sandbox harness turns.** Gateway management credential used by the backend to provision session keys. The backend provisions the gateway on first use; the gateway retains a password hash in `llm-gateway-data`. Keep the matching secret or use the gateway’s supported credential recovery/rotation procedure. Do not wipe its state as routine recovery. The username defaults to `admin` (`SANDBOX_LLM_GATEWAY_ADMIN_USERNAME`). |

Replace the values that ship in `.env.example` before exposing the instance — they are intentionally insecure placeholders.

## Database

Tale keeps two databases: the operational store (`tale_app` — agents, runs, the audit log) and the knowledge corpus (`tale_knowledge` — document chunks, embeddings, crawled pages). A production stack folds both into one ParadeDB service (`db`, port 5432, aliased `knowledge-db`). Both share `DB_PASSWORD`, and the corpus can be pointed at external infrastructure on its own.

| Name                                      | Default                                                             | Description                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD` | `tale_password_change_me` | **Required for bundled Postgres.** Password shared by the application and knowledge databases in the packaged layout. Replace the example value before production. |
| `DATABASE_URL`                            | constructed from `DB_PASSWORD`                                      | **Optional.** Connection URL for the operational database. Set it to point the backend at a Postgres of your own; it needs no extensions and no superuser, only a database and a role that may create schemas. Read on every start.                                                       |
| `DATABASE_POOL_MAX`                       | `10`                                                                | **Optional.** Connections one backend process opens to the operational database. It costs this twice — the app pool and the job queue's — per `backend-api` and `backend-worker` replica, which is the number to check against a managed Postgres's `max_connections`.                    |
| `POSTGRES_CA_FILE`                        | unset                                                               | **Optional.** Path to a PEM bundle trusted for **every** Postgres connection: the operational database, the knowledge corpus, and the databases organizations bring themselves. Needed whenever a URL asks for `sslmode=verify-ca` or `verify-full` against a provider whose root is not one Node ships (Amazon RDS is the common one). Concatenate several roots into one file if your databases use different providers. |
| `KNOWLEDGE_DATABASE_URL` | `postgresql://tale:${DB_PASSWORD}@knowledge-db:5432/tale_knowledge` | Connection URL for the default knowledge corpus. Pointing it elsewhere selects another database; it does not migrate existing chunks or vectors. |
| `KNOWLEDGE_DB_POOL_MAX` | `10` | **Optional.** Connections one backend process opens to the knowledge corpus. Every indexing job holds one while it commits a slice of chunks, so a worker allowed more concurrent jobs than this (`WORKER_CONCURRENCY`) queues on the pool — raise the two together. Like `DATABASE_POOL_MAX`, it counts per replica against the corpus database's `max_connections`. |
| `KNOWLEDGE_DB_NAME` | `tale_knowledge` | Name of the knowledge database created by the bundled database initialization. |
| `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` | `1073741824`                                                        | **Optional.** Largest BM25 search index (in bytes) the backend rebuilds synchronously at boot when it finds it corrupted; a larger one is rebuilt by a background job while writes to that corpus are refused. See [Container architecture](/self-hosted/operate/container-architecture). |
| `KNOWLEDGE_INDEX_REPAIR_DISABLED` | unset | `1` or `true` disables automatic boot-time BM25 verification and repair. It does not fix corruption; failed queries or writes need investigation and a controlled repair. |

The auto-constructed operational form is `postgresql://tale:${DB_PASSWORD}@db:5432/tale_app` (override the database name with `APP_DB_NAME`). The knowledge corpus lives in `tale_knowledge` with the `private_knowledge` and `public_web` schemas. These variables set the deployment defaults every organization shares; an organization can additionally point its own corpus and its own bucket at infrastructure of its own under **Settings > Data residency** (per-organization files, applied live, no restart), covered in [Data residency](/self-hosted/configuration/data-residency).

Two things to know before pointing either database at infrastructure of your own:

- **The knowledge corpus needs `pgvector` installed.** Tale creates its schemas and tables on a database that starts empty, but it never installs extensions — the chunk table has a `vector` column, so `CREATE EXTENSION vector;` has to have been run on the target database first. ParadeDB's `pg_search` is optional: without it, search degrades to vector-only rather than failing. The operational database needs no extensions at all.
- **Use a direct or session-compatible Postgres connection.** Job notifications, migration locks, and prepared statements need session semantics. Validate any managed connection proxy against those requirements.

## Object store

Files and media use S3-compatible storage. These variables configure the deployment default. An organization’s explicit connection takes precedence; an unavailable default does not imply that every organization’s own bucket is unavailable.

| Name                             | Default                        | Description                                                                                                                                                             |
| -------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OBJECT_STORE_ACCESS_KEY` | unset | Access key for the deployment’s default S3 connection. For bundled MinIO, configure the same value as `MINIO_ROOT_USER`. Missing credentials do not create a default connection; an organization can still have its own valid connection. |
| `OBJECT_STORE_SECRET_KEY` | auto-generated by `tale init` | Secret key for the default store. For bundled MinIO, it must match `MINIO_ROOT_PASSWORD`. Rotate the store and backend credentials together and verify reads and writes; changing a password does not migrate or inherently orphan blobs. |
| `OBJECT_STORE_BUCKET`            | `tale-blobs`                   | Bucket blobs are stored in. Created if it is absent and the key is allowed to; an existing bucket is used as it is.                                                     |
| `OBJECT_STORE_ENDPOINT` | `http://object-store:9000` in the shipped compose | Backend endpoint for the store. AWS S3 uses no custom endpoint; remove or explicitly clear the bundled endpoint in your effective Compose environment. Set a custom URL for MinIO, R2, or another compatible service. |
| `OBJECT_STORE_REGION`            | `us-east-1`                    | Signing region. Meaningful for AWS; arbitrary but required by the signer for a self-hosted store.                                                                       |
| `OBJECT_STORE_FORCE_PATH_STYLE`  | `true` with an endpoint, `false` without | Address the bucket as `endpoint/bucket/key` rather than `bucket.endpoint/key`. The default follows the endpoint, which is right for both the self-hosted case and AWS; set it only for a store that disagrees with its own shape. |
| `OBJECT_STORE_PREFIX`            | unset                          | Key prefix inside the bucket, so Tale's blobs can share a bucket with other data. Empty means the bucket root.                                                          |
| `OBJECT_STORE_PUBLIC_ENDPOINT`   | `${SITE_URL}` (set by the CLI) | Where the **browser** reaches the store. The proxy publishes the bundled store at `/<bucket>/*` and forwards presigned URLs verbatim, so uploads and downloads run browser↔store directly. When this endpoint is one of the deployment's origins, a link for a browser on another configured origin is signed for that origin. Leave it unset for a bucket the browser can already reach. |

The packaged proxy exposes the bundled store’s object route to browsers without publishing the store’s administration port. An external store can be reached directly through its configured public endpoint.

### How these variables reach the running deployment

At startup, the backend reconciles `default/object-storage/connection.json` with its environment. Apply changed values by recreating `backend-api` and `backend-worker`. The startup messages identify these outcomes:

| Line | Meaning |
| --- | --- |
| `object store (seeded)` | there was no connection; one was written from the environment |
| `object store (reconciled)` | the environment changed; the connection was updated to match |
| `object store (adopted)` | a connection written by an older release was recognised and is now kept in step |
| `object store (ignored)` | the connection is marked `"managedBy": "operator"`, so these variables do nothing |
| `object store (skipped)` | No credential pair was supplied to create a deployment default. Check whether a usable existing or organization connection remains. |
| *(nothing)* | already in step — the steady state |

To manage the store by hand instead, set `"managedBy": "operator"` in `connection.json`; the backend then never touches that file. A file with no `managedBy` at all — written before this behaviour existed — is taken over only if it still names the same bucket at the same endpoint the environment does; if you had repointed it by hand, that edit is kept.

Bucket permissions: the backend checks the bucket exists (`HeadBucket`) and creates it only if it does not. A key that may read, write and delete objects but not create buckets is therefore fine, as long as you create the bucket yourself. Presigned uploads and downloads run in the browser, so an external bucket also needs a CORS policy allowing your deployment's origin with `GET`, `PUT` and `HEAD` — see [Data residency](/self-hosted/configuration/data-residency).

## Audit log signing

The current PostgreSQL audit verifier checks SHA-256 row hashes and linkage. It does not verify HMAC-signed checkpoints. The CLI still generates and carries the signing-key variables for compatibility; their presence is not evidence that the current backend signs the audit history. A separate pepper pseudonymizes personal data recorded after failed sign-ins.

| Name                              | Default                       | Description                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_AUDIT_SIGNING_KEY` | auto-generated by `tale init` | 64-character hex value generated and retained by the CLI for compatibility. Keep existing values with deployment secrets; the current PostgreSQL verifier does not consume this key. |
| `TALE_AUDIT_SIGNING_KEY_PREVIOUS` | unset | Compatibility variable for a prior signing key. The current PostgreSQL verifier does not use it; setting it does not enable signature verification. |
| `TALE_AUDIT_PEPPER` | auto-generated by `tale init` | At least 16 characters for failed-sign-in pseudonymization: HMAC-SHA256 of email and truncated IP address. Without it, these audit fields retain plaintext values and the backend warns. Rotation breaks correlation with earlier identifiers; retention follows each organization’s applied policy. |

See [Audit log integrity](/self-hosted/operate/security/audit-log-integrity) for the verification model.

## Observability

| Name                        | Default | Description                                                                                                                            |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | unset   | Sentry DSN for error tracking. Leave unset to disable. Compatible with self-hosted GlitchTip and Bugsink.                              |
| `SENTRY_TRACES_SAMPLE_RATE` | unset   | Optional sample rate for browser performance traces (`0.0`–`1.0`). Browser-only — the backend reports errors, never traces.            |
| `METRICS_BEARER_TOKEN` | unset | Bearer token for the proxy’s `/metrics/*` routes. Without a configured token they return 401. Internal process endpoints remain a separate network-access concern. |
| `UMAMI_URL` | unset | HTTPS origin of the authenticated collector gateway. HTTP is accepted only for local testing on `localhost`, `127.0.0.1` or `[::1]`. Requires a valid website ID and proxy token; no path, query or credentials in this URL. |
| `UMAMI_WEBSITE_ID` | unset | Umami website UUID. Unset or invalid disables aggregate analytics; use a separate ID for each deployment. |
| `UMAMI_PROXY_TOKEN` | unset | Server-only bearer token for the collector gateway: 16–256 ASCII letters, digits or characters from `._~-`. Never inject it into browser configuration. |

Setting `METRICS_BEARER_TOKEN` exposes the metrics endpoints behind the token: `/metrics/platform`, `/metrics/backend` (the application backend's metrics), and `/metrics/sla-rules`. See [Observability config](/self-hosted/configuration/observability-config) for the scrape config.

## Provider secrets encryption

SOPS protects supported configuration secret sidecars. Current provider credentials in the database use `ENCRYPTION_SECRET_HEX`, listed with the security secrets above.

| Name | Default | Description |
| --- | --- | --- |
| `SOPS_AGE_KEY` | unset | One inline private age key. Takes precedence over the key-file setting. |
| `SOPS_AGE_KEY_FILE` | unset | Path visible to the consuming process, containing one or more private age keys, one per line. Mount the file into each container that needs it. |

Without an age key, the SOPS helper writes supported sidecars as plaintext at mode `0600`; existing encrypted files still require their key. Read [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops) before changing either variable.

Provider credentials may instead reference a variable under `TALE_PROVIDER_KEY_` (maximum name length 40). Subscription-broker credentials use the separate `TALE_TOKEN_SOURCE_` prefix (maximum 60). These fields store variable names, not secret values. Inject values into the backend processes and recreate the consumers when values change. [Providers](/self-hosted/configuration/providers) describes this setup.

## Connector OAuth apps

OAuth connectors (Gmail, Google Drive, Outlook, Teams, Slack, …) resolve their vendor app per organization first: an app configured under **Settings > Connectors > OAuth apps** wins for that org. The environment supplies the deployment-wide default underneath (and is the only source for Slack, whose inbound event verification runs before any org is known). For each connector slug:

| Name                                   | Default | Description                                                                                             |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID`     | unset   | OAuth client ID for that connector. Slug is upper-cased with dashes as underscores (`gmail` → `GMAIL`). |
| `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET` | unset   | Matching client secret.                                                                                 |
| `CONNECTOR_SLACK_SIGNING_SECRET`       | unset   | The Slack app's signing secret. The inbound Events endpoint verifies every delivery with it and answers 503 while it is unset. |

Register `${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback` on the vendor app, and for Slack also `${SITE_URL}${BASE_PATH}/api/connectors/slack/events` as the Events Request URL. Details: [Connectors (develop)](/develop/connectors).

## Knowledge cloud import (Documents)

Per-user OneDrive / Google Drive authorizations for **Knowledge → Documents** are separate from org connectors and from login. An org-level app configured under **Settings > Connectors > OAuth apps** takes precedence here too — the **google-drive** entry is shared with the connector lane, and **OneDrive / SharePoint (Knowledge import)** has its own entry. The chains below resolve wherever the org has not configured one. Register this redirect URI on the Microsoft (or Google) app:

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

These variables configure backend authentication, file events, and operator permissions. Recreate the consuming backend roles when their environment changes; changing only the web container is insufficient.

| Name                              | Default                  | Description                                                                                                                                                                                                           |
| --------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUSTED_SECRET_HEADER` | `Remote-Internal-Secret` | Name of the request header that carries the organization's trusted-header key on the hand-off request. |
| `TRUSTED_EMAIL_HEADER`            | `Remote-Email`           | Name of the request header carrying the user's email — the identity the session is minted for.                                                                                                                        |
| `TRUSTED_NAME_HEADER`             | `Remote-Name`            | Name of the request header carrying the display name. Falls back to the local part of the email.                                                                                                                      |
| `TRUSTED_ROLE_HEADER` | `Remote-Role` | Name of the request header carrying the organization role the session acts with, capped at the organization's ceiling (`member` when the header is absent). |
| `TRUSTED_TEAMS_HEADER`            | `Remote-Teams`           | Name of the request header carrying team memberships as comma-separated team names (`id:name` entries are accepted too). Absent = teams untouched; present = the proxy's list is authoritative for the memberships it granted (empty revokes them). |
| `TALE_FILE_EVENTS`                | `false`                  | Streams config-file changes under `TALE_CONFIG_DIR` to open browser tabs (`/events/file`), so an agent, skill, or branding file edited on disk shows up without a reload. On in the dev compose, off in production.   |
| `TALE_DEPLOYMENT_CONFIG_ADMINS`   | unset                    | Comma-separated email allowlist of operators allowed to write the deployment config file (`deployment.yml`, today the sandbox runtime section) through the API. Empty/unset = read-only for all admins. Data residency is configured per organization and is not gated by this list. |
| `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS` | unset | Set to `1` in the backend environment to admit private model-provider destinations, including their sandbox gateway configuration. Cloud-metadata targets remain blocked. See [Providers](/self-hosted/configuration/providers). |
| `TALE_ALLOW_PRIVATE_CRAWL_HOSTS` | unset | Set to `1` to admit intranet crawl targets and private product `imageUrl` hosts. Cloud-metadata targets remain blocked. |
| `TALE_ALLOW_OPEN_SIGN_UP` | unset | Set to exactly `true` to keep `POST /api/auth/sign-up/email` open after the deployment's first account. For throwaway test stacks only — the local dev orchestrator and the dev compose overlay set it themselves. A real deployment leaves it unset, so an administrator creates every account after the first. |
| `TALE_ORGANIZATION_CREATORS` | unset | Comma-separated email allowlist of the accounts that may create an organization, matched case-insensitively. Unset, every signed-in user may create one. Set, every other user is refused with `403 ORGANIZATION_CREATION_FORBIDDEN` once the deployment holds an organization — the first one is always allowed — and the app hides **Create organization** from them. A set but empty value closes creation to everyone. A managed deployment writes it from `organizations.creators` in its specification; see [Install the tale CLI](/self-hosted/install/cli-install#managed-organization-creators). |

The private-crawl opt-in affects two boundaries: website registration and crawler requests, and validation of a product’s `imageUrl`. Without it, a private website target returns `400 WEBSITE_DOMAIN_NOT_CRAWLABLE`; a private product image URL returns `400 INVALID_BODY`. Product validation checks the hostname string without fetching the image or resolving DNS. Website registration and crawling also check resolved addresses. Enable the flag only for a deployment that needs these private destinations; it is separate from the private-provider flag.

## RAG retrieval tuning

These optional `RAG_` variables tune knowledge search and cross-encoder re-ranking. Backend processes read them at startup. After changing their deployment environment, recreate the affected backend containers through your deployment workflow; `docker compose restart` keeps their previous environment.

| Name                         | Default                                | Description                                                                                                                                                                    |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RAG_RERANKING_ENABLED` | `false` | Enable cross-encoder re-scoring of merged BM25 and vector candidates. Also configure the API provider below. Measure relevance and added latency with your corpus. |
| `RAG_RERANKING_MODEL`        | `cross-encoder/ms-marco-MiniLM-L-6-v2` | Cross-encoder model identifier passed to the rerank provider.                                                                                                                  |
| `RAG_RERANKING_PROVIDER`     | `local`                                | Must be set to `api` to enable re-ranking — it posts the candidates to an external `/rerank` endpoint (Cohere/Jina-compatible). `local` is no longer supported and fails fast. |
| `RAG_RERANKING_TOP_K`        | `10`                                   | Maximum number of results the reranker returns. The response never exceeds the request's own `top_k`.                                                                          |
| `RAG_RERANKING_CANDIDATES`   | `30`                                   | Size of the candidate pool fed to the reranker. A wider pool improves re-scoring quality and costs proportionally more time per query.                                         |
| `RAG_RERANKING_API_BASE_URL` | unset                                  | Base URL for the rerank provider; the backend calls `{base_url}/rerank`. Required when re-ranking is enabled.                                                                  |
| `RAG_RERANKING_API_KEY`      | unset                                  | Bearer token sent to the external rerank endpoint. Leave unset for unauthenticated endpoints.                                                                                  |

Re-ranking is disabled by default. To use it, set `RAG_RERANKING_ENABLED=true`, `RAG_RERANKING_PROVIDER=api`, and a valid `RAG_RERANKING_API_BASE_URL`, plus credentials when required. The backend does not run a local re-ranking model. Compare results and latency before enabling it for users.

## Deployment topology

These values shape the application roles of a workspace deployment: the replica counts, which `tale deploy` reads from the project environment and clamps to the supported range with a warning, and how much work one worker replica takes on at once.

| Name                           | Default | Description                                                                                              |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `TALE_PLATFORM_REPLICAS`       | `1`     | Replicas of the web tier that serves the app shell. Range `1`–`16`.                                       |
| `TALE_BACKEND_API_REPLICAS`    | `1`     | Replicas of the API — every application door, auth, and the hint stream. Range `1`–`16`.                  |
| `TALE_BACKEND_WORKER_REPLICAS` | `1`     | Replicas of the job runner: ingestion, crawls, automations, agent turns. Range `1`–`16`.                  |
| `WORKER_CONCURRENCY`           | `5`     | Jobs one `backend-worker` replica runs at once — ingestion, crawls, automations and agent turns share it. Read by the worker process itself; range `1`–`64`. The lever to pull before adding worker replicas when a backlog lags. Every running indexing job commits through the knowledge pool, so raise `KNOWLEDGE_DB_POOL_MAX` with it. |
| `TALE_BACKEND_URL` | `http://backend-api:3005` | Where the web tier reaches the application backend: the public `/status` page probes it and the web server asks it for the answers only a database can give. The shipped compose and the container entrypoint default it to the in-compose alias; set it only when your backend service has another name. Read by the `platform` service only. |

A workspace rollout temporarily runs both colors. Plan capacity for that overlap. Increase the role whose measured workload is the bottleneck; more replicas also increase database connections and memory use. See [Upgrades](/self-hosted/operate/upgrades).

## Sessions

| Name                           | Default | Description                                                                                                                                                                                              |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | unset   | **Optional.** Sign a session out after this many minutes of inactivity (`1`–`1440`). The window slides on activity and is enforced server-side across email/password, SSO, and trusted-headers sessions. |

Leave it unset to keep the default session lifetime. When set, an idle session expires server-side once the window elapses, while an active one keeps sliding forward on each request. Org admins can tighten the effective window per organisation — never loosen it past this cap — via the [session idle timeout governance policy](/platform/admin/governance/policies-and-limits); idle sessions under that policy are revoked by a sweep that runs about every five minutes.

## Sandbox infrastructure

The sandbox spawner reads the settings below. Pass them into its environment and recreate that service after a change. `SANDBOX_MAX_SESSIONS` sets the capacity shared by all organizations; an organization's three workload limits add up automatically and cannot be saved above that capacity. Manage those limits in [Sandboxes](/platform/admin/sandboxes), where actual runtime counts and host measurements appear separately from workload allocations.

| Name | Default | Description |
| --- | --- | --- |
| `SANDBOX_MAX_SESSIONS` | `8` | Maximum running and starting sessions across all organizations on the Docker host or in the Kubernetes namespace, including idle containers kept for reuse. This capacity does not reserve CPU or memory. Concurrent Kubernetes replicas enforce it on a best-effort basis; use ResourceQuota for hard namespace resource bounds. |
| `SANDBOX_AGENT_CPUS` | `2` | CPU limit per agent session. Account for overlapping builds and other host workloads when choosing the session count. |
| `SANDBOX_AGENT_MEMORY` | `4g`; `8g` with Docker inside the sandbox | Memory limit per agent session, shared with its inner Docker daemon and nested containers. An explicit value overrides either default and applies to newly created sessions. |
| `SANDBOX_SESSION_MAX_IDLE_MS` | `1800000` (30 min) | Idle window for stopping unpinned sessions. Organization build-cache helpers also stop after this window with no potentially active organization session; their networks and cache volumes are retained. |
| `SANDBOX_RUNTIME_IMAGE`          | `tale-sandbox-runtime:latest` | **Optional, read by the spawner.** The image every session container is created from. The default is the tag the development stack builds locally, so a host that pulls its images sets the registry one: `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`, matching the rest of the stack. `tale deploy` sets it for you. |
| `SANDBOX_DIND_INNER_POOL` | unset (automatic) | Optional inner Docker address pool for agent sessions on Docker or Kubernetes. Use a canonical RFC1918 IPv4 `/16` outside your Pod, Service and VPC networks. The runtime rejects overlaps with networks and addresses it discovers. |

At full capacity, the spawner can stop a released, unpinned idle session before the idle timeout to admit new work. The daemon must confirm that no work is in progress; busy sessions and sessions with unknown state are protected. Stopping compute preserves the persistent workspace directory or volume. If no safe session can be reclaimed, admission remains blocked by the deployment capacity.

### Size session capacity

Start with 8, then test the tasks your deployment will run together. Browser rendering and Docker builds have different peaks; include agents, workflows and crawling across all organizations. A free session slot does not guarantee enough resources, and the spawner does not automatically adjust this setting to host memory.

On Docker, sample resource use while representative tasks overlap. Repeat this command during the run; an idle snapshot does not show task peaks:

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
```

Subtract the operating system, platform services, databases, build-cache helpers and a safety margin from host memory. Divide the remaining memory by the measured peak per active session and round down. For example, a 32 GiB host with 8 GiB set aside and a measured peak of 3 GiB per session gives `(32 - 8) / 3 = 8` sessions. This is a sizing example, not a benchmark. For mixed workloads, budget their simultaneous peaks together and check CPU saturation and task duration before raising the limit.

An agent's 4 GiB or 8 GiB memory limit is a ceiling, not memory reserved at startup. Eight agents running Docker builds can therefore require much more memory than eight mostly idle sessions. Measure under representative load and keep headroom; increase capacity to 16 or higher only when the host can sustain it. Before lowering capacity, reduce any organization totals that exceed the new value. The default organization limits total 6, so a smaller deployment capacity also needs smaller organization limits.

### Apply a capacity change

Add or update this line in the deployment's `.env`, keeping its other entries. Explicit values remain in effect across upgrades; the default of 8 applies when the variable is unset.

```dotenv .env
SANDBOX_MAX_SESSIONS=8
```

For a Compose stack you manage yourself, recreate only the sandbox service using its existing local image:

```bash
docker compose up -d --no-deps --no-build --pull never sandbox
```

Use the same project, `-f` files and environment-file options as the running stack. A restart alone does not load an edited `.env`. For CLI-managed installations, apply the change through the deployment workflow in [Upgrades](/self-hosted/operate/upgrades). On Kubernetes, set the variable on the sandbox spawner Deployment and roll out that Deployment.

Confirm the new deployment capacity in [Sandboxes](/platform/admin/sandboxes). With organization limits at 2/2/2 and deployment capacity at 8, the total reads **6 / 8**. Existing organization settings are preserved; saving still requires their total to fit the current capacity. Changing the capacity does not increase any container's CPU or memory limit.

### After an upgrade

The default capacity used to be 16, and organizations created before this release were seeded with limits of 2/4/4, a total of 10. A deployment that never set `SANDBOX_MAX_SESSIONS` therefore starts the new version with a capacity of 8 and organizations whose saved total exceeds it. Running work is not affected, and each organization keeps admitting work under its saved limits; only saving the Sandboxes page is blocked until its total fits, and lowering limits still saves. Either set `SANDBOX_MAX_SESSIONS=16` explicitly to keep the previous capacity, or ask each affected organization to lower one limit.

### Docker build caches

Docker build caches are isolated by organization. Each organization uses one privileged builder and three unprivileged registry mirrors. Once no session may still use them, the helpers stop after the session idle window; the next build restarts them with their cache volumes intact. Networks and volumes remain available for reuse. Kubernetes sessions use their own inner Docker builder; Kubernetes reconciliation does not invoke the Docker CLI for these helpers.

The spawner packs organization bridges into the first available Docker address pool before moving to the next. Its default `/23` gives each bridge 512 addresses; an otherwise unused `/16` holds 128 such organization networks. Smaller subnets configured in Docker’s pools remain smaller. It excludes existing Docker networks, routes and DNS server addresses on the Docker daemon’s host, and `172.31.0.0/16` for older runtime images, then validates the created network.

To observe the daemon’s host even with remote Docker, the spawner briefly runs the configured BuildKit image in the host network namespace with a read-only filesystem, all capabilities dropped and no mounts. If that observation fails or no safe subnet remains, sessions build locally without the shared cache. An unused owned network left with an invalid subnet is rebuilt; in-use and foreign networks are preserved.

Upgrades create cold organization caches and retain the old global cache data. Old helper containers stop automatically after no running session depends on them. Drain or stop old pinned sessions to complete that transition; until then the old shared cache service remains reachable. Browser automation uses headless Chromium; live browser viewing and manual browser takeover are retired.

### Inner Docker networks

On Docker and Kubernetes, automatic selection checks IPv4 routes and gateways from all routing tables, interface addresses and prefixes, DNS servers, and the resolved addresses of proxy and gateway hosts configured in the container environment at startup. Hosts supplied later during an agent turn are outside that initial observation. It also accounts for a Docker organization bridge that will attach later. The runtime prefers a free `172.31.0.0/16`, then tries other private `/16` ranges. The first `/24` serves `docker0`; inner Compose networks use `/24` blocks from that same pool. In automatic mode, failed observations or exhausted private space prevent session startup.

A Pod cannot discover the cluster’s complete Pod, Service and VPC CIDRs from its own network namespace. Set `SANDBOX_DIND_INNER_POOL` to a private `/16` you have checked against all those networks when deploying DinD on Kubernetes. An explicit pool still fails on every discovered overlap or invalid value. If some observations are unavailable, the runtime names them in a warning and can continue with the explicit pool; responsibility for the unseen address space remains with the operator.

After changing this pool, restart the spawner and recreate existing sessions to apply it. Restarting a runner container inside the same Kubernetes Pod retains that Pod’s environment and inner Docker store.

The egress proxy allows upstream DNS queries to the validated nameserver IPs in its `/etc/resolv.conf`, including private cluster DNS. Each exception covers only that exact IP and UDP/TCP destination port 53. Other private destinations and forwarding between attached networks stay blocked.

### IPv6 forwarding protection

Keep `sandbox`, `sandbox-egress` and `SANDBOX_RUNTIME_IMAGE` on the same release when upgrading. Before attaching an organization’s Docker build network, the spawner verifies the session’s forwarding protection. Compose and generated Docker session containers disable IPv6 with `net.ipv6.conf.all.disable_ipv6=1` and `net.ipv6.conf.default.disable_ipv6=1`; preserve both in custom Docker definitions.

Kubernetes Pods do not receive unsafe sysctls automatically. The egress proxy needs working IPv6 firewall support or IPv6 disabled in its network namespace. If the IPv6 firewall is unavailable, the entrypoint attempts that local disable and verifies the default and every interface. A read-only `/proc/sys` or denied write can prevent it; enabled IPv6 without protection still stops startup. Configure the egress Pod according to the cluster’s permitted networking settings before deployment.

## Sandbox agent turns

| Name                             | Default              | Description                                                                                                                                                                                                                                                                                       |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_EXTERNAL_TURN_DEADLINE_MS` | `1800000` (30 min)   | **Optional.** How long an in-sandbox coding-agent turn (Claude Code, OpenCode, Codex) may sit with nobody draining its output before the sandbox daemon reaps it. A sliding window, re-armed every time the platform re-attaches to the output — not an absolute cap on the turn. Milliseconds. |
| `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` | `600` (10 min) | **Optional.** How long the sandbox model gateway waits for the next byte from a silent upstream model before it aborts the stream, including while a slow local model is still processing a long prompt. The backend reads it and configures the gateway. Claude Code and Codex turns wait at least as long before they give up on a silent stream and send the request again, so you can raise it for a slow local model without either of them sending a turn twice. A stalled upstream model then also holds a turn longer before the gateway aborts it. A value above 600 also raises the gateway's per-request timeout to match: it bounds a whole non-streaming answer, which an agent falls back to when a stream breaks. Seconds. |

Investigate why output consumption stopped before increasing this deadline. It limits orphaned output streams, not total task duration. Recreate the consuming backend roles after changing the environment.

## Video-link ingestion (yt-dlp)

The worker uses these values for video transcript retrieval. Its image includes yt-dlp and a PO-token plugin. Use [Video ingestion](/self-hosted/configuration/video-ingestion) to distinguish source restrictions, egress problems, and authorized session handling. Recreate the worker after changing deployment environment values; rereading a variable inside a process does not reload `.env`.

| Name                             | Default                               | Description                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VIDEO_INGEST_PROXY_URL` | unset | Proxy for yt-dlp requests. Supported schemes: `http`, `https`, `socks4`, `socks4a`, `socks5`, `socks5h`; the last resolves destination DNS at the proxy. Use an approved egress service. |
| `VIDEO_INGEST_POT_PROVIDER_URL` | `http://bgutil-provider:4416` (baked) | PO-token provider URL. Defaults to the bundled sidecar when the image plugin is present. Tokens can help retrieval but do not grant access to private content or guarantee success. |
| `VIDEO_INGEST_FETCH_POT` | `always` when a provider is wired | When to request provider tokens: `never`, `auto`, or `always`. The bundled provider path defaults to `always`. Use `never` only when deliberately disabling that token path. |
| `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` | `/opt/yt-dlp/plugins` (baked)         | Directory yt-dlp loads plugins from — each plugin nested one level down (`<dir>/<name>/yt_dlp_plugins/…`). Defaults to the baked-in bgutil plugin dir when present; override only to add your own plugins.                                                                                              |
| `VIDEO_INGEST_COOKIES_FILE` | unset | Path inside the worker to a Netscape cookie file. Protect it as account credentials and use only an authorized session. The organization-scoped browser-session pool in the video guide offers managed import and revocation. |
| `VIDEO_INGEST_PLAYER_CLIENT`     | `default,tv_simply`                   | Comma-separated YouTube player-client fallback list. When a PO-token provider is wired the default widens to `default,mweb,tv_simply` (mweb needs a GVS token); set explicitly to force a list.                                                                                                         |
| `VIDEO_INGEST_PO_TOKEN`          | unset                                 | Manually pinned PO token (`CLIENT.CONTEXT+TOKEN`). Mainly for testing — tokens are video-ID-bound and short-lived; prefer the provider.                                                                                                                                                                 |
| `VIDEO_INGEST_IMPERSONATE`       | unset                                 | Browser TLS/JA3 impersonation target (e.g. `safari`). Requires `curl_cffi` in the image; leave unset unless you know it's available.                                                                                                                                                                    |
| `VIDEO_INGEST_BIN_DIR`           | unset                                 | Directory prepended to the yt-dlp/ffmpeg child's `PATH` so a self-provisioned `yt-dlp` (and its Deno runtime) installed outside the image's pinned bin dirs is found first. The backend image bakes yt-dlp into `PATH`, so leave it unset there; set it on a host or dev box running its own toolchain. |
| `VIDEO_INGEST_FFMPEG_LOCATION`   | `/usr/bin/ffmpeg`                     | Absolute path to the ffmpeg yt-dlp uses for post-processing (subtitle conversion, audio extraction). Override when ffmpeg lives elsewhere — e.g. Homebrew's `/opt/homebrew/bin/ffmpeg` on a macOS dev box.                                                                                              |
