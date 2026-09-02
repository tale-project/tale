---
title: Data residency
description: Point a self-hosted Tale deployment's knowledge database, application database, and uploaded-file storage at infrastructure you control, configured by administrators in Settings > Data residency and applied on restart.
---

A self-hosted Tale deployment runs on infrastructure you already control, so its data lives on your hosts by default. **Data residency** is for the case where you want individual data stores pointed at your own managed Postgres or object storage instead of the bundled containers — for example to keep document text in a database your team operates, or uploaded files in your own S3 bucket. The knowledge corpus is a database of its own, addressed by its own connection string, precisely so it can be relocated or replaced independently of the operational database — it is the store most residency requirements care about.

Two mechanisms sit behind that. A **deployment-wide** store is repointed on the host, in `.env` and the config tree, and takes effect when the backend containers restart. A **per-organization** store is configured by an org owner or admin in **Settings > Data residency**, lands in that organization's own config directory, and takes effect on the next request. This page covers both, the one prerequisite that bites (ParadeDB), how the configuration is stored, and how to restart safely.

## Enabling editing

**Settings > Data residency** is one page with two kinds of section: the deployment-wide stores every organization shares, and the stores a single organization brings for itself. Each section renders read-only or editable depending on what the reader may change, and the page says which state you are in. Viewing is open to any organization owner or admin; **editing the deployment-wide stores** — repointing a data store, saving secrets, running a connection test — is restricted to a named allowlist of operators. List their sign-in emails (comma-separated) in `.env` and restart:

```bash
TALE_DEPLOYMENT_CONFIG_ADMINS=alice@example.com,bob@example.com
```

With the allowlist empty or unset, the deployment sections still show the current configuration to administrators, but read-only — the **Save deployment** header action appears only for allowlisted operators. Only a signed-in admin whose email is on the list gets those sections editable; the page tells you which email to add. There is no restart button: a save prints the two commands that apply it, and the section below repeats them. An operator who prefers to work on the host can skip the allowlist entirely and edit `.env` and the config files directly.

## What you can relocate

Three stores, each independent and optional. An absent setting means "use the bundled default" — so a fresh deployment with no config is unchanged.

<Warning>

**Saving the deployment-wide sections does not repoint a store.** The backend opens the application database from `DATABASE_URL`, the knowledge corpus from `KNOWLEDGE_DATABASE_URL`, and the blob store from the `default` config tree's `object-storage/connection.json`. Nothing at boot reads the `dataStores` block that these sections write to `deployment.yml`. Relocate a deployment-wide store with the environment variable or the file named under it below, and read the deployment sections as a record of the intended topology rather than the switch that applies it. The **per-organization** sections further down this page are a different mechanism and do take effect.

</Warning>

- **Knowledge database** — the knowledge corpus: document metadata, the extracted chunk text, embeddings, the BM25 index, the semantic cache, and the crawled web pages. It ships as the `tale_knowledge` database, with the `private_knowledge` and `public_web` schemas, reached at host `knowledge-db`, and is the store most residency requirements care about, because it holds your document content. Point it at your own managed Postgres with `KNOWLEDGE_DATABASE_URL` in `.env` to keep the corpus on infrastructure your team operates.
- **File storage** — where uploaded files (the original blobs) live. By default they sit in the bundled object store that ships with the stack (the `object-store` service, on its own volume). Point them at an external S3-compatible bucket by editing `$TALE_CONFIG_DIR/default/object-storage/connection.json` and its `connection.secrets.json` sidecar; the backend seeds that file against the bundled store on first boot and never overwrites one that exists.
- **Application database** (advanced) — the operational store: chats, tasks, automation runs, the audit log, the background job queue. It ships as the `tale_app` database on the bundled `db` container, and the backend reaches it through one connection string, `DATABASE_URL`. Point that at your own managed Postgres to relocate it; the backend applies its schema migrations to whatever it finds there, at boot, under an advisory lock.

> Note: the knowledge database and the application database are two separate databases — moving one does not touch the other. On a single-host `tale deploy` stack they share one Postgres container, so a residency requirement that separates them is a reason to relocate at least one. Relocating the knowledge database moves the extracted text and embeddings; the original uploaded files move only when you also relocate **File storage**.

