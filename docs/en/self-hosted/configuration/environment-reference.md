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
| `TOTP_CLIENT_NAME` | unset | Client that newly generated authenticator entries and backup-code downloads name, read by `platform`, `backend-api` and the `all` role: 1–40 letters, digits, spaces or `&` `'` `.` `+` `-`, trimmed. `Acme` names entries `Acme Tale Platform`; unset, or `Tale`, keeps `Tale Platform`. Invalid names prevent backend startup. |
| `TOTP_ENVIRONMENT` | unset | Environment that newly generated authenticator entries and backup-code downloads name, read by `platform`, `backend-api` and the `all` role: 1–32 letters, digits, underscores or hyphens, trimmed and uppercased. `pr` or unset adds none; `te` turns `Acme Tale Platform` into `Acme Tale Platform TE`, and the backup codes download as `acme-tale-platform-te-backup-codes.txt`. Invalid labels prevent backend startup. |
| `BASE_PATH` | unset               | **Optional.** Path prefix for subpath deployments behind a reverse proxy (e.g. `/app`). Leave unset for root deployments. |
| `DOCS_URL` | `https://docs.<HOST>` | Public origin for the proxy’s separate documentation host. The deployment must also include the docs service. |

`SITE_URL` identifies the canonical public origin. Keep scheme, hostname, and port consistent with the browser address and registered callbacks; `BASE_PATH` supplies a deployment path prefix. A trailing slash is normalized by the proxy. Additional addresses belong in `ADDITIONAL_SITE_URLS` as bare origins. Invalid additional origins stop backend startup.

The prose documentation uses its own origin. On the platform origin, `/docs` opens the interactive API reference and `/openapi.json` serves its schema. `DOCS_URL` changes the proxy’s docs host; it does not install the docs service or rewrite links in existing client bundles. The SEO tooling’s `TALE_DOCS_URL` and the docs service’s build/runtime path prefix `DOCS_BASE_URL` are separate settings.

Changing `TOTP_CLIENT_NAME` or `TOTP_ENVIRONMENT` affects newly generated QR codes and setup URIs, including when an existing secret is displayed again, and backup codes downloaded afterwards. It does not rotate secrets or rename entries already saved on a device; rename those in your authenticator app if needed.

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
| `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` | unset | **Required for sandbox agent runtime turns.** Gateway management credential used by the backend to provision session keys. Give the gateway the same value: a gateway without an admin account creates one only for a caller that presents it, which is how the backend claims the gateway on first use. The gateway image always uses this value as its setup token (`BIFROST_SETUP_TOKEN`) and replaces one set on the container. The gateway then retains a password hash in `llm-gateway-data`. Keep the matching secret or use the gateway’s supported credential recovery/rotation procedure. Do not wipe its state as routine recovery. The username defaults to `admin` (`SANDBOX_LLM_GATEWAY_ADMIN_USERNAME`). |

Replace the values that ship in `.env.example` before exposing the instance — they are intentionally insecure placeholders.

## Database

Tale keeps two databases: the operational store (`tale_app` — agents, runs, the audit log) and the knowledge corpus (`tale_knowledge` — document chunks, embeddings, crawled pages). A production stack folds both into one ParadeDB service (`db`, port 5432, aliased `knowledge-db`). Both share `DB_PASSWORD`, and the corpus can be pointed at external infrastructure on its own.

| Name                                      | Default                                                             | Description                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB_PASSWORD` | `tale_password_change_me` | **Required for bundled Postgres.** Password shared by the application and knowledge databases in the packaged layout. Replace the example value before production. |
| `DATABASE_URL`                            | constructed from `DB_PASSWORD`                                      | **Optional.** Connection URL for the operational database. Set it to point the backend at a Postgres of your own; it needs no extensions and no superuser, only a database and a role that may create schemas. Read on every start.                                                       |
| `DATABASE_POOL_MAX` | `10` | **Optional.** Maximum connections in each operational database pool. Each `backend-api` or `backend-worker` replica normally needs up to twice this value (app pool plus job queue). Sandbox lifecycle operations can temporarily add one connection per occupied app-pool slot, for a peak of three times this value per replica. Count that peak against the database’s `max_connections`. |
| `AUTH_DATABASE_POOL_MAX` | `5` | **Optional.** Connections in the pool each `backend-api` replica resolves sign-in sessions through; every authenticated request reads through it. Raise it on replicas that serve thousands of requests a second, and count it per replica against the database’s `max_connections` beside `DATABASE_POOL_MAX`. |
| `POSTGRES_CA_FILE`                        | unset                                                               | **Optional.** Path to a PEM bundle trusted for **every** Postgres connection: the operational database, the knowledge corpus, and the databases organizations bring themselves. Needed whenever a URL asks for `sslmode=verify-ca` or `verify-full` against a provider whose root is not one Node ships (Amazon RDS is the common one). Concatenate several roots into one file if your databases use different providers. |
| `KNOWLEDGE_DATABASE_URL` | `postgresql://tale:${DB_PASSWORD}@knowledge-db:5432/tale_knowledge` | Connection URL for the default knowledge corpus. Pointing it elsewhere selects another database; it does not migrate existing chunks or vectors. |
| `KNOWLEDGE_DB_POOL_MAX` | `10` | **Optional.** Connections one backend process opens to the knowledge corpus. Every indexing job holds one while it commits a slice of chunks, so a worker allowed more concurrent jobs than this (`WORKER_CONCURRENCY`) queues on the pool — raise the two together. Like `DATABASE_POOL_MAX`, it counts per replica against the corpus database's `max_connections`. |
| `KNOWLEDGE_DB_NAME` | `tale_knowledge` | Name of the knowledge database created by the bundled database initialization. |
| `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` | `1073741824`                                                        | **Optional.** Largest BM25 search index (in bytes) the backend rebuilds synchronously at boot when it finds it corrupted; a larger one is rebuilt by a background job while writes to that corpus are refused. See [Container architecture](/self-hosted/operate/container-architecture). |
| `KNOWLEDGE_INDEX_REPAIR_DISABLED` | unset | `1` or `true` disables automatic boot-time BM25 verification and repair. It does not fix corruption; failed queries or writes need investigation and a controlled repair. |
| `KNOWLEDGE_CRAWL_DOCUMENT_MAX_BYTES` | `104857600` | **Optional.** Largest document (PDF, DOCX, XLSX, PPTX, ODT — in bytes) the website crawler downloads and extracts; a larger one is recorded on its page as too large to fetch. HTML pages have their own 2 MiB budget. Every fetch is held in memory while its text is extracted, and up to five sites scan at once, so size the backend's memory with it. A value below 1 MiB, or not a whole number, falls back to the default. |

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

## Audit log privacy

