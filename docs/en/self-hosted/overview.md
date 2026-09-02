---
title: Self-hosted architecture
description: Eleven containers in one compose file, two of them Postgres databases and one an S3-compatible blob store. This page hands you the mental model for what each container does, where data lives on disk, and which secrets matter at first boot.
---

A Tale instance is eleven containers behind a Caddy proxy, talking to two Postgres databases — one operational, one for the knowledge corpus — and an S3-compatible blob store; two of them are sandbox containers off to the side for code execution. The compose file is the contract — what runs, what is exposed, what is mounted. This page hands you the mental model so the install, configure, and operate pages do not have to re-explain it.

Read this before you `docker compose up`. Come back when you are debugging an outage and need to know which container's logs to open first.

## The eleven containers

**tale-proxy** is Caddy at the edge. It terminates TLS, serves the HTML and static assets from the platform container, and forwards everything under `/api/` — plus `/events`, `/dav`, and the machine API — to the backend. It also publishes the blob store's bucket path so presigned upload and download URLs work in the browser. Healthchecks live here.

**tale-platform** is the React + TanStack Start server. It renders the UI, serves static assets, and terminates the live-browser screencast socket. It holds no business state and reaches no database — everything that persists goes through the backend.

**backend-api** is the application backend: a Node process running a Hono app that serves every door the UI and the machine API use — sign-in, the app API, WebDAV, the live-update stream. Provider keys, agent definitions, workflow runs, and audit logs live behind it. Knowledge *search* runs in this process, querying the corpus database directly rather than through a separate retrieval service.

**backend-worker** is the same image in the worker role. It runs the background jobs — document ingestion and embedding, web crawling, automation runs, retention sweeps — off a pg-boss queue that lives in the application database, so a job commits in the same transaction as the write that scheduled it. The headless work some of those jobs need (rendering a web page, turning HTML into a PDF or image) is delegated to the sandbox runtime, which already ships Chromium and Playwright. The worker serves no HTTP.

**tale-db** is the operational Postgres (ParadeDB). It holds the `tale_app` database — agents, runs, sessions, the audit log, and the job queue — and the backend applies its schema migrations to it at boot, under an advisory lock, so a rolling deploy migrates exactly once.

**tale-object-store** is the blob store: an S3-compatible MinIO instance holding every uploaded document, chat attachment, audio file, and generated medium. S3-compatible storage is the only blob backend, so a deployment without one refuses every upload. It is internal-only; the backend signs presigned URLs and the proxy forwards them.

**tale-knowledge-db** is the knowledge corpus Postgres (ParadeDB), the `tale_knowledge` database with two schemas: `private_knowledge` (uploaded-document chunks, embeddings, the BM25 index, the semantic cache) and `public_web` (crawled web pages). Keeping it addressable on its own connection string is what lets the corpus — the data-residency-sensitive store — be relocated or replaced independently. On a single-host `tale deploy` stack it is folded into `tale-db`, which carries the `knowledge-db` network alias so the connection string resolves either way.

**tale-sandbox-llm-gateway** is the LLM gateway for harness turns. It is the only path from a sandboxed harness to a model provider; the platform provisions it and mints per-session keys.

**bgutil-provider** is a third-party helper for video-link ingestion: it issues the tokens YouTube requires before a transcript can be fetched. It is the only image in the stack Tale does not build, it is internal-only, and a deployment that never ingests video links can stop it without affecting anything else.

**tale-sandbox** and **tale-sandbox-egress** run sandboxed code on behalf of the `Run code` tool and skill scripts, and serve as the headless-browser runtime the backend calls for web rendering and document generation. The egress container is the only path the sandbox has to the network. Egress is open by default — sandboxed code reaches any public host over HTTPS while cloud-metadata and private-range targets stay blocked at the IP layer; lock it down to a hostname allowlist with `SANDBOX_EGRESS_ALLOWLIST`, described in [Hardening](/self-hosted/operate/security/hardening).

## Data on disk

Five volumes survive a `docker compose down`:

- `db-data` — the operational Postgres data directory: the database behind agents, runs, sessions, the audit log, and the job queue.
- `knowledge-db-data` — the knowledge corpus Postgres data directory: document chunks, embeddings, the search indexes, and crawled web pages. Separate from `db-data` because it is a separate database, and absent on a stack that folded the corpus into `tale-db`.
- `object-store-data` — the blob store: every uploaded document, chat attachment, audio file, and generated medium.
- `convex-data` — the org config tree: agents, automations, connectors, providers, skills, governance policies, SSO connections, branding. The name is historical and deliberately unchanged, so that retiring the Convex backend did not force operators to migrate a volume for a rename.
- `backups` — checksummed volume snapshots written by `tale backup` and automatically before migrating deploys; [Backups and restore](/self-hosted/operate/backups-and-restore) is the drill.

`object-store-data` is the one to notice: a `tale backup` snapshot does **not** include it, so uploaded files need their own place in your backup job. Everything else is ephemeral. Containers can be replaced without data loss as long as the volumes survive.

## Provider secrets and the SOPS layer

Config-file secrets — provider secret sidecars, the knowledge and object-storage connection passwords, the deployment config's own secrets — live on disk in the org config tree, encrypted with SOPS and the [`SOPS_AGE_KEY`](/self-hosted/configuration/environment-reference) variable. The backend containers mount that tree read-write and are the only processes that hold the age key; the web tier mounts the same volume read-only for branding images and never decrypts anything.

This split exists for two reasons. Rotating a secret is editing one file, not re-running the platform; backing up the encrypted file is safe to commit alongside infrastructure. The plaintext mode (no SOPS, secrets in cleartext) is supported for tightly controlled environments where the disk itself is encrypted at rest.

## Auth and sessions

Sign-in is Better Auth running inside the backend. Four sign-in modes ship: local password, Microsoft Entra (OAuth/OIDC), generic OIDC, and trusted headers (the reverse proxy provides the identity). The proxy sends everything under `/api/auth/` straight to `backend-api`, so the web tier is not in the sign-in path at all: the browser holds a session cookie, the backend resolves it on every request, and the backend decides what the session can do from the user's role and the per-resource permission matrix documented in [Members and roles](/platform/admin/members-and-roles). Sessions live in Postgres, which is why restarting a backend container never signs anyone out.

The [authentication reference](/self-hosted/configuration/authentication) covers the env vars and the per-mode trade-offs.

## When you outgrow single-host

The default compose file runs all eleven containers on one host. The first thing you can move off the box without re-architecting is the knowledge corpus — it is addressed by its own connection string, so pointing it at managed infrastructure (for capacity or for a residency requirement) is a `KNOWLEDGE_DATABASE_URL` change, covered in [Data residency](/self-hosted/configuration/data-residency). The blob store moves the same way, by repointing the deployment's object-storage connection at a bucket you own.

The backend tier scales out rather than up. `backend-api` and `backend-worker` both take `--scale`: every api container polls the hint outbox and fans updates out to its own clients, so there is no cross-container coordination and no sticky sessions to arrange, and every worker competes for the same pg-boss queue. What stays single is Postgres — one primary, and the blob store beside it.

## Where this fits

This architecture page is the map every other self-hosted page assumes. The natural next read is [Quickstart](/self-hosted/install/quickstart) if you are setting up a fresh instance, or [Container architecture](/self-hosted/operate/container-architecture) if you are operating one and need the same picture with the failure modes overlaid.
