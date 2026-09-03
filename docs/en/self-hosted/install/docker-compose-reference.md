---
title: Docker Compose reference
description: Which compose file ships with Tale, what each is for, and how the layering works when you bring up dev, docs, or test combinations.
---

Tale ships a handful of Docker Compose files. The base is `compose.yml`; the rest are overlays that add or replace services for specific scenarios — development, docs, test. This page names each file, says when to pick it, and gives the layering rule everything else follows.

The shape is conservative on purpose. The base file is a build-from-source stack for local development and smoke-testing — **not** production; every overlay is opt-in via `-f` and adds only what it needs to. A production instance is generated and rolled by the [`tale` CLI](/self-hosted/install/cli-install) (`tale deploy`), which writes its own secure compose inline — only `80`/`443` exposed — and never uses these files. Memorise the base and a single overlay, not the whole grid.

## A worked compose-up

The base file builds every image from source and runs that frozen build. It exposes ports that must never be public (`5432`, `8003`) and boots with insecure dev secret defaults, so it is for local smoke-testing, not a public instance:

```bash
docker compose up -d
```

A developer hacking on platform and docs at the same time layers two overlays for live source and hot-reload:

```bash
docker compose -f compose.yml -f compose.dev.yml -f compose.docs.yml up -d
```

The leftmost file is the base; each subsequent file merges its keys on top. Conflicts (same service, same key) resolve last-file-wins. The merged graph is what Docker brings up.

## The compose files

| File                    | Use case                                       | Notable overrides                                                  |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `compose.yml`           | Local-dev base (build from source)             | The base — every service, healthchecks, restart policy             |
| `compose.dev.yml`       | Local development with hot-reload              | Bind-mounts host source for hot-reload; ships insecure dev secrets |
| `compose.docs.yml`      | Adds the docs site service                     | Brings up `tale-docs` and routes `/docs` through the proxy         |
| `compose.web.yml`       | Adds the marketing site service                | Brings up `tale-web` and routes `/` (root) through the proxy       |
| `compose.test.yml`      | Runs the platform test suite against the stack | Replaces the platform image with the test-shaped variant           |
| `compose.web.test.yml`  | Runs web tests                                 | Like `web.yml` but the test-shaped variant                         |
| `compose.docs.test.yml` | Runs docs tests                                | Like `docs.yml` but the test-shaped variant                        |
| `compose.test.mock.yml` | Mock-backed integration tests                  | Swaps providers for mock implementations                           |

## Services and their roles

The base graph brings up eleven containers:

- `tale-proxy` — Caddy. TLS, reverse proxy, 301s.
- `tale-platform` — the web tier: a Vite + TanStack Router SPA plus the Bun server that serves it, branding, and the config SSE watch.
- `tale-backend-api` — the application backend in the `api` role (`TALE_ROLE=api`). Every application door: the app API, auth, the SSE hint stream, and the machine doors.
- `tale-backend-worker` — the same image in the `worker` role. The job runner behind schedules and agent turns, and the in-process document ingestion, web crawling, RAG indexing, and document generation that used to be separate services.
- `tale-db` — operational Postgres (ParadeDB). The `tale_app` application store, on port 5432.
- `tale-knowledge-db` — knowledge corpus Postgres (ParadeDB). The `tale_knowledge` database holding document chunks, embeddings, and crawled pages, on port 5433 so it never clashes with `tale-db` on 5432. (A `tale deploy` production stack folds this into `tale-db` instead — see [Architecture overview](/self-hosted/overview).)
- `tale-object-store` — MinIO, the S3-compatible blob backend for uploads, attachments, and generated media (internal-only).
- `tale-sandbox-llm-gateway` — the LLM gateway for harness turns.
- `tale-sandbox-egress` and `tale-sandbox` — the sandbox plane. Run-code containers behind an egress proxy (open by default; lock down with `SANDBOX_EGRESS_ALLOWLIST`), also the headless-browser runtime the backend calls for web rendering and document generation.
- `tale-bgutil-provider` — a third-party sidecar supplying YouTube PO-tokens for video-link ingestion.

There is no separate Python service in the graph — the knowledge work (RAG, crawling, document generation) runs inside the backend worker now. [Container architecture](/self-hosted/operate/container-architecture) goes deeper on what owns what.

## Overriding

Operator customisations belong in an extra overlay, not in edits to the shipped files. Create `compose.local.yml` with the overrides you need:

```yaml
services:
  platform:
    environment:
      - LOG_LEVEL=debug
```

Bring the stack up with the local overlay layered last:

```bash
docker compose -f compose.yml -f compose.local.yml up -d
```

This pattern keeps `git pull` clean — no merge conflicts on the shipped files. The same pattern works for any custom volume mount, custom port, or environment override.

## Where this fits

The compose reference is the operator's grid for the source tree. For the inside of each container, the [container architecture](/self-hosted/operate/container-architecture) page covers responsibilities; for the variables the containers read at boot, the [environment reference](/self-hosted/configuration/environment-reference) is the source of truth.
