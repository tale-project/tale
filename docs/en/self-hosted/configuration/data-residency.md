---
title: Data residency
description: Point a self-hosted Tale deployment's knowledge database, application database, and uploaded-file storage at infrastructure you control, configured by administrators in Settings > Data residency and applied on restart.
---

A self-hosted Tale deployment runs on infrastructure you already control, so its data lives on your hosts by default. **Data residency** is for the case where you want individual data stores pointed at your own managed Postgres or object storage instead of the bundled containers — for example to keep document text in a database your team operates, or uploaded files in your own S3 bucket. The knowledge corpus runs as its own container (`knowledge-db`) precisely so it can be relocated or replaced independently of the operational database — it is the store most residency requirements care about. Administrators configure this in **Settings > Data residency**; the change is written to a single deployment-level config file and **takes effect when the affected containers restart**.

This page covers what can be relocated, the one prerequisite that bites (ParadeDB), how the configuration is stored and applied, and how to restart safely.

## Enabling editing

**Settings > Data residency** is one page with two kinds of section: the deployment-wide stores every organization shares, and the stores a single organization brings for itself. Each section renders read-only or editable depending on what the reader may change, and the page says which state you are in. Viewing is open to any organization owner or admin; **editing the deployment-wide stores** — repointing a data store, saving secrets, running a connection test, or applying a restart — is restricted to a named allowlist of operators. List their sign-in emails (comma-separated) in `.env` and restart:

```bash
TALE_DEPLOYMENT_CONFIG_ADMINS=alice@example.com,bob@example.com
```

With the allowlist empty or unset, the deployment sections still show the current configuration to administrators, but read-only — Save, Test, and Apply & restart refuse for everyone. Only a signed-in admin whose email is on the list gets those sections editable; the page tells you which email to add. The entrypoints always consume the config file regardless of the allowlist, so an operator who prefers to hand-edit the file on disk can do so without naming any UI editors.

## What you can relocate

Three stores, each independent and optional. An absent setting means "use the bundled default" — so a fresh deployment with no config is unchanged.

- **Knowledge database** — the knowledge corpus: document metadata, the extracted chunk text, embeddings, the BM25 index, the semantic cache, and the crawled web pages. It ships as the bundled `knowledge-db` container (`tale_knowledge`, with the `private_knowledge` and `public_web` schemas) and is the store most residency requirements care about, because it holds your document content. Point it at your own managed Postgres to keep the corpus on infrastructure your team operates.
- **File storage** — where uploaded files (the original blobs) live. By default they sit on the local Convex volume; you can point them at an external S3-compatible bucket.
- **Application database** (advanced) — the operational Convex database (the bundled `db` container). The Convex backend derives this database's name from `INSTANCE_NAME` (`tale_platform`) and connects on host:port only, so the external Postgres must contain a database named exactly `tale_platform`. Its TLS mode is fixed by the Convex driver and is not configurable.

> Note: the knowledge database and the application database are two separate Postgres instances — moving one does not touch the other. Relocating the knowledge database moves the extracted text and embeddings; the original uploaded files move only when you also relocate **File storage** to S3.

## The ParadeDB prerequisite

The knowledge database uses two Postgres extensions: `vector` (pgvector) for embeddings and `pg_search` (ParadeDB) for full-text/BM25 hybrid search. An external knowledge Postgres **must run ParadeDB** (which bundles both) for full search quality. If you point it at a plain Postgres that has only `pgvector`, indexing and vector search still work, but hybrid search degrades to **vector-only** — the BM25 leg is silently skipped. The **Test connection** button reports both `pgvector` and `pg_search` availability so you can see this before you commit. The external knowledge database must already exist (it can have any name you enter — `tale_knowledge` by convention) with the `private_knowledge` and `public_web` schemas; the baseline schema migrations live in [`services/db/migrations/`](https://github.com/tale-project/tale/tree/main/services/db/migrations) and are applied via dbmate when the database comes up.

## Per-organization knowledge databases

The stores above are deployment-wide — every organization shares them. A single organization can instead point **its own** knowledge corpus at a Postgres you provision for it, while every other org keeps using the bundled `knowledge-db`. Reach for this when one tenant's document and crawled-web content must sit on infrastructure isolated from the rest — a stricter residency requirement than the deployment default satisfies.

The org's **entire** knowledge corpus moves — both schemas: `private_knowledge` (document metadata, chunk text, embeddings, and the semantic cache) and `public_web` (the crawler's website pages, their chunk text, and embeddings). Nothing in an organization's knowledge database is shared with any other organization.

The connection lives under the organization's own config directory, not the deployment file:

- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.json` — host, port, database, user, and sslmode.
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.secrets.json` — the password, SOPS-encrypted when a SOPS age key is configured (see [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops)).

The same ParadeDB requirement applies. The org validates its candidate database with an org-scoped connection test that reports `pgvector` and `pg_search` availability before switching, and a plain-pgvector target degrades that org's search to vector-only. The database can start empty — Tale creates the `private_knowledge` and `public_web` schemas on first use, so you never apply the baseline migrations by hand.

This path is fallback-safe. An organization with no `connection.json` keeps using the deployment-default `knowledge-db` exactly as before, so the feature changes nothing for orgs that don't opt in. Two organizations pointed at the same database share one connection pool, and — unlike the deployment-wide stores — a per-org change needs no container restart: the next request for that org routes to its own database.

An organization owner or admin can also manage this connection from the UI: the per-organization sections of **Settings > Data residency** read and write exactly these files, with the same connection test before switching. Those sections stay editable for an org owner or admin whether or not the operator allowlist names them, because the files they touch belong to the organization rather than the deployment. The JSON files on disk stay the source of truth — an operator who prefers to edit them by hand needs no UI step.