## The ParadeDB prerequisite

The knowledge database uses two Postgres extensions: `vector` (pgvector) for embeddings and `pg_search` (ParadeDB) for full-text/BM25 hybrid search. An external knowledge Postgres **must run ParadeDB** (which bundles both) for full search quality. If you point it at a plain Postgres that has only `pgvector`, indexing and vector search still work, but hybrid search degrades to **vector-only** — the BM25 leg is silently skipped. The **Test connection** button reports both `pgvector` and `pg_search` availability so you can see this before you commit. The external knowledge database must already exist (it can have any name you enter — `tale_knowledge` by convention) with the `private_knowledge` and `public_web` schemas; the baseline schema migrations live in [`services/db/migrations/`](https://github.com/tale-project/tale/tree/main/services/db/migrations) and are applied via dbmate when the database comes up.

## Per-organization knowledge databases

The stores above are deployment-wide — every organization shares them. A single organization can instead point **its own** knowledge corpus at a Postgres you provision for it, while every other org keeps using the bundled `knowledge-db`. Reach for this when one tenant's document and crawled-web content must sit on infrastructure isolated from the rest — a stricter residency requirement than the deployment default satisfies.

The org's **entire** knowledge corpus moves — both schemas: `private_knowledge` (document metadata, chunk text, embeddings, and the semantic cache) and `public_web` (the crawler's website pages, their chunk text, and embeddings). Nothing in an organization's knowledge database is shared with any other organization.

The connection lives under the organization's own config directory, not the deployment file:

- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.json` — host, port, database, user, and sslmode.
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/connection.secrets.json` — the password, SOPS-encrypted when a SOPS age key is configured (see [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops)).
- `$TALE_CONFIG_DIR/<orgSlug>/knowledge/embedding.json` — the organization's embedding model: provider, optional stored credential, model tag, vector width, and an optional OpenAI-compatible base URL.

The same ParadeDB requirement applies. The org validates its candidate database with an org-scoped connection test that reports `pgvector` and `pg_search` availability before switching, and a plain-pgvector target degrades that org's search to vector-only. The database can start empty — Tale creates the `private_knowledge` and `public_web` schemas on first use, so you never apply the baseline migrations by hand.

This path is fallback-safe. An organization with no `connection.json` keeps using the deployment-default `knowledge-db` exactly as before, so the feature changes nothing for orgs that don't opt in. Two organizations pointed at the same database share one connection pool, and — unlike the deployment-wide stores — a per-org change needs no container restart: the next request for that org routes to its own database.

An organization owner or admin can also manage this connection from the UI: the per-organization sections of **Settings > Data residency** read and write exactly these files, with the same connection test before switching. Those sections stay editable for an org owner or admin whether or not the operator allowlist names them, because the files they touch belong to the organization rather than the deployment. The JSON files on disk stay the source of truth — an operator who prefers to edit them by hand needs no UI step.

### The organization's embedding model

Knowledge search needs one more per-organization setting before it can run at all: the **embedding model** — which provider and model turn documents and queries into vectors, and at exactly what vector width. Without it, indexing and search refuse with an actionable error rather than guessing a model. Set it in the **Embedding model** section of **Settings > Data residency** (or write `embedding.json` by hand): pick a provider you hold a credential for, name the model tag as the provider spells it, and state the width the model produces — the width is never inferred from the model name, because a wrong guess writes vectors that search silently can't use.

The width is pinned **per database** when the first vector is written. On the shared deployment `knowledge-db`, that means every organization must agree on one width; an organization that wants a different embedding model at a different width is exactly the case for giving it its own knowledge database above.

## Per-organization object storage

The same per-organization pattern covers uploaded files. A single organization can point **its own** file blobs — Knowledge Hub documents, chat attachments, audio, and generated media — at an S3-compatible bucket you provision for it (AWS S3, MinIO, Cloudflare R2, …), while every other org keeps using the deployment default. The bucket is dedicated to that organization; nothing in it is shared across organizations.