A pepper pseudonymizes personal data recorded after failed sign-ins. Earlier releases also generated `TALE_AUDIT_SIGNING_KEY` and `TALE_AUDIT_SIGNING_KEY_PREVIOUS`. Nothing reads either, so you can keep or delete an existing value.

| Name                              | Default                       | Description                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_AUDIT_PEPPER` | auto-generated by `tale init` | At least 16 characters for failed-sign-in pseudonymization: HMAC-SHA256 of email and truncated IP address. Without it, these audit fields retain plaintext values and the backend warns. Rotation breaks correlation with earlier identifiers; retention follows each organization’s applied policy. |

See [Audit log integrity](/self-hosted/operate/security/audit-log-integrity) for the verification model.

## Observability

| Name                        | Default | Description                                                                                                                            |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                | unset   | Sentry DSN for error tracking. Leave unset to disable. Compatible with self-hosted GlitchTip and Bugsink.                              |
| `SENTRY_ENVIRONMENT` | unset | Shared reporting label for browser, backend and sandbox events. Managed deployments default to their retained `name`; an explicit environment reference can select a canonical label without renaming the deployment. |
| `SENTRY_TRACES_SAMPLE_RATE` | unset | Optional sample rate for browser performance traces (`0.0`–`1.0`); independent of backend sampling. |
| `BACKEND_SENTRY_TRACES_SAMPLE_RATE` | `0` | Backend HTTP and worker span sample rate (`0.0`–`1.0`). Requires `SENTRY_DSN` and a destination accepting Sentry transactions; `0` disables spans. |
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

## Deployment topology

These values shape the application roles of a workspace deployment: the replica counts, which `tale deploy` reads from the project environment and clamps to the supported range with a warning, and how much work one worker replica takes on at once.

| Name                           | Default | Description                                                                                              |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------- |
| `TALE_PLATFORM_REPLICAS`       | `1`     | Replicas of the web tier that serves the app shell. Range `1`–`16`.                                       |
| `TALE_BACKEND_API_REPLICAS`    | `1`     | Replicas of the API — every application door, auth, and the hint stream. Range `1`–`16`.                  |
| `TALE_BACKEND_WORKER_REPLICAS` | `1`     | Replicas of the job runner: ingestion, crawls, automations, agent turns. Range `1`–`16`.                  |
| `WORKER_CONCURRENCY`           | `5`     | Jobs one `backend-worker` replica runs at once on each job queue — ingestion, crawls, automations and agent turns each get this many. Agent turn starts get at least 8 and the drive windows of live agent turns at least 16 per queue, since each one mostly waits on its sandbox (`AGENT_START_SLOTS`, `AGENT_DRIVE_SLOTS`). Read by the worker process itself; range `1`–`64`. The lever to pull before adding worker replicas when a backlog lags. Every running indexing job commits through the knowledge pool, so raise `KNOWLEDGE_DB_POOL_MAX` with it. |
| `AGENT_START_SLOTS` | `WORKER_CONCURRENCY`, at least `8` | Agent turn starts one `backend-worker` replica runs at once, for task runs and for automation steps each. A start holds its slot through the sandbox create and the turn's first 90-second window. Range `1`–`256`. |
| `AGENT_DRIVE_SLOTS` | `WORKER_CONCURRENCY`, at least `16` | Drive windows of live agent turns one `backend-worker` replica runs at once, per lane. A replica keeps about 2.5 times this many live turns per lane drained; past that, windows wait long enough for recovery to step in, so raise it (or add replicas) for more turns at once. Range `1`–`256`. |
| `AUTOMATION_ORG_CONCURRENCY` | `8` | Automation steps of one organization that run at once across all `backend-worker` replicas, so one organization's burst of runs cannot take every worker's slots while other organizations' runs wait. `0` turns the limit off. Replicas that fetch work at the same moment can each start a step, so a burst may briefly run one or two more. A single replica at the default `WORKER_CONCURRENCY` never reaches it; a deployment that serves one organization with more step slots than this raises it or sets `0`. Range `0`–`256`. |
| `AUTOMATION_RUNNER_PROCESSES` | `2` on `backend-api`; on `backend-worker`, one per CPU core but one, at most `4` | How many processes a backend replica evaluates automation code in: templates the runner reads and transform bodies. A replica starts one and adds another only while the ones it has are all busy; one beyond the first stops after five idle minutes. Each costs about 75 MB while it runs. Lower it on a replica short of memory; raise it on a worker whose automations run many transform bodies. Range `1`–`16`. |
| `SHUTDOWN_DRAIN_MS` | `15000` on `backend-api`, `90000` on `backend-worker` | How long, in milliseconds, a stopping backend replica waits for its jobs before it exits. A stopping worker first hands its automation runs to another one: each run continues at its next step, and a step still working 20 seconds in is interrupted and runs again on the next replica, unless it was sending something to an outside service — that run then waits for a person to decide. Keep the container's `stop_grace_period` at least 15 seconds above this value; the shipped compose files give `backend-api` 30 seconds and `backend-worker` 120, and `tale deploy` raises both to 15 seconds above a longer value. Range `1000`–`600000`. |
| `TALE_BACKEND_URL` | `http://backend-api:3005` | Where the web tier reaches the application backend: the public `/status` page probes it and the web server asks it for the answers only a database can give. The shipped compose and the container entrypoint default it to the in-compose alias; set it only when your backend service has another name. Read by the `platform` service only. |

A workspace rollout temporarily runs both colors. Plan capacity for that overlap. Increase the role whose measured workload is the bottleneck; more replicas also increase database connections and memory use. See [Upgrades](/self-hosted/operate/upgrades).

## Sessions

| Name                           | Default | Description                                                                                                                                                                                              |
| ------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_IDLE_TIMEOUT_MINUTES` | unset   | **Optional.** Sign a session out after this many minutes of inactivity (`1`–`1440`). The window slides on activity and is enforced server-side across email/password, SSO, and trusted-headers sessions. |
| `SESSION_COOKIE_CACHE_SECONDS` | unset | **Optional.** Lets a request reuse its resolved session from a signed cookie for up to this many seconds (`1`–`300`) instead of reading the database. On a busy deployment this saves most authentication reads. The trade-off: changes to the session or the account reach ordinary requests only when the cached copy expires (a sign-out on another device, or the sessions ended when a password changes or an admin revokes a member's passkey or resets their two-factor authentication). Organization membership is still read on every request, and open live-update streams re-check the session within 15 seconds. With `SESSION_IDLE_TIMEOUT_MINUTES` set, the cache is held to a quarter of that window; idle revocation allows for the cache, so an organization's idle timeout can take effect up to this many seconds late. |

Leave it unset to keep the default session lifetime. When set, an idle session expires server-side once the window elapses, while an active one keeps sliding forward on each request. Org admins can tighten the effective window per organisation — never loosen it past this cap — via the [session idle timeout governance policy](/platform/admin/governance/policies-and-limits); idle sessions under that policy are revoked by a sweep that runs about every five minutes.

## Support link

| Name                       | Default                    | Description |
| -------------------------- | -------------------------- | ----------- |
| `TALE_CONTACT_SUPPORT_URL` | `https://tale.dev/contact` | **Optional, read by the `platform` service.** Where the **contact support** link on the app's error screens points. An absolute `http://` or `https://` URL. |

