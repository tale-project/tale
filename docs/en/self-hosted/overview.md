---
title: Self-hosted architecture
description: Eight containers, one compose file, one Postgres database. This page hands you the mental model for what each container does, where data lives on disk, and which secrets matter at first boot.
---

A Tale instance is eight containers behind a Caddy proxy, talking to one Postgres database; two of them are sandbox containers off to the side for code execution. The compose file is the contract — what runs, what is exposed, what is mounted. This page hands you the mental model so the install, configure, and operate pages do not have to re-explain it.

Read this before you `docker compose up`. Come back when you are debugging an outage and need to know which container's logs to open first.

## The eight containers

**tale-proxy** is Caddy at the edge. It terminates TLS, routes everything under `/` to the platform container, and forwards everything under `/api/` and the Convex paths to the convex container. Healthchecks live here.

**tale-platform** is the React + TanStack Start server. It renders the UI, serves static assets, and is the only container exposed to the browser. It does not hold business state — everything that needs to persist talks to convex.

**tale-convex** is the backend: the actions, queries, mutations, and the WebSocket layer the UI subscribes to. Provider keys, agent definitions, automation runs, audit logs — all of it lives here, written to Postgres.

**tale-db** is Postgres. It holds the Convex data and is the only stateful container that matters for backups.

**tale-rag** is the retrieval service: it extracts text from uploaded documents, chunks them, embeds the chunks, and serves the vector index back to the agent runtime.

**tale-crawler** is the website-knowledge crawler: it fetches and indexes the URLs declared as Website entities.

**tale-sandbox** and **tale-sandbox-egress** run sandboxed code on behalf of the `Run code` tool and skill scripts. The egress container is the only path the sandbox has to the network. Egress is open by default — sandboxed code reaches any public host over HTTPS while cloud-metadata and private-range targets stay blocked at the IP layer; lock it down to a hostname allowlist with `SANDBOX_EGRESS_ALLOWLIST`, described in [Hardening](/self-hosted/operate/security/hardening).

## Data on disk

Three volumes survive a `docker compose down`:

- `db-data` — Postgres data directory: the database behind agents, runs, and the audit log.
- `backups` — checksummed volume snapshots written by `tale backup` and automatically before migrating deploys; [Backups and restore](/self-hosted/operate/backups-and-restore) is the drill.
- The platform's object-store mount — uploaded files, generated images, exported bundles.

Everything else is ephemeral. Containers can be replaced without data loss as long as the volumes survive.

## Provider secrets and the SOPS layer

Provider keys (OpenAI, Anthropic, Azure, Ollama, etc.) live on disk in a `providers/` directory mounted into the platform container. Each provider has a `<name>.json` and a `<name>.secrets.json`; the secrets file is encrypted with SOPS and the [`SOPS_AGE_KEY`](/self-hosted/configuration/environment-reference) variable.

This split exists for two reasons. Rotating a provider key is editing one file, not re-running the platform; backing up the encrypted file is safe to commit alongside infrastructure. The plaintext mode (no SOPS, secrets in cleartext) is supported for tightly controlled environments where the disk itself is encrypted at rest.

## Auth and sessions

Sign-in is Better Auth running inside the convex container. Four sign-in modes ship: local password, Microsoft Entra (OAuth/OIDC), generic OIDC, and trusted headers (the reverse proxy provides the identity). The platform container reads the cookie, hands it to convex, and convex decides what the session can do based on the user's role and the per-resource permission matrix documented in [Members and roles](/platform/admin/members-and-roles).

The [authentication reference](/self-hosted/configuration/authentication) covers the env vars and the per-mode trade-offs.

## When you outgrow single-host

The default compose file runs all eight containers on one host. The architecture is single-tenant: nothing in the design splits work across hosts. When you outgrow this — typically because tale-rag or tale-crawler need their own resources, or you want a hot standby — the move is to extract those containers into a second host and point the platform at them through the env vars. The Convex layer is still single-instance; horizontal scaling of the backend is not a v1 feature.

## Where this fits

This architecture page is the map every other self-hosted page assumes. The natural next read is [Quickstart](/self-hosted/install/quickstart) if you are setting up a fresh instance, or [Container architecture](/self-hosted/operate/container-architecture) if you are operating one and need the same picture with the failure modes overlaid.
