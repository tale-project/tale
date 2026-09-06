---
title: Data residency
description: Where a self-hosted Tale deployment keeps its data, how the deployment defaults are set at deploy time, and how a single organization points its knowledge corpus and uploaded files at infrastructure of its own — live, without a restart.
---

A self-hosted Tale deployment runs on infrastructure you already control, so its data lives on your hosts by default. **Data residency** is for the case where a store has to live somewhere specific — document text in a database your team operates, uploaded files in your own S3 bucket, one tenant's corpus isolated from every other tenant's. Tale answers that at two levels: the **deployment defaults**, which every organization shares and which you set with environment variables when you deploy, and the **per-organization connections** an org admin manages live in **Settings > Data residency**.

This page covers what lives where, how to relocate the deployment defaults, the one prerequisite that bites (ParadeDB), and the per-organization knowledge and object-storage lanes, including moving an organization's existing files.

## Where the deployment's data lives

Three stores, each with its own environment variable. An unset variable means "use the bundled container", so a fresh deployment with no overrides is unchanged.

- **Knowledge database** — the knowledge corpus: document metadata, the extracted chunk text, embeddings, the BM25 index, the semantic cache, and the crawled web pages. It ships as the bundled `knowledge-db` container (`tale_knowledge`, with the `private_knowledge` and `public_web` schemas) and is the store most residency requirements care about, because it holds your document content. `KNOWLEDGE_DATABASE_URL` points the backend at a managed Postgres of your own instead; the database can start empty — the backend creates its schemas on first use.
- **File storage** — where uploaded files (the original blobs) live. By default they sit in the bundled object store (the `object-store` service, on its own volume). This store is configured differently from the two databases: on the **first boot only**, the backend seeds the deployment default from the `OBJECT_STORE_*` variables into `$TALE_CONFIG_DIR/default/object-storage/connection.json` (plus `connection.secrets.json` for the access keys, SOPS-encrypted when a key is configured), and from then on it reads that file, never the variables again — a file that already exists is never overwritten. So set `OBJECT_STORE_*` to an external S3-compatible bucket **before the first boot** to start there; to relocate the default of a running deployment, edit `connection.json` and `connection.secrets.json` by hand and roll the backend containers. Either way the switch is greenfield: blobs already written to the bundled store are not copied, so copy the volume into the bucket out of band first — and read [Backups and restore](/self-hosted/operate/backups-and-restore), because a repointed default takes the blobs out of `tale backup`'s snapshots.
- **Application database** — the operational store behind agents, runs, and the audit log (the bundled `db` container, the `tale_app` database). `DATABASE_URL` relocates it; the database name defaults to `tale_app` (override with `APP_DB_NAME`).

The variables live in the deployment's `.env`. `DATABASE_URL` and `KNOWLEDGE_DATABASE_URL` are read every time the backend containers start — change one, then roll with `tale deploy` (zero-downtime blue-green) or `docker compose restart backend-api backend-worker`; the `OBJECT_STORE_*` variables only matter for the first boot, as described above. Every variable, its default and its exact form is in the [Environment reference](/self-hosted/configuration/environment-reference). Nothing in the app writes these values: earlier releases carried a deployment-wide store section in Settings > Data residency that saved a `dataStores` block into `deployment.yml`, but no boot path read it — that section is gone, and a leftover `dataStores` block in an existing `deployment.yml` is ignored and dropped on the file's next save.

> Note: the knowledge database and the application database are two separate Postgres instances — moving one does not touch the other. Relocating the knowledge database moves the extracted text and embeddings; the original uploaded files move only when you also relocate **File storage**.

## The ParadeDB prerequisite

The knowledge database uses two Postgres extensions: `vector` (pgvector) for embeddings and `pg_search` (ParadeDB) for full-text/BM25 hybrid search. An external knowledge Postgres — the deployment default or an organization's own — **must run ParadeDB** (which bundles both) for full search quality. If you point it at a plain Postgres that has only `pgvector`, indexing and vector search still work, but hybrid search degrades to **vector-only**: the BM25 leg is silently skipped. The per-organization **Test connection** button reports both `pgvector` and `pg_search` availability so you see this before you commit; for the deployment default, check the extensions on the target database before you change `KNOWLEDGE_DATABASE_URL`.

## Per-organization knowledge databases

The deployment default is shared by every organization. A single organization can instead point **its own** knowledge corpus at a Postgres you provision for it, while every other org keeps using the default `knowledge-db`. Reach for this when one tenant's document and crawled-web content must sit on infrastructure isolated from the rest — a stricter residency requirement than the deployment default satisfies.

The org's **entire** knowledge corpus moves — both schemas: `private_knowledge` (document metadata, chunk text, embeddings, and the semantic cache) and `public_web` (the crawler's website pages, their chunk text, and embeddings). Nothing in an organization's knowledge database is shared with any other organization.

The connection lives under the organization's own config directory:

- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.json` — host, port, database, user, and sslmode.
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.secrets.json` — the password, SOPS-encrypted when a SOPS age key is configured (see [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops)).
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/embedding.json` — the organization's embedding model: provider, optional stored credential, model tag, vector width, and an optional OpenAI-compatible base URL.

The same ParadeDB requirement applies. The org validates its candidate database with an org-scoped connection test that reports `pgvector` and `pg_search` availability before switching, and a plain-pgvector target degrades that org's search to vector-only. The database can start empty — Tale creates the `private_knowledge` and `public_web` schemas on first use, so you never apply the baseline migrations by hand.

This path is fallback-safe. An organization with no `connection.json` keeps using the deployment-default `knowledge-db` exactly as before, so the feature changes nothing for orgs that don't opt in. Two organizations pointed at the same database share one connection pool, and a per-org change needs no container restart: the next request for that org routes to its own database.

**Settings > Data residency** is this per-organization surface: an organization owner or admin reads and writes exactly these files there, with the same connection test before switching. The JSON files on disk stay the source of truth — an operator who prefers to edit them by hand needs no UI step.

### The organization's embedding model

Knowledge search needs one more per-organization setting before it can run at all: the **embedding model** — which provider and model turn documents and queries into vectors, and at exactly what vector width. Without it, indexing and search refuse with an actionable error rather than guessing a model. Set it in the **Embedding model** section of **Settings > Data residency** (or write `embedding.json` by hand): pick a provider you hold a credential for, name the model tag as the provider spells it, and state the width the model produces — the width is never inferred from the model name, because a wrong guess writes vectors that search silently can't use.

The width is pinned **per database** when the first vector is written. On the shared deployment `knowledge-db`, that means every organization must agree on one width; an organization that wants a different embedding model at a different width is exactly the case for giving it its own knowledge database above.

## Per-organization object storage

The same per-organization pattern covers uploaded files. A single organization can point **its own** file blobs — Knowledge Hub documents, chat attachments, audio, and generated media — at an S3-compatible bucket you provision for it (AWS S3, MinIO, Cloudflare R2, …), while every other org keeps using the deployment default. The bucket is dedicated to that organization; nothing in it is shared across organizations.

The connection lives next to the knowledge one, under the organization's config directory:

- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.json` — region, optional endpoint (for MinIO/R2), path-style flag, bucket, and an optional key prefix.
- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.secrets.json` — the access key pair, SOPS-encrypted when a SOPS age key is configured (see [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops)).

This path is **not** greenfield-only: from the moment the config exists, new uploads go to the org's bucket, while files stored earlier stay readable where they are in the deployment's object store — mixed references are supported, so you can switch at any time and relocate the older files afterward with the blob backfill below. Removing the config sends new uploads back to the deployment default; files already written to the bucket stay there, but Tale can't read them until the connection is added again. No restart is needed in either direction.

Org admins manage this connection from the same **Settings > Data residency** page; its connection test performs a real upload/read/delete round-trip against the bucket before you commit. As with the knowledge connection, the JSON files remain the source of truth.

> **Allow the app's origin in the bucket's CORS policy.** Uploads and downloads run directly between the browser and the bucket via presigned URLs, so the bucket must accept cross-origin requests from your deployment's URL — allow that origin with the methods `GET`, `PUT`, and `HEAD` and all request headers (Cloudflare R2: the bucket's **Settings > CORS Policy**; AWS S3 and MinIO: the bucket's CORS configuration). The in-app connection test runs from the server, not the browser, so a missing CORS policy surfaces only later, as a failed upload.

### Moving pre-existing files into the bucket

Connecting the bucket only reroutes **new** uploads; the blobs written before you connected it stay in the deployment's default object store and keep working through the mixed references above. To bring that history onto your own infrastructure as well — the whole point of data residency — run the **blob backfill**: it moves each pre-existing blob into the org's bucket — the copy lands with its stored content type, is verified against the source's size, and only then is the source copy deleted. Nothing is rewritten: a blob keeps its key across the move, and reads find it in whichever store holds it.

An org admin runs it from the UI: with the bucket connection saved, the Object storage section of **Settings > Data residency** shows **Move existing files** — confirm, and the move runs in the background while uploads keep working; a status line on the same section reports progress and the outcome of the latest run.

The backfill is **idempotent** and **org-scoped**: it moves only that organization's blobs, skips anything already in the bucket, and leaves each source blob in place until its copy is verified — so a re-run after an interruption resumes safely, finishing any move that was cut off between the verified copy and the source delete. It walks every table that holds blob references: documents and their history, uploaded files, synthesized speech audio, and video-link transcripts. It needs the bucket connection configured first, and it refuses to run when the org's bucket is the deployment's own store — there would be nothing to move, and finishing a move would delete the only copy. This is deliberately **not** a versioned framework migration — it runs on demand, per organization, when you choose to relocate a tenant's history, not at a release boundary.

The deployment defaults and their variables are listed in the [Environment reference](/self-hosted/configuration/environment-reference); the per-organization secrets sidecars follow [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops).