Set it to your own help desk so people who hit an error reach the team that runs your deployment. Where the error screen knows the organization, the link adds `organizationId=<id>` to the query string, after any query the URL already carries, and replaces an `organizationId` the URL already has. Any other value, such as `mailto:` or a URL without a scheme, is ignored with a warning in the `platform` service's log, and the link keeps the default.

## MCP endpoint

| Name | Default | Description |
| --- | --- | --- |
| `TALE_MCP_ALLOWED_ORIGINS` | unset | **Optional, read by `backend-api` and the `all` role.** Browser origins, besides `SITE_URL` and `ADDITIONAL_SITE_URLS`, from which the [MCP endpoint](/develop/mcp-endpoint) accepts a request that carries an `Origin` header. Comma- or space-separated, each `scheme://host[:port]` without a path, such as a desktop editor's own `vscode-file://vscode-app`. A malformed entry prevents backend startup. |
| `TALE_MCP_ORIGIN_ENFORCE` | `false` | **Optional, read by `backend-api` and the `all` role.** `true` refuses a request from any other origin with `403` and `ORIGIN_FORBIDDEN`; `false` only logs it. |

Coding agents in a terminal and server-side clients send no `Origin`, so the check never applies to them. A browser page on another site does send one, and an API key in such a page is how that site would reach the endpoint. While enforcement is off, each request from an origin outside the list is logged as `[mcp] origin-mismatch` with the origin, the organization and the person. Read those lines to see which of your clients send an origin before you set `TALE_MCP_ORIGIN_ENFORCE=true`, and add their origins to `TALE_MCP_ALLOWED_ORIGINS`.

## Sandbox infrastructure

The sandbox spawner reads the settings below. Pass them into its environment and recreate that service after a change. `SANDBOX_MAX_SESSIONS` sets the capacity shared by all organizations; an organization's three workload limits add up automatically and cannot be saved above that capacity. Manage those limits in [Sandboxes](/platform/admin/sandboxes), where actual runtime counts and host measurements appear separately from workload allocations.

