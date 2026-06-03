---
title: Data residency
description: Point a self-hosted Tale deployment's knowledge database, application database, and uploaded-file storage at infrastructure you control, configured by administrators in Settings > Data residency and applied on restart.
---

A self-hosted Tale deployment runs on infrastructure you already control, so its data lives on your hosts by default. **Data residency** is for the case where you want individual data stores pointed at your own managed Postgres or object storage instead of the bundled containers — for example to keep document text in a database your team operates, or uploaded files in your own S3 bucket. Administrators configure this in **Settings > Data residency**; the change is written to a single deployment-level config file and **takes effect when the affected containers restart**.

This page covers what can be relocated, the one prerequisite that bites (ParadeDB), how the configuration is stored and applied, and how to restart safely.

## Enabling the settings page

The settings page is gated behind an opt-in environment variable so a deployment can't have its data location changed from the UI unless an operator has explicitly allowed it. Set it in `.env` and restart:

```
TALE_DEPLOYMENT_CONFIG_UI=true
```

With the flag unset, **Settings > Data residency** still shows the current configuration to administrators, but read-only — the Save and Test actions refuse. The entrypoints always consume the config file regardless of the flag, so an operator who prefers to hand-edit the file on disk can do so without enabling the UI.

## What you can relocate

Three stores, each independent and optional. An absent setting means "use the bundled default" — so a fresh deployment with no config is unchanged.

- **Knowledge database** — the RAG store: document metadata, the extracted chunk text, embeddings, the BM25 index, and the semantic cache. This is the store most residency requirements care about, because it holds your document content.
- **File storage** — where uploaded files (the original blobs) live. By default they sit on the local Convex volume; you can point them at an external S3-compatible bucket.
- **Application database** (advanced) — the Convex metadata database.

> Note: relocating the knowledge database moves the extracted text and embeddings. The original uploaded files move only when you also relocate **File storage** to S3.

## The ParadeDB prerequisite

The knowledge database uses two Postgres extensions: `vector` (pgvector) for embeddings and `pg_search` (ParadeDB) for full-text/BM25 hybrid search. An external knowledge Postgres **must run ParadeDB** (which bundles both) for full search quality. If you point it at a plain Postgres that has only `pgvector`, indexing and vector search still work, but hybrid search degrades to **vector-only** — the BM25 leg is silently skipped. The **Test connection** button reports both `pgvector` and `pg_search` availability so you can see this before you commit. The databases (`tale`, `tale_knowledge`) must already exist; the RAG service runs its migrations against them on boot.

## File storage on S3

External file storage is all-or-nothing across Convex's storage use-cases, so you provide **five buckets** — files, exports, snapshot-imports, modules, and search — plus a region and credentials. For S3-compatible services (MinIO, Cloudflare R2) set the endpoint and enable path-style addressing.

> **Greenfield only.** Switching file storage from local to S3 does **not** migrate the blobs already on the local volume — Convex will look for them in the bucket and not find them. Set S3 at initial deployment, or copy the existing local storage into the bucket out of band before switching.

## How the configuration is stored

Saving writes two files at the config root (not under an org directory):

- `deployment.json` — the non-secret config (hosts, ports, buckets, modes).
- `deployment.secrets.json` — the database passwords and S3 keys, SOPS-encrypted (see [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops)).

At boot the `rag` and `convex` entrypoints read these and derive their connections before starting. The contract is **fail-closed**: a present-but-unparseable `deployment.json`, an undecryptable secret, or a config missing required fields **aborts startup** rather than silently falling back to the bundled database — mis-routing regulated data is worse than not starting. An absent file is the normal default path.

## Applying a change: restart

The config is read at boot, so a save does not take effect until the **`rag` and `convex`** containers restart (the platform itself does not need restarting). Two ways:

- **Manual** — `docker compose restart rag convex`, or `tale deploy --services rag` for a zero-downtime blue-green roll.
- **One-click** — enable the opt-in `controller` service (`docker compose --profile controller up -d`). It is a small internal-only sidecar that restarts the two allowlisted services on an HMAC-signed request from the app, so the browser-facing platform never needs Docker-socket access. With it running, the **Apply & restart** button does the bounce for you; set `CONTROLLER_TOKEN` (shared with the platform) and `CONTROLLER_URL` in `.env`. Without it, the button shows the manual command.

The relevant environment variables are `TALE_DEPLOYMENT_CONFIG_UI` (enables UI editing), and — only when running the one-click `controller` — `CONTROLLER_TOKEN` (the shared HMAC secret) and `CONTROLLER_URL` (e.g. `http://controller:8004`). Set them in `.env`. See also [Environment reference](/self-hosted/configuration/environment-reference) and [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops).