## Per-organization object storage

The same per-organization pattern covers uploaded files. A single organization can point **its own** file blobs — Knowledge Hub documents, chat attachments, audio, and generated media — at an S3-compatible bucket you provision for it (AWS S3, MinIO, Cloudflare R2, …), while every other org keeps using the deployment default. The bucket is dedicated to that organization; nothing in it is shared across organizations.

The connection lives next to the knowledge one, under the organization's config directory:

- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.json` — region, optional endpoint (for MinIO/R2), path-style flag, bucket, and an optional key prefix.
- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.secrets.json` — the access key pair, SOPS-encrypted when a SOPS age key is configured (see [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops)).

Unlike the deployment-wide S3 switch above, this path is **not** greenfield-only: from the moment the config exists, new uploads go to the org's bucket, while files stored earlier stay readable where they are in Convex storage — mixed references are supported, so you can switch at any time and relocate the older files afterward with the blob backfill below. Removing the config sends new uploads back to the deployment default; files already written to the bucket stay there, but Tale can't read them until the connection is added again. No restart is needed in either direction.

Org admins can manage this connection from the same per-organization sections of **Settings > Data residency**; its connection test performs a real upload/read/delete round-trip against the bucket before you commit. As with the knowledge connection, the JSON files remain the source of truth.

> **Allow the app's origin in the bucket's CORS policy.** Uploads and downloads run directly between the browser and the bucket via presigned URLs, so the bucket must accept cross-origin requests from your deployment's URL — allow that origin with the methods `GET`, `PUT`, and `HEAD` and all request headers (Cloudflare R2: the bucket's **Settings > CORS Policy**; AWS S3 and MinIO: the bucket's CORS configuration). The in-app connection test runs from the server, not the browser, so a missing CORS policy surfaces only later, as a failed upload.

### Moving pre-existing files into the bucket

Connecting the bucket only reroutes **new** uploads; the blobs written before you connected it stay in Convex's `_storage` and keep working through the mixed references above. To bring that history onto your own infrastructure as well — the whole point of data residency — run the **blob backfill**: an operator action that copies each pre-existing blob into the org's bucket, verifies it round-trips byte-for-byte, rewrites every row that references it, and deletes the Convex copy.

Run it from a shell with Convex CLI access, passing the organization's id. Dry-run first to see what would move, then run it for real:

```bash
# Dry run — counts and samples what would move, writes nothing:
bunx convex run object_storage/backfill_actions:migrateOrgBlobsToObjectStorage '{"organizationId":"<organizationId>","dryRun":true}'

# The real move — drop dryRun once the counts look right:
bunx convex run object_storage/backfill_actions:migrateOrgBlobsToObjectStorage '{"organizationId":"<organizationId>"}'
```

The backfill is **idempotent** and **org-scoped**: it moves only that organization's blobs, skips anything already in the bucket, and leaves each Convex source in place until its copy is verified — so a re-run after an interruption resumes safely. A real run needs the bucket connection configured first; a dry run does not. This is deliberately **not** a versioned framework migration — it runs on demand, per organization, when you choose to relocate a tenant's history, not at a release boundary.

## File storage on S3

External file storage is all-or-nothing across Convex's storage use-cases, so you provide **five buckets** — files, exports, snapshot-imports, modules, and search — plus a region and credentials. For S3-compatible services (MinIO, Cloudflare R2) set the endpoint and enable path-style addressing.

> **Greenfield only.** Switching file storage from local to S3 does **not** migrate the blobs already on the local volume — Convex will look for them in the bucket and not find them. Set S3 at initial deployment, or copy the existing local storage into the bucket out of band before switching.

## How the configuration is stored

Saving writes two files at the config root (not under an org directory):

- `deployment.json` — the non-secret config (hosts, ports, buckets, modes).
- `deployment.secrets.json` — the database passwords and S3 keys, SOPS-encrypted (see [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops)).

At boot the `convex` entrypoint reads these and derives its connections before starting. Knowledge ingestion and retrieval run inside the Convex backend, so it is the only container that opens the knowledge-database connection — there is no separate retrieval service to configure. The contract is **fail-closed**: a present-but-unparseable `deployment.json`, an undecryptable secret, or a config missing required fields **aborts startup** rather than silently falling back to the bundled database — mis-routing regulated data is worse than not starting. An absent file is the normal default path.

## Applying a change: restart

The config is read at boot, so a save does not take effect until the **`convex`** container restarts (the platform itself does not need restarting). Two ways:

- **Manual** — `docker compose restart convex`, or `tale deploy --services convex` for a zero-downtime blue-green roll.
- **One-click** — enable the opt-in `controller` service (`docker compose --profile controller up -d`). It is a small internal-only sidecar that restarts the allowlisted `convex` service on an HMAC-signed request from the app, so the browser-facing platform never needs Docker-socket access. With it running, the **Apply & restart** button does the bounce for you; set `CONTROLLER_TOKEN` (shared with the platform) and `CONTROLLER_URL` in `.env`. Without it, the button shows the manual command.

The relevant environment variables are `TALE_DEPLOYMENT_CONFIG_ADMINS` (the comma-separated email allowlist of operators allowed to edit), and — only when running the one-click `controller` — `CONTROLLER_TOKEN` (the shared HMAC secret) and `CONTROLLER_URL` (e.g. `http://controller:8004`). Set them in `.env`. See also [Environment reference](/self-hosted/configuration/environment-reference) and [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops).