| Name | Default | Description |
| --- | --- | --- |
| `SANDBOX_MAX_SESSIONS` | sized from host memory and CPUs on a local Docker host (at least `8`, at most `256`); `8` elsewhere | Maximum running and starting sessions across all organizations on the Docker host or in the Kubernetes namespace, including idle containers kept for reuse. This capacity does not reserve CPU or memory. Unset on a Docker host whose memory the spawner can read, it is sized from that memory: one session per 768 MiB left after `SANDBOX_MIN_FREE_MEMORY`, or per 1.5 GiB where agent sessions run Docker inside the sandbox, and at most two sessions per CPU the Docker daemon reports. If the memory cannot be read at start, the capacity stays `8` until it can. An explicit value fixes it. Concurrent Kubernetes replicas enforce it on a best-effort basis; use ResourceQuota for hard namespace resource bounds. |
| `SANDBOX_MIN_FREE_MEMORY` | a tenth of host memory, at least `1g` | Memory a new session or a released warm session resuming work must leave free on a local Docker host, beside what the sessions still starting or just started are about to use. A create that would leave less first stops a released idle session; if memory is still short, the spawner answers busy and the work waits until running sessions free some. Accepts sizes such as `2g` or `1536m`. Has no effect on Kubernetes or with a remote Docker daemon. |
| `SANDBOX_CPU_PRESSURE_PERCENT` | `60` | CPU pressure on a local Docker host, in percent, from which new sessions and released sessions resuming work start one at a time: the share of the last ten seconds in which some task waited for a CPU, as the kernel's pressure stall information reports it (`some avg10` of `/proc/pressure/cpu`). Above it, one start is admitted every ten seconds in the order work asked, and the rest wait with a busy answer; running work is not slowed. `0` turns the check off. A kernel without pressure stall information (built without it, or booted with `psi=0`) leaves CPU out of admission, which the spawner logs once. Has no effect on Kubernetes or with a remote Docker daemon. |
| `SANDBOX_MIN_FREE_DISK` | a twentieth of each disk, at least `2g`, at most `20g` | Free space required for new and reactivated sessions on the workspace filesystem and the verified Docker data filesystem. Below the floor work waits; stopped unused build caches are reclaimed first. Accepts `10g` or `4096m`; `0` disables the check. Kubernetes relies on its storage class and volume provisioning. |
| `SANDBOX_CRITICAL_FREE_DISK` | a quarter of the `SANDBOX_MIN_FREE_DISK` floor, at least `1g` and never above it | Free space below which the session disk is critical: what running sessions write there is about to fail. Below it, released idle sessions with Docker inside are stopped at once, which removes their inner image stores, and the spawner logs the three largest workspaces at most every ten minutes. Accepts `2g` or `2048m`; a value above the floor counts as the floor; `0` turns it off, as does a floor of `0`. Docker backend only. |
| `SANDBOX_DOCKER_WORKLOADS` | `project,workflow` | Workloads allowed to use inner Docker when it is enabled for the deployment. Set `project` to allow Docker only for project agents, `workflow` only for workflow agents, or `none` to disable both. Applies to newly created sessions; existing sessions keep their capabilities. A session request can opt out with `docker: false`, but cannot enable Docker beyond this allowlist or the deployment setting. |
| `SANDBOX_AGENT_CPUS` | `2` | CPU limit per agent session. Account for overlapping builds and other host workloads when choosing the session count. |
| `SANDBOX_AGENT_CPU_SHARES` | `256` | CPU weight of an agent session and of its organization's build-cache helpers while the host's CPUs are saturated, against Docker's default of `1024` that the platform's own services keep; sessions of the `default` profile (code runs, page renders) use `128`. Busy sessions then yield the CPU to the database and backend instead of stalling them; on a host with spare CPU a session still uses up to `SANDBOX_AGENT_CPUS`. A whole number from `2` to `262144`. Applies to newly created sessions; a running helper takes a new value at once. |
| `SANDBOX_AGENT_MEMORY` | `4g`; `8g` with Docker inside the sandbox | Memory limit per agent session, shared with its inner Docker daemon and nested containers. An explicit value overrides either default and applies to newly created sessions. |
| `SANDBOX_AGENT_PROFILE` | `agent` | Read by the backend API and worker. Profile for new agent and workflow workspaces: `agent` supports inner Docker; `agent-light` keeps coding tools and the persistent workspace without starting Docker or build-cache helpers. Existing workspaces retain their recorded profile. |
| `TALE_SANDBOX_CLAUDE_EFFORT` | unset (inherits the agent runtime default) | Read by the backend API and worker. Claude Code reasoning effort: `low`, `medium`, `high` or `max`. Lower settings omit the automatic Ultrathink instruction and set the per-exec effort, while keeping adaptive thinking enabled. Other agent runtimes and foreign models are unaffected. Compare representative tasks before lowering it; shorter runs are not guaranteed. |
| `SANDBOX_SESSION_CREATE_TIMEOUT_MS` | `180000` | Total session startup budget, including optional build-cache setup, container or Pod startup, daemon readiness and environment delivery. A cancelled request aborts its session startup work; cleanup stops compute while preserving the workspace. Shared cache provisioning has its own bounded lifetime. |
| `SANDBOX_DOCKER_DATA_ROOT` | unset | Optional host path matching Docker's `DockerRootDir`. The CLI adds a read-only bind mount to the sandbox service when configured. Raw Compose requires the mount shown below. |
| `SANDBOX_DOCKER_DATA_PATH` | `/var/lib/tale-sandbox/docker-data` when the root is configured | Location of that read-only mount inside the spawner. Admission checks this filesystem as well as the workspace filesystem. A configured mount that cannot be verified or read blocks admission. |
| `SANDBOX_BUILDKITD_CPUS` | `SANDBOX_AGENT_CPUS` | CPU limit of an organization's build-cache helper, which runs the image builds of all its agent sessions when Docker runs inside the sandbox. A running helper takes a new value at once. The number of concurrent BuildKit solver steps is this CPU limit rounded down, with a minimum of one; this bound takes effect when an idle helper is recreated. |
| `SANDBOX_BUILDKITD_MEMORY` | twice `SANDBOX_AGENT_MEMORY` | Memory limit of an organization's build-cache helper, shared by the builds its agent sessions run at the same time. Accepts sizes such as `16g` or `12288m`. A running helper takes a new value when it is recreated, once no build is running. |
| `SANDBOX_BUILDKITD_IDLE_CACHE` | `5g` | Build cache an organization's build-cache helper keeps when it stops for want of agent sessions. Right before that stop, the spawner prunes the cache down to this size, least recently used first: the cache's own garbage collection runs only while the helper runs. Accepts sizes such as `5g` or `2048m`; `0` keeps nothing. |
| `SANDBOX_BUILDKITD_MAX_CACHE` | a tenth of the session disk, at least `1g`, at most `20g` | The most build cache each organization's build-cache helper keeps; past it, the least recently used records go first. Unset, it follows the size of the disk the session workspaces live on, so many building organizations together cannot claim more than a share of it. The floor that low disk space never prunes below is a tenth of this cap, at most 2 GiB. Accepts sizes such as `8g` or `40960m`, at least `1g`. A running helper adopts a new value when it is recreated, once no build is running. |
| `SANDBOX_BUILDKITD_PROVISION_TIMEOUT_MS` | `5000` | Total time in milliseconds for optional shared build-cache setup during session creation, including queued Docker calls and registry mirrors. Range `100`–`60000`. When the shared setup budget expires, queued helper work is cancelled and cannot launch later; the session falls back to its local builder. |
| `SANDBOX_BUILDKITD_CACHE_RETENTION` | `14d` | How long an organization's stopped build-cache helpers keep their caches. Once the builder has been stopped longer than this and no session of the organization may use it, the spawner removes its helpers, network and cache volumes, as an organization's deletion does; its next build starts cold. Accepts whole days or hours such as `14d` or `336h`; `off` (or `0`) keeps the caches until the organization is deleted. |
| `SANDBOX_BUILDKITD_IDLE_MS` | `600000` (10 min) | How long an organization's build-cache helpers keep running once no agent session of the organization that builds may use them. They then stop, keeping the network and the builder's cache volume, while the registry mirrors are removed with their caches; the next build starts them again, a helper launched with the current image and settings by starting the stopped container, any other by recreating it. Minimum `60000`. |
| `SANDBOX_PACKAGE_CACHE_RETENTION` | `14d` | How long an organization's package caches outlive their last use: the pip, uv, npm and bun download caches its sandboxes share on Docker (sandboxes with Docker inside don't use them). Once no sandbox of the organization has used them for this long, the spawner removes them at its next hourly check; the organization's next sandbox starts with empty caches, and installs take longer until they fill again. Caches from before this setting existed count from the first check after the update. Accepts whole days or hours such as `14d` or `336h`; `off` (or `0`) keeps the caches until the organization is deleted. |
| `SANDBOX_SESSION_MAX_IDLE_MS` | `1800000` (30 min) | Idle window for stopping unpinned sessions. Organization build-cache helpers follow `SANDBOX_BUILDKITD_IDLE_MS` instead. |
| `SANDBOX_SESSION_RELEASED_IDLE_MS` | `300000` (5 min) | Idle window for a released session: one whose task or run has finished and that no other work holds. An unpinned released session idle this long is stopped instead of waiting out `SANDBOX_SESSION_MAX_IDLE_MS`; the next turn resumes it on its preserved workspace. Agent sessions with Docker inside the sandbox keep the full idle window once their inner Docker daemon has run, because each resume starts it with an empty image store; a session whose daemon never started gets this shorter window too. |
| `SANDBOX_EXEC_STALL_MINUTES` | `45` | How long a command in a session may print nothing while its processes use under 1% of one CPU before the sandbox ends it as stalled. An agent that hangs, waiting on a connection that never answers or on input nobody sends, would otherwise hold its session until its run's time limit. Work the command hands to containers it started inside the sandbox counts as CPU use. Whole minutes up to `1440`; `0` turns the check off. Applies to newly created sessions. |
| `SANDBOX_RUNTIME_IMAGE`          | `tale-sandbox-runtime:latest` | **Optional, read by the spawner.** The image every session container is created from. The default is the tag the development stack builds locally, so a host that pulls its images sets the registry one: `ghcr.io/tale-project/tale/tale-sandbox-runtime:<version>`, matching the rest of the stack. `tale deploy` sets it for you. |
| `SANDBOX_DIND_INNER_POOL` | unset (automatic) | Optional inner Docker address pool for agent sessions on Docker or Kubernetes. Use a canonical RFC1918 IPv4 `/16` outside your Pod, Service and VPC networks. The runtime rejects overlaps with networks and addresses it discovers. |
| `SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT` | `20Gi` | **Kubernetes only.** Size of the inner Docker store of an agent session that runs Docker inside its sandbox. A session that outgrows it is evicted, so size it for the largest images your agents pull and build. The other Kubernetes settings are listed in [Deploy on Kubernetes](/self-hosted/install/kubernetes). |
| `SANDBOX_K8S_EPHEMERAL_STORAGE_REQUEST` / `SANDBOX_K8S_EPHEMERAL_STORAGE_LIMIT` | `256Mi` / `2Gi` | **Kubernetes only.** How much of the node's disk a session Pod requests, and how much it may write there outside its temporary workspace and inner Docker store. The Pod's limit adds those stores, so a session past it is evicted on its own instead of filling the node. |
| `SANDBOX_K8S_NODE_SELECTOR` / `SANDBOX_K8S_TOLERATIONS` | unset | **Kubernetes only.** The node labels every session Pod must match, as a JSON object such as `{"tale.dev/sandbox":"true"}`, and the taints it tolerates, as a JSON array of Pod tolerations, so sessions run on nodes of their own instead of beside the database and the platform. A malformed value stops the spawner at start. |
| `SANDBOX_K8S_PRIORITY_CLASS` | unset | **Kubernetes only.** The PriorityClass of every session Pod. A class below the platform's lets the scheduler preempt sessions to place platform Pods. |
| `SANDBOX_EGRESS_MAX_CLIENTS` | `2000` | **Read by the `sandbox-egress` service**, not the spawner: recreate that service after a change. Connections the egress proxy serves at once for all sessions together; with transparent egress, every outbound connection of a session, its builds and its package installs goes through it. Past the limit the proxy refuses new connections, and installs and page loads fail with connection resets. Each connection takes a thread and two open files, so the shipped compose files size the proxy's process and open-file limits for the default; a higher value needs them raised too, and the proxy warns at start when its open-file limit is too low. At start the proxy raises its open-file limit to what the connections need, as far as the container's hard limit allows. On Kubernetes, set it on the egress Deployment; a Pod spec sets no process limit, so the node's `podPidsLimit` must leave room for one thread per connection. |
| `SANDBOX_EGRESS_MAX_CONNECTIONS_PER_SESSION` | `256` | **Read by the `sandbox-egress` service**, not the spawner: recreate that service after a change. Connections one session may hold open to the egress proxy at once, counted by its address, so one session cannot take the whole `SANDBOX_EGRESS_MAX_CLIENTS` pool from the others; each organization's build-cache helpers have addresses of their own. A connection past the cap is refused at once with a reset, while the session's other connections keep working. `0` turns the cap off, and a value that is not a whole number stops the proxy from starting. The proxy installs the cap as a firewall rule at start; on a kernel without the `connlimit` match it starts without the cap and logs a warning. On Kubernetes, set it on the egress Deployment; where the cluster network rewrites session source addresses so that sessions reach the proxy from one shared address, they share one cap, so set `0` there. |

