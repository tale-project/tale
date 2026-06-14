---
title: Docker Compose reference
description: Which compose file ships with Tale, what each is for, and how the layering works when you bring up dev, docs, or test combinations.
---

Tale ships a handful of Docker Compose files. The base is `compose.yml`; the rest are overlays that add or replace services for specific scenarios — development, docs, test. This page names each file, says when to pick it, and gives the layering rule everything else follows.

The shape is conservative on purpose. The base file alone runs production; every overlay is opt-in via `-f` and adds only what it needs to. Memorise the base and a single overlay, not the whole grid.

## A worked compose-up

A production single-host instance runs from the base alone:

```bash
docker compose up -d
```

A developer hacking on platform and docs at the same time layers two overlays:

```bash
docker compose -f compose.yml -f compose.dev.yml -f compose.docs.yml up -d
```

The leftmost file is the base; each subsequent file merges its keys on top. Conflicts (same service, same key) resolve last-file-wins. The merged graph is what Docker brings up.

## The compose files

| File                           | Use case                                       | Notable overrides                                                     |
| ------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------- |
| `compose.yml`                  | Production single-host                         | The base — every service, healthchecks, restart policy                |
| `compose.dev.yml`              | Local development with hot-reload              | Mounts source into containers, swaps to dev images, exposes dev ports |
| `compose.docs.yml`             | Adds the docs site service                     | Brings up `tale-docs` and routes `/docs` through the proxy            |
| `compose.web.yml`              | Adds the marketing site service                | Brings up `tale-web` and routes `/` (root) through the proxy          |
| `compose.test.yml`             | Runs the platform test suite against the stack | Replaces the platform image with the test-shaped variant              |
| `compose.web.test.yml`         | Runs web tests                                 | Like `web.yml` but the test-shaped variant                            |
| `compose.docs.test.yml`        | Runs docs tests                                | Like `docs.yml` but the test-shaped variant                           |
| `docker-compose.test-mock.yml` | Mock-backed integration tests                  | Swaps providers for mock implementations                              |

## Services and their roles

The base graph brings up eight containers:

- `tale-proxy` — Caddy. TLS, reverse proxy, 301s.
- `tale-platform` — the TanStack Start app. The user-facing UI and API.
- `tale-convex` — the Convex backend. WebSocket, queries, mutations, actions.
- `tale-db` — Postgres. The persistent store.
- `tale-rag` — Python FastAPI. Embeddings, retrieval.
- `tale-crawler` — the crawler service. Website knowledge sources.
- `tale-sandbox-egress` and `tale-sandbox` — the sandbox plane. Run-code containers behind an egress proxy (open by default; lock down with `SANDBOX_EGRESS_ALLOWLIST`).

[Container architecture](/self-hosted/operate/container-architecture) goes deeper on what owns what.

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

## Profiles

A handful of services in the base file use Docker Compose profiles. Profiles let a service exist in the graph but not start unless its profile is activated. The two profiles in use are `gpu` (for hosts with GPU-backed local inference) and `monitoring` (for the optional Prometheus and Grafana). Activate with:

```bash
docker compose --profile monitoring up -d
```

## Where this fits

The compose reference is the operator's grid for the source tree. For the inside of each container, the [container architecture](/self-hosted/operate/container-architecture) page covers responsibilities; for the variables the containers read at boot, the [environment reference](/self-hosted/configuration/environment-reference) is the source of truth.
