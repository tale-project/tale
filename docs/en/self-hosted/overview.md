---
title: Self-hosted architecture
description: Nine containers behind a Caddy proxy, one Postgres, an S3-compatible blob store. This page hands you the mental model for what each container does, where data lives on disk, and which secrets matter at first boot.
---

A Tale instance is nine containers behind a Caddy proxy: the web tier, a two-role application backend, one Postgres, an S3-compatible blob store, and the three-container sandbox plane off to the side for code execution. A small `bgutil-provider` sidecar rounds it out for video-link ingestion. The compose file is the contract — what runs, what is exposed, what is mounted. This page hands you the mental model so the install, configure, and operate pages do not have to re-explain it.

Read this before you deploy. Come back when you are debugging an outage and need to know which container's logs to open first.

## The containers

**tale-proxy** is Caddy at the edge. It terminates TLS, serves the SPA and the platform's own routes from the platform container, and forwards the application surface — everything under `/api/` except `/api/health`, plus `/events` and the WebDAV door — to the backend. Healthchecks live here.

**tale-platform** is the web tier: a Vite + TanStack Router SPA plus the Bun server that serves it. It renders the UI, serves static assets and branding, watches the config store for live changes, and owns a few of its own routes (the health probe, the canvas/screencast preview, the WebDAV fallback). It is the only container the browser talks to directly, and it holds no business state — everything that persists goes through the backend.

**tale-backend-api** is the application backend running as the `api` role (`TALE_ROLE=api`): every application door — the app API, Better Auth, the SSE hint stream, the machine doors, and the in-sandbox bridges. Provider keys, agent definitions, automation runs, and audit logs all flow through it. It is a singleton — both platform colours point at the same api — and is dual-homed onto the sandbox network so a session container can reach it directly.

**tale-backend-worker** is the same image running as the `worker` role (`TALE_ROLE=worker`): the job runner behind schedules, watchdogs, and agent turns. It also runs the knowledge work — document ingestion, web crawling, RAG indexing, and document generation — as background jobs rather than separate services. The headless work those jobs need (rendering a web page, turning HTML into a PDF or image) is delegated to the sandbox runtime, which already ships Chromium and Playwright. The worker exposes no HTTP and scales horizontally (`--scale backend-worker=N`).

**tale-db** is the operational Postgres (ParadeDB, with `pg_search` + `pgvector`). The single-host stack folds two databases into it: `tale_app` — the application store behind agents, runs, and the audit log — and `tale_knowledge`, the knowledge corpus with two schemas, `private_knowledge` (uploaded-document chunks, embeddings, the BM25 index, the semantic cache) and `public_web` (crawled web pages). The service is aliased `knowledge-db` on the internal network, so the corpus resolves to the same Postgres with no extra wiring. The development `compose.yml` splits the corpus into a separate `knowledge-db` service instead, so it can be relocated on its own — see [Data residency](/self-hosted/configuration/data-residency).

**tale-object-store** is MinIO, the S3-compatible blob backend. Uploaded documents, chat attachments, audio, and generated media live here — it is the only blob backend, so a deployment that cannot reach it refuses every upload. It is internal-only: blobs reach the browser through presigned URLs the backend signs and the proxy forwards, never by exposing the store itself.

**tale-sandbox-llm-gateway** is the LLM gateway for in-sandbox coding-agent (harness) turns. It is the only path from a sandboxed harness to a model provider; the backend provisions it and mints per-session keys.

**tale-sandbox** and **tale-sandbox-egress** run sandboxed code on behalf of the `Run code` tool and skill scripts, and serve as the headless-browser runtime the backend calls for web rendering and document generation. The egress container is the only path the sandbox has to the network. Egress is open by default — sandboxed code reaches any public host over HTTPS while cloud-metadata and private-range targets stay blocked at the IP layer; lock it down to a hostname allowlist with `SANDBOX_EGRESS_ALLOWLIST`, described in [Hardening](/self-hosted/operate/security/hardening).

A tenth container, **tale-bgutil-provider**, is a best-effort third-party sidecar that supplies the PO-tokens video-link ingestion needs to get past YouTube's bot wall — see [Video ingestion](/self-hosted/configuration/video-ingestion).

## Data on disk

These volumes survive a `docker compose down`:

- `db-data` — the operational Postgres data directory: the application store _and_ the knowledge corpus (document chunks, embeddings, search indexes, crawled pages), since the single-host stack folds both into one database.
- `convex-data` — the org config store: agents, skills, providers, governance policies, SSO connection files, and uploaded branding. The name predates the Convex retirement and is kept so no operator has to migrate a volume for a rename; the backend owns every write, and the platform mounts it read-only.
- `object-store-data` — the blob store: uploaded files, chat attachments, generated documents, exported bundles.
- `caddy-data`, `caddy-config` — TLS certificates and proxy state.
- `backups` — checksummed volume snapshots written by `tale backup` and automatically before migrating deploys; [Backups and restore](/self-hosted/operate/backups-and-restore) is the drill.

Everything else is ephemeral. Containers can be replaced without data loss as long as the volumes survive. `tale backup` snapshots the data volumes above — `object-store-data` included, as long as the blobs live in the bundled object store. Blobs in an external S3 bucket, whether a repointed deployment default or an organization's own bucket, are yours to back up, and the backup says so; [Backups and restore](/self-hosted/operate/backups-and-restore) has the list and the drill.

## Provider secrets and the SOPS layer

Provider keys (OpenAI, Anthropic, Azure, Ollama, etc.) live on disk in a `providers/` directory inside the config store. Each provider has a `<name>.json` and a `<name>.secrets.json`; the secrets file is encrypted with SOPS and the [`SOPS_AGE_KEY`](/self-hosted/configuration/environment-reference) variable.

This split exists for two reasons. Rotating a provider key is editing one file, not re-running the backend; backing up the encrypted file is safe to commit alongside infrastructure. The plaintext mode (no SOPS, secrets in cleartext at mode 0600) is supported for tightly controlled environments where the disk itself is encrypted at rest.

## Auth and sessions

Sign-in is Better Auth running inside the backend-api container. The shipped modes are local email/password (with optional two-factor and passkeys), SSO — Microsoft Entra and generic OIDC — and trusted headers, where the reverse proxy provides the identity. The platform container reads the cookie and forwards the request; backend-api validates the session and decides what it can do based on the user's role and the per-resource permission matrix documented in [Members and roles](/platform/admin/members-and-roles).

The [authentication reference](/self-hosted/configuration/authentication) covers the env vars and the per-mode trade-offs.

## When you outgrow single-host

The default stack runs every container on one host. The architecture is single-tenant, but the tiers already split cleanly: `tale-backend-worker` scales horizontally, and the operational and knowledge stores are separate databases even when they share one Postgres process. The first thing you can move off the box without re-architecting is the knowledge corpus — point `KNOWLEDGE_DATABASE_URL` at a managed ParadeDB (for capacity or for a residency requirement) and it relocates independently, covered in [Data residency](/self-hosted/configuration/data-residency). The blob store is the second — an org that brings its own S3 bucket under **Settings > Data residency** bypasses the bundled `object-store` entirely.

## Where this fits

This architecture page is the map every other self-hosted page assumes. The natural next read is [Quickstart](/self-hosted/install/quickstart) if you are setting up a fresh instance, or [Container architecture](/self-hosted/operate/container-architecture) if you are operating one and need the same picture with the failure modes overlaid.