The backend settings above must reach both API and worker services. Recreate them after a change. The spawner checks memory and disk headroom when a released session is acquired again, so a warm workspace can wait for capacity too.

Connected devices apply the same local-host memory and disk admission checks while keeping their configured session ceiling.

An intentionally stopped Docker daemon remains ready for its next command; health checks do not start it. A failed health probe immediately refuses new work but does not by itself stop the session. Probe-based recovery needs at least three completed failures spanning five seconds; a healthy result or a new engine clears that failure history. A confirmed startup failure or unexpected engine exit can trigger recovery immediately. The spawner can then stop an idle, unpinned session after an atomic activity check, keeping the workspace for the next start. On Docker, stopping the whole session removes its inner Docker store; stopping only the idle inner engine preserves it. Busy or pinned sessions stay in place and refuse new starts until Docker recovers or an operator resolves the fault.

During a rolling upgrade, keep old spawners pinned to their existing runtime image until they are replaced. Do not move a runtime tag still used by an old spawner: it does not distinguish transient probe failures from confirmed failures. A new spawner with an older runtime refuses unhealthy new work and keeps the normal idle and lifetime cleanup limits.

A containerized spawner automatically checks Docker’s data filesystem when it can verify its existing `/etc/hostname` mount against the daemon. If discovery is unavailable, workspace admission remains active and `/health` reports Docker disk monitoring as `unavailable`. An explicit read-only data-root mount takes priority; if it cannot be verified or read, admission waits until it is available. To configure one, inspect `docker info --format '{{.DockerRootDir}}'` and use that actual host path. Docker Desktop and remote daemons may need a different setup. For raw Compose, add the following override and pass both variables into the sandbox service:

```yaml
services:
  sandbox:
    environment:
      SANDBOX_DOCKER_DATA_ROOT: ${SANDBOX_DOCKER_DATA_ROOT}
      SANDBOX_DOCKER_DATA_PATH: /var/lib/tale-sandbox/docker-data
    volumes:
      - ${SANDBOX_DOCKER_DATA_ROOT}:/var/lib/tale-sandbox/docker-data:ro
```

A disk floor is admission control, not a per-session storage quota. Docker named volumes have no portable size limit, and a Kubernetes PVC size request depends on its storage backend for enforcement. For hard quotas, use a quota-capable filesystem or storage class. Separately mounted containerd stores, volume directories and external volume drivers need their own monitoring, alongside workspaces, image layers and build caches.

Kubernetes sessions use `/readyz` for startup and `/livez` for daemon liveness. Startup accepts an intentionally stopped inner Docker engine as ready; an engine that is running must respond to its health probe. Liveness checks only the sandbox daemon, so dependency failures do not restart busy sessions. A wedged daemon can restart even when its session is pinned. Docker and egress diagnostics appear in `/healthz`.

An already active generation is not charged again. A workflow without inner Docker keeps its agent identity and tools, but starts no Docker daemon and does not keep build-cache helpers alive. Without an explicit `SANDBOX_AGENT_MEMORY`, each session defaults to `4g` without inner Docker or `8g` with it, even when other sessions in the deployment use Docker. An explicit value applies to both modes. These limits are ceilings, not reserved RAM.

At full capacity, the spawner can stop a released, unpinned idle session before the idle timeout to admit new work, starting with the one idle longest. The daemon must confirm that no work is in progress; busy sessions and sessions with unknown state are protected. Stopping compute preserves the persistent workspace directory or volume. If no safe session can be reclaimed, admission remains blocked by the deployment capacity. The same applies when the host's free memory would drop below `SANDBOX_MIN_FREE_MEMORY`. While the disk that holds the session workspaces is below `SANDBOX_MIN_FREE_DISK`, new work waits without stopping idle sessions: a stopped session keeps its workspace. Only below `SANDBOX_CRITICAL_FREE_DISK` does the spawner stop released idle sessions with Docker inside at once, since their stop removes their inner image stores.

