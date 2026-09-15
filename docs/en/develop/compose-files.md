---
title: Contributor Compose files
description: Choose a source-development workflow and understand how the repository’s Compose overlays fit together.
---
Use the repository’s Compose files to develop or test Tale from source. For the usual local workflow, [run the app and backend natively with Docker dependencies](/develop/contributor-setup). Use the container workflow below when your change needs to exercise the development images.

Packaged self-hosted installations use the CLI-generated stack described in [Quickstart](/self-hosted/install/quickstart). The source-tree overlays have development ports and mounts; review them before exposing a host publicly.

Choose one workflow for the change you are testing. Starting native development and the container frontend on the same port produces a conflict, not a second isolated instance.

## Start the container development workflow

Run from the repository root with the pinned Bun version and Docker Compose available:

```bash
bun install
bun run docker:dev
bun run docker:dev:logs
```

The `docker:dev` wrapper prepares the sandbox runtime image and network, generates an environment overlay, and starts the base, development and docs files together. Prefer that entry point to copying only its final Compose command: the preparation is part of the workflow. The generated environment overlay forwards most host variables into the platform container, so review the environment you run it from.

Stop the live log stream with `Ctrl-C`. Use `bun run docker:dev:down` to stop this stack. Keep data volumes and the existing environment when you want to resume with the same instance. A second worktree needs its own ports, container identities and storage to run independently.

## Choose an overlay

| File | Purpose |
| --- | --- |
| `compose.yml` | Source-build base services and their dependencies. |
| `compose.dev.yml` | Source mounts and development commands. |
| `compose.docs.yml` | The documentation site and proxy routing. |
| `compose.web.yml` | The marketing site and proxy routing. |
| `compose.test.yml` | Platform container test configuration. |
| `compose.docs.test.yml` | Documentation container test configuration. |
| `compose.web.test.yml` | Marketing-site container test configuration. |
| `compose.test.mock.yml` | Mock-backed integration configuration. |

Read the script that invokes a test overlay before running it directly; the test harness may prepare images, ports and fixtures. [Docker contributions](/develop/contributing-docker) covers the relevant checks.

## Inspect what Compose will merge

Files apply from left to right. Later files override or extend earlier configuration according to Compose’s merge rules. Inspect service names without printing the resolved environment and its secrets:

```bash
docker compose -f compose.yml -f compose.dev.yml -f compose.docs.yml config --services
```

This inspects the static files. The `docker:dev` command also supplies its generated environment overlay. A complete `docker compose config` can print interpolated credentials; keep that output out of public logs and bug reports.

## Understand the main services

The source stack separates `backend-api` from `backend-worker`. The API handles application requests and authentication; the worker runs jobs, model turns and knowledge processing. `platform` serves the web app. `proxy` routes traffic, while `db`, `knowledge-db` and `object-store` hold application, knowledge and blob data.

`sandbox`, `sandbox-egress` and `sandbox-llm-gateway` provide isolated execution and its network/model paths. The source stack also includes the video-ingestion sidecar. Production topology can differ: the generated single-host stack combines the application and knowledge databases. Use [Container architecture](/self-hosted/operate/container-architecture) for service responsibilities and [Environment reference](/self-hosted/configuration/environment-reference) for their configuration.

## Diagnose the first failure

If preparation fails, read the wrapper’s first error before retrying Compose. Check Docker availability and image builds for an image error; network creation for an absent sandbox network; occupied ports or existing containers for a second-checkout conflict. Inspect `docker compose ps` and the failing service’s logs before changing configuration. Avoid removing volumes to solve a startup error: that discards the state needed to reproduce it.