The connection lives next to the knowledge one, under the organization's config directory:

- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.json` — region, optional endpoint (for MinIO/R2), path-style flag, bucket, and an optional key prefix.
- `$TALE_CONFIG_DIR/<orgSlug>/object-storage/connection.secrets.json` — the access key pair, SOPS-encrypted when a SOPS age key is configured (see [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops)).

This path is **not** greenfield-only: from the moment the config exists, new uploads go to the org's bucket, while files stored earlier stay readable in the deployment default store — so you can switch at any time and relocate the older files afterward with the blob backfill below. Removing the config sends new uploads back to the deployment default; files already written to the bucket stay there, but Tale can't read them until the connection is added again. No restart is needed in either direction: the resolver caches a connection for fifteen seconds, so a change is live almost immediately.

Org admins can manage this connection from the same per-organization sections of **Settings > Data residency**; its connection test performs a real upload/read/delete round-trip against the bucket before you commit. As with the knowledge connection, the JSON files remain the source of truth.

> **Allow the app's origin in the bucket's CORS policy.** Uploads and downloads run directly between the browser and the bucket via presigned URLs, so the bucket must accept cross-origin requests from your deployment's URL — allow that origin with the methods `GET`, `PUT`, and `HEAD` and all request headers (Cloudflare R2: the bucket's **Settings > CORS Policy**; AWS S3 and MinIO: the bucket's CORS configuration). The in-app connection test runs from the server, not the browser, so a missing CORS policy surfaces only later, as a failed upload.

### Moving pre-existing files into the bucket

Connecting the bucket only reroutes **new** uploads; the blobs written before you connected it stay in the deployment default store and keep working, because a stored reference names the object key and the resolver decides which store to read it from. To bring that history onto your own infrastructure as well — the whole point of data residency — run the **blob backfill**: it walks the organization's documents (current files and every version in their history) and its file metadata, and copies each object from the deployment default store into the org's bucket under the same key.

An org admin runs it from the UI: with the bucket connection saved, the Object storage section of **Settings > Data residency** shows **Move existing files** — confirm, and the move runs as a background job while uploads keep working; a status line on the same section reports progress and the outcome of the latest run.

Two properties make it safe to re-run. Keys never change, so no row is rewritten and no reference can go stale mid-run: an object flips from being read out of the default store to being read out of the bucket the moment its copy lands. And every object already present in the bucket is skipped, so an interrupted run resumes rather than re-copying. The run is org-scoped, and it needs the bucket connection saved first.

What it does not do is delete. The source object stays in the deployment default store, so a backfill relocates a copy rather than moving the bytes — plan a separate cleanup pass if the residency requirement is that the old copy stop existing. This is deliberately **not** a versioned framework migration: it runs on demand, per organization, when you choose to relocate a tenant's history, not at a release boundary.

## How the configuration is stored

Saving the deployment sections writes two files at the config root (not under an org directory):

- `deployment.yml` — the non-secret config (hosts, ports, buckets, modes). A deployment still carrying the retired `deployment.json` is read as-is and converted on the next save.
- `deployment.secrets.json` — the database passwords and S3 keys, SOPS-encrypted (see [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops)).

The per-organization sections write into the organization's own directory instead, at the paths listed above. Those are the files the backend actually resolves a connection from, and the read is **fail-closed**: an org config that is present but unparseable, or whose secret will not decrypt, refuses that organization's reads rather than silently falling back to the bundled store — mis-routing regulated data is worse than failing loudly. An absent file is the normal default path.

## Applying a change: restart

A deployment-wide connection is read at boot, so a change to `.env` or the `default` config tree does not take effect until the backend containers (`backend-api` and `backend-worker`) restart. Run `docker compose restart backend-api backend-worker`, or `tale deploy` for a zero-downtime blue-green roll — the settings page shows the same commands after a save. A per-organization connection needs no restart.

The relevant environment variable is `TALE_DEPLOYMENT_CONFIG_ADMINS` (the comma-separated email allowlist of operators allowed to edit). Set it in `.env`. See also [Environment reference](/self-hosted/configuration/environment-reference) and [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops).