Agent runtime protocol records, including unfinished lines, are limited to 8 MiB. Oversized or incomplete output fails explicitly; a bounded progress preview is never treated as a complete structured result. Complete final answers are retained separately from that preview.

Reacquiring a released warm session checks the same memory reserve and reserves its expected working set before resuming work. Concurrent resumes share that accounting. A busy response is retryable; it does not destroy the workspace or interrupt a session that already holds work. These reservations do not cap the later growth of active tools or organization builders.

When Docker is enabled inside agent sandboxes, the engine starts automatically on the first Docker command. Agents do not choose a mode. After five minutes without connected clients, it stops only if no container is running, restarting or paused and every container has its restart policy disabled; an unknown state keeps it running. The next command restarts it with the same images, volumes and workspace. Existing container metadata at session-container boot starts the engine immediately so restart policies still work. This does not change the deployment's runtime isolation, privileges or memory limits.

### Size session capacity

On a Docker host with `SANDBOX_MAX_SESSIONS` unset, the spawner sizes the capacity from the host's memory and CPUs (one session per 768 MiB beyond the reserve, at most two per CPU: a 16 GiB host with 8 CPUs gets 16 sessions, a 64 GiB host with 16 CPUs 32; a 16 GiB host gets 9 where agent sessions run their own Docker daemon) and admits a new session only while the host keeps `SANDBOX_MIN_FREE_MEMORY` free, counting what the sessions still starting or just started are about to use. A burst of new sessions that would overcommit the host therefore waits instead of starting; the check does not stop sessions already running from growing. While the host's CPU is under pressure (`SANDBOX_CPU_PRESSURE_PERCENT`), new sessions likewise start one at a time instead of adding to the load. Every project agent run that works at the same time as another takes a session of its own, an agent worker: one agent working three tasks at once runs three sessions, each with its own `SANDBOX_AGENT_MEMORY` limit. These two settings therefore bound how much agent work runs in parallel. Set the capacity yourself on Kubernetes, with a remote Docker daemon, or when the host also runs other heavy workloads: test the tasks your deployment will run together. Browser rendering and Docker builds have different peaks; include agents, workflows and crawling across all organizations. A free session slot does not guarantee enough resources.

On Docker, sample resource use while representative tasks overlap. Repeat this command during the run; an idle snapshot does not show task peaks:

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
```

Subtract the operating system, platform services, databases, build-cache helpers and a safety margin from host memory. Divide the remaining memory by the measured peak per active session and round down. For example, a 32 GiB host with 8 GiB set aside and a measured peak of 3 GiB per session gives `(32 - 8) / 3 = 8` sessions. This is a sizing example, not a benchmark. For mixed workloads, budget their simultaneous peaks together and check CPU saturation and task duration before raising the limit.

An agent's 4 GiB or 8 GiB memory limit is a ceiling, not memory reserved at startup. Eight agents running Docker builds can therefore require much more memory than eight mostly idle sessions. Measure under representative load and keep headroom; increase capacity to 16 or higher only when the host can sustain it. Before lowering capacity, reduce any organization totals that exceed the new value. The default organization limits total 6, so a smaller deployment capacity also needs smaller organization limits.

### Apply a capacity change

Add or update this line in the deployment's `.env`, keeping its other entries. Explicit values remain in effect across upgrades; without one, a Docker host sizes the capacity from its memory as described above, and Kubernetes uses 8.

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

From this release, a Docker deployment that never set `SANDBOX_MAX_SESSIONS` gets a capacity sized from its host's memory instead of 8, never less than 8. It can admit more sessions at once than before, and only while the host has memory to spare. Set an explicit value to keep a fixed capacity.

That sized capacity is now also at most two sessions per CPU, so a host with much memory and few CPUs gets fewer sessions than before (a 16 GiB host with 4 CPUs: 8 instead of 19). While the host's CPU is under pressure, new sessions also start one at a time (`SANDBOX_CPU_PRESSURE_PERCENT`, `0` turns this off). An explicit `SANDBOX_MAX_SESSIONS` is not changed.

### Docker build caches

Shared build-cache preparation uses `SANDBOX_BUILDKITD_PROVISION_TIMEOUT_MS` (5 seconds by default). Each session waits at most that long or one quarter of its total startup budget, whichever is shorter, then uses its local builder. Shared preparation has its own bounded lifetime; cancelling one session’s wait does not cancel setup for other sessions, and a late result does not attach to a session that already fell back. Registry mirrors are prepared concurrently. The shared builder’s parallel steps follow its configured CPU limit, rounded down with a minimum of one; its memory limit still applies. Preparation time counts against the remaining session startup budget.

Docker build caches are isolated by organization. Each organization uses one privileged builder and three unprivileged registry mirrors. Once no session may still use them, the helpers stop after `SANDBOX_BUILDKITD_IDLE_MS` (10 minutes) and the registry mirrors are removed with their caches, since the builder's own cache keeps the base layers its builds used; the next build starts the builder again with its cache volume intact and recreates the mirrors. Right before the builder stops, the spawner prunes its cache to `SANDBOX_BUILDKITD_IDLE_CACHE`, because its garbage collection runs only while it runs. A stopped organization's cache is not pruned further; after `SANDBOX_BUILDKITD_CACHE_RETENTION` (14 days) with no build, its helpers and caches are removed, and otherwise they go with the organization. While the session disk is below `SANDBOX_MIN_FREE_DISK`, stopped organizations' caches go sooner, the longest-stopped first. The network and the builder's cache volume remain available for reuse. Kubernetes sessions use their own inner Docker builder; Kubernetes reconciliation does not invoke the Docker CLI for these helpers.

The spawner packs organization bridges into the first available Docker address pool before moving to the next. Its default `/23` gives each bridge 512 addresses; an otherwise unused `/16` holds 128 such organization networks. Smaller subnets configured in Docker’s pools remain smaller. It excludes existing Docker networks, routes and DNS server addresses on the Docker daemon’s host, and `172.31.0.0/16` for older runtime images, then validates the created network.

To observe the daemon’s host even with remote Docker, the spawner briefly runs the configured BuildKit image in the host network namespace with a read-only filesystem, all capabilities dropped and no mounts. If that observation fails or no safe subnet remains, sessions build locally without the shared cache. An unused owned network left with an invalid subnet is rebuilt; in-use and foreign networks are preserved.

Upgrades create cold organization caches and retain the old global cache data for now. Old helper containers stop automatically after no running session depends on them. Once they have been stopped longer than `SANDBOX_BUILDKITD_CACHE_RETENTION` (14 days) and still no session depends on them, the spawner removes those helper containers and the four old cache volumes (`tale-buildkitd-cache` and `tale-buildkitd-mirror-cache-docker-io`, `-ghcr-io`, `-quay-io`), each only while it carries the old build-cache label without an organization, and logs every removal; `off` keeps them. Drain or stop old pinned sessions to complete that transition; until then the old shared cache service remains reachable. Browser automation uses headless Chromium; live browser viewing and manual browser takeover are retired.

### Inner Docker images

With the shared build cache on, a session's inner Docker engine pulls Docker Hub images through its organization's docker.io registry mirror, the same cache its builds use, and falls back to Docker Hub when that mirror is not running. Images from other registries are pulled directly. An inner engine that goes idle with more than 10 GiB of images and build cache first removes its dangling images and prunes its build cache to the 5 GiB used most recently; tagged images, containers and volumes stay. On Kubernetes, the size limit of the inner store's volume bounds it instead when that limit is below 10 GiB.

### Inner Docker networks

On Docker and Kubernetes, automatic selection checks IPv4 routes and gateways from all routing tables, interface addresses and prefixes, DNS servers, and the resolved addresses of proxy and gateway hosts configured in the container environment at startup. Hosts supplied later during an agent turn are outside that initial observation. It also accounts for a Docker organization bridge that will attach later. The runtime prefers a free `172.31.0.0/16`, then tries other private `/16` ranges. The first `/24` serves `docker0`; inner Compose networks use `/24` blocks from that same pool. In automatic mode, failed observations or exhausted private space prevent session startup.

A Pod cannot discover the cluster’s complete Pod, Service and VPC CIDRs from its own network namespace. Set `SANDBOX_DIND_INNER_POOL` to a private `/16` you have checked against all those networks when deploying DinD on Kubernetes. An explicit pool still fails on every discovered overlap or invalid value. If some observations are unavailable, the runtime names them in a warning and can continue with the explicit pool; responsibility for the unseen address space remains with the operator.

After changing this pool, restart the spawner and recreate existing sessions to apply it. Restarting a runner container inside the same Kubernetes Pod retains that Pod’s environment and inner Docker store.

The egress proxy allows upstream DNS queries to the validated nameserver IPs in its `/etc/resolv.conf`, including private cluster DNS. Each exception covers only that exact IP and UDP/TCP destination port 53. Other private destinations and forwarding between attached networks stay blocked.

### IPv6 forwarding protection

Keep `sandbox`, `sandbox-egress` and `SANDBOX_RUNTIME_IMAGE` on the same release when upgrading. Before attaching an organization’s Docker build network, the spawner verifies the session’s forwarding protection. Compose and generated Docker session containers disable IPv6 with `net.ipv6.conf.all.disable_ipv6=1` and `net.ipv6.conf.default.disable_ipv6=1`; preserve both in custom Docker definitions.

Kubernetes Pods do not receive unsafe sysctls automatically. The egress proxy needs working IPv6 firewall support or IPv6 disabled in its network namespace. If the IPv6 firewall is unavailable, the entrypoint attempts that local disable and verifies the default and every interface. A read-only `/proc/sys` or denied write can prevent it; enabled IPv6 without protection still stops startup. Configure the egress Pod according to the cluster’s permitted networking settings before deployment.

## SSH repository access

The native sandbox includes OpenSSH and `netcat-openbsd`. Grant a replaceable key restricted to the repository as a named agent secret, then load it into `ssh-agent` from stdin in the credentialed turn. Keep its private bytes in the environment; never write a key file or print them. A Member-started turn receives no agent secrets. Git commits use the workspace owner's author name and email even without a GitHub connector grant.

Internal sessions use their existing `HTTP_PROXY` for egress. Direct SSH cannot rely on external DNS from that network. Use the proxy's HTTP CONNECT tunnel and a port it authorizes. GitHub supports SSH at `ssh.github.com:443`; verify the host against [GitHub's published fingerprints](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints), as described in [SSH over port 443](https://docs.github.com/en/authentication/troubleshooting-ssh/using-ssh-over-the-https-port). Keep a public known-hosts file with the independently verified pin and configure the command after the agent has loaded the key:

```python
import os
import shlex
import subprocess
from urllib.parse import urlsplit

proxy = urlsplit(os.environ["HTTP_PROXY"])
if proxy.scheme != "http" or not proxy.hostname or not proxy.port or proxy.username or proxy.password:
    raise ValueError("Expected the existing unauthenticated HTTP egress proxy")
connect = shlex.join(["nc", "-X", "connect", "-x", f"{proxy.hostname}:{proxy.port}", "%h", "%p"])
environment = os.environ.copy()
environment["GIT_SSH_COMMAND"] = shlex.join([
    "ssh", "-o", f"ProxyCommand={connect}", "-o", "StrictHostKeyChecking=yes",
    "-o", "UserKnownHostsFile=/tmp/repository-known-hosts",
    "-o", "GlobalKnownHostsFile=/dev/null", "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=20",
])
subprocess.run(["git", "ls-remote", "--exit-code", "ssh://git@ssh.github.com:443/org/repository.git", "HEAD"], env=environment, check=True, timeout=30)
```

The known-hosts file contains only the provider's public host key; the repository's private key stays in `ssh-agent`. This uses the existing egress policy and the repository key's own access scope. It needs no broader GitHub connector grant.

## Sandbox devices

Organizations can run their sandboxes on their own machines, which they connect under [Settings > Sandboxes](/platform/admin/sandbox-devices). A device connects out over HTTPS to `<SITE_URL><BASE_PATH>/sandbox/tunnel` and keeps one WebSocket open. The bundled proxy forwards that path, and only that path, to the spawner's device hub; the spawner's signed API stays on the internal network. Devices need the Docker backend: the hub is off with Kubernetes.

| Name | Default | Description |
| --- | --- | --- |
| `SANDBOX_HUB_PORT` | `8004` | **Read by the spawner.** Port of the device hub, which answers only a ticket-authenticated WebSocket upgrade and a health check. `0` turns devices off: **Add device** is then unavailable. If you change the port, point `SANDBOX_HUB_UPSTREAM` at it too. |
| `SANDBOX_DEVICE_TUNNEL_URL` | `<SITE_URL><BASE_PATH>/sandbox/tunnel` as `wss://` | **Optional, read by the backend.** Where devices connect, when a proxy in front of Tale publishes the hub under another host or path. An `https://` address is used as `wss://`. |
| `SANDBOX_DEVICE_IMAGE_REGISTRY` | `GHCR_REGISTRY`, else `ghcr.io/tale-project/tale` | **Optional, read by the backend.** Where devices pull the sandbox images of the server's release. |
| `SANDBOX_HUB_UPSTREAM` | `sandbox:8004` | **Optional, read by the proxy.** Where the proxy forwards `/sandbox/tunnel`, when the spawner is not the `sandbox` service. |

A device always runs the server's release. It learns the release each time it renews its connection and replaces its own containers when the server moves on, unless it was connected with `--no-auto-update`. It keeps no data on the server: its workspaces stay on the machine. Sandboxes on a device call the backend's sandbox endpoints and the model gateway through the device's connection, along the same paths sessions use on the server; the gateway's management API is never reachable that way. A device keeps the backend and gateway addresses it received when it joined: after changing `SANDBOX_HTTP_API_BASE_URL` or `EXTERNAL_AGENT_GATEWAY_URL`, run `tale sandbox update` on each device.

A device must trust the site's TLS certificate. A deployment with `TLS_MODE=selfsigned` cannot take devices.

With a proxy of your own instead of the bundled one, forward `/sandbox/tunnel` to port `SANDBOX_HUB_PORT` of the spawner, keep WebSocket upgrades and the `Authorization` header intact, and allow connections that stay open for hours.

## Sandbox agent turns

| Name                             | Default              | Description                                                                                                                                                                                                                                                                                       |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TALE_EXTERNAL_TURN_DEADLINE_MS` | `1800000` (30 min)   | **Optional.** How long an in-sandbox coding-agent turn (Claude Code, OpenCode, Codex) may sit with nobody draining its output before the sandbox daemon reaps it. A sliding window, re-armed every time the platform re-attaches to the output — not an absolute cap on the turn. A running agent turn also waits out an unreachable sandbox service before it fails: for a third of this value, at most 10 minutes (exactly 10 minutes at the default), so lowering it shortens that wait. Milliseconds. |
| `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` | `600` (10 min) | **Optional.** How long the sandbox model gateway waits for the next byte from a silent upstream model before it aborts the stream, including while a slow local model is still processing a long prompt. The backend reads it and configures the gateway. Claude Code and Codex turns wait at least as long before they give up on a silent stream and send the request again, so you can raise it for a slow local model without either of them sending a turn twice. A stalled upstream model then also holds a turn longer before the gateway aborts it. A value above 600 also raises the gateway's per-request timeout to match: it bounds a whole non-streaming answer, which an agent falls back to when a stream breaks, and how long an upstream may take to begin a streamed answer. Seconds. |
| `SANDBOX_LLM_GATEWAY_PROVIDER_CONCURRENCY` | `512` | **Optional.** How many requests the sandbox model gateway sends at once to one built-in provider (OpenAI, Anthropic, OpenRouter and the other providers the gateway implements itself), which every organization shares. The backend reads it and configures the gateway. The gateway keeps that many request workers for each provider whether or not anything calls it, so a higher value costs gateway memory. A request that finds every worker busy waits in a queue 16 times as long. A whole number from 1 to 5,000. |
| `SANDBOX_LLM_GATEWAY_CUSTOM_PROVIDER_CONCURRENCY` | `64` | **Optional.** The same for a custom provider. The backend sets one up in the gateway for each organization and model, so the number of custom providers grows with organizations and models, and each keeps its workers like a built-in one. A built-in provider's Anthropic lane for agent runtimes (Claude Code through OpenRouter's Anthropic endpoint) gets an organization-and-model provider of its own and is sized by this value. One organization's sandbox sessions rarely have more than a few model calls in flight on one model; raise it when an organization's API keys send more requests than that to one custom model at once. A whole number from 1 to 5,000. |
| `SANDBOX_LLM_GATEWAY_LOG_RETENTION_DAYS` | `3` | **Optional.** How many days the sandbox model gateway keeps its request log: one row per model call with the model, tokens, cost and timing, never a prompt or an answer. Tale does not read this log. Budgets, spend and usage come from the gateway's per-key budget counters, so a shorter log changes none of them. The backend passes the value to the gateway, which applies it at its first restart after the backend has passed it: it then deletes older rows, and again about once a day. A `tale deploy` restarts the gateway before the new backend passes the value, so a changed value takes effect from the following deploy. To apply it sooner, restart the `sandbox-llm-gateway` service once after the first sandbox session has started. The store reuses their space instead of growing. A whole number of days, at least 1; the backend ignores any other value and logs a warning. |

Investigate why output consumption stopped before increasing this deadline. It limits orphaned output streams, not total task duration. Recreate the consuming backend roles after changing the environment.

A changed gateway worker count reaches each provider the next time an organization that uses it starts a sandbox session or calls the model endpoints. A lower count also reaches every other provider the gateway holds: the backend resizes them two to five minutes after its first sandbox session or model-endpoint request following a restart.

A provider whose upstream host no longer resolves, such as one of a removed connector or of a host you took off your network, is the exception: the gateway refuses to rewrite it, so it keeps its workers, and the backend logs a warning that names it after every restart. Delete such a provider from the gateway. A provider still in use is set up again at its next sandbox session or model-endpoint request. Send the request from a backend container, which reaches the gateway and holds its admin password; on a `tale deploy` host, its name contains `-backend-api`:

```bash
docker exec <backend-api-container> sh -c 'curl -fsS -X DELETE -u "${SANDBOX_LLM_GATEWAY_ADMIN_USERNAME:-admin}:$SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD" "${SANDBOX_LLM_GATEWAY_URL:-http://sandbox-llm-gateway:8080}/api/providers/<name>"'
```

On Kubernetes, use `kubectl exec -n tale deploy/backend-api --` in place of `docker exec <backend-api-container>`.

The gateway starts every provider's workers while it boots, before the backend can reach it. Providers stored with more workers than these values (the gateway's own default is 1,000) can need more memory than the gateway's limit, 512 MiB with `tale deploy` and in the Kubernetes manifest, and the gateway is then killed during every start. Do not delete its volume, which holds its admin account and the keys it issued. Raise the limit until the gateway starts instead: on a `tale deploy` host, run `docker update --memory 2g --memory-swap 2g <container>` for the container whose name ends in `-sandbox-llm-gateway`; on Kubernetes, raise `resources.limits.memory` of its Deployment. Then start a sandbox session or call the model endpoints, and wait for the backend's log line `[llm-gateway] provider worker resize finished`, which comes two to five minutes later. It counts the providers the backend resized, the ones the gateway refused and the ones the backend could not confirm. A refused or unconfirmed provider keeps its workers, and a warning before the line names it; a restarted backend tries an unconfirmed provider again. Delete a refused provider whose upstream host no longer resolves, as described above, before you restore the limit. Afterwards, restore the limit with `docker update --memory 512m --memory-swap 1g <container>` and `docker restart <container>`, or on Kubernetes the Deployment's original value.

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
