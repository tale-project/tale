---
title: Contributor setup
description: The single source of truth for setting up Tale's source for local development — prerequisites, bun install, the pre-flight check, what bun run dev does, port conflicts, and the pre-PR checklist.
---

This page is for contributors who want to run Tale from source and ship a change back. It covers the prerequisites, the one-time setup, the pre-flight check that catches a broken machine before a long boot, and what to expect from `bun run dev`. It is not the operator path — if you want to run Tale to use it, not change it, the [self-hosted quickstart](/self-hosted/install/quickstart) installs the packaged stack with the CLI instead.

The source is one Bun workspace, end to end — the whole stack is TypeScript, with no Python and no second package manager to install. A single `bun install` wires up every service, and `bun run dev` boots the platform with a local Convex backend, generated dev secrets, and Vite — no cloud account, no hand-edited `.env`. Knowledge work that used to live in standalone services (RAG search, document ingestion, web crawling, document generation) now runs inside the Convex backend, so there is nothing extra to start for it.

## A working setup, start to finish

The shortest path from a fresh clone to a running app is four commands. The pre-flight check between install and dev is the one that saves you a confusing failure ten layers deep:

```bash
bun install            # wire up every workspace
bun run setup:check    # validate Bun, the dev ports, and the Convex CLI
bun run dev            # boot Convex + Vite (watch for the READY banner)
```

If `setup:check` prints all green and `bun run dev` reaches its `READY` banner, your environment is sound. The rest of this page explains each piece and what to do when one of them complains.

## Prerequisites

Only one tool has to be on your `PATH` before anything else, because the whole stack is TypeScript on a single runtime:

- **Bun 1.3 or higher** — the workspace runtime and package manager. Install it from [bun.sh](https://bun.sh/docs/installation), then confirm with `bun --version`. Everything else the source needs (the Convex CLI, every service dependency) is resolved by `bun install`.

You do not need Docker for local development with `bun run dev` — it spawns Convex directly on your machine. Docker only enters the picture for the containerised hybrid mode below and for the operator install.

## Install and pre-flight

A single install covers every workspace, because the repo is one Bun workspace graph:

```bash
bun install
```

Before the first `bun run dev`, run the pre-flight check. It validates your Bun version, that ports 3000 and 3210 are free, and that the Convex CLI is reachable — and prints the exact fix for anything missing, so you do not discover a wrong Bun version halfway through a cold boot:

```bash
bun run setup:check
```

Each failing line carries its remediation: a `bun upgrade` for an old Bun, an `lsof`/`kill` pair for a busy port. A clean run exits zero and tells you to go ahead with `bun run dev`.

## What `bun run dev` does

`bun run dev` is the development orchestrator. It loads your `.env` files, generates insecure local defaults for any secret you have not set, spawns a local Convex backend in anonymous mode, syncs the environment into it, runs Convex codegen, waits for the auth routes to answer, then starts Vite. The platform is the slowest server to come up because it waits on Convex, so a cold start takes 30 to 90 seconds.

Until the orchestrator prints its `READY` banner, the app refusing connections on `http://localhost:3000` is expected, not a failure — Vite has not bound the port yet. When you see the banner, the app is reachable and auth is healthy. Stop the whole stack with `Ctrl-C`; it shuts down both Convex and Vite cleanly.

The dev orchestrator generates everything it needs, so a local `.env.example` copy is optional for local development — the insecure defaults (`INSTANCE_SECRET`, `BETTER_AUTH_SECRET`, the WebDAV HMAC key) are filled in at boot and printed as warnings. Set real values in `services/platform/.env.local` only when you need production-shaped behaviour or want to override a default.

## When a port is busy

`bun run dev` binds two ports: 3000 for the Vite app and 3210 for the local Convex backend. It fails fast with an actionable message when either is taken, because a silent fallback to another port would break the Convex proxy and every `localhost:3000` link. The usual culprit is a previous `bun run dev` or `tale dev` that did not fully exit.

Free the port and re-run. The command that finds and stops the holder is the same one `setup:check` and the orchestrator suggest:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # show the PID holding the app port
kill <PID>                         # stop it
```

To run the app on a different port instead, set `PORT`: `PORT=3005 bun run dev`. If the Convex deployment itself gets into a bad state after automatic maintenance — a stale schema after an aborted migration, a corrupt local SQLite file — see [Resetting local Convex dev data](#resetting-local-convex-dev-data) below; do not delete `.convex/local/` casually.

## Convex local storage maintenance

Every `convex dev` push stores a new function-bundle blob under `services/platform/.convex/local/default/convex_local_storage/modules/`. The Convex CLI never garbage-collects old blobs locally, so months of daily dev can accumulate tens of thousands of files (10+ GB) and make cold starts fail inside the CLI's 30-second backend-ready window.

`bun run dev` runs maintenance automatically before it spawns Convex:

- **Prune** when module storage exceeds 1,500 blobs or 2 GB — deletes only unreferenced historical function-bundle blobs under `convex_local_storage/modules/`, keeping every blob the current deployment still loads (module source packages and their node `externalPackageId` deps parents, plus up to 1,000 newest unreferenced leftovers). Your SQLite database, uploaded files, and org config are untouched. If the deployment's live references can't be read, or look empty while blobs remain on disk, prune is skipped rather than guessing.
- **Integrity gate** — if a live module blob is already missing on disk, `bun run dev` stops with a clear error pointing at `setup:clean`. Continuing would boot into a half-dead backend (chat and crons fail with opaque server errors).
- **Clear snapshot export artifacts** when the cached Convex backend binary no longer matches the one recorded in your local deployment — removes `export.zip` and related import/export debris that can trigger a failed re-import on cold start, without wiping dev data.

Set `TALE_DEV_SKIP_CONVEX_MAINTENANCE=1` to opt out of prune/snapshot cleanup (the integrity gate still runs). `bun run setup:check` warns (non-blocking) when module storage is already over the prune threshold.

## Resetting local Convex dev data

Last resort only — `bun run setup:clean` wipes **all** local Convex dev data: every table in the local SQLite file, every upload in `convex_local_storage/files/`, and every function bundle. Org config on disk and `.env.local` are untouched.

**Crossing the 0.4 baseline:** local dev data and per-org config trees created by pre-0.4 checkouts have no migration path — the 0.4 baseline reset emptied the migration history, and the export/import round trip below cannot bridge it either (the old export does not match the new schema). Moving a dev machine across the baseline means resetting local Convex data and recreating your dev orgs; treat pre-0.4 `$TALE_CONFIG_DIR` org directories the same way.

**Keep your data across the reset.** Even when the integrity gate fires (a live module bundle is missing), the backend itself still starts — so you can export your data first and restore it afterwards, and the reset then loses nothing:

```bash
# 1. Start the backend (this bypasses the `bun run dev` integrity gate), then
#    export in a second terminal:
bun run --filter @tale/platform convex:dev
cd services/platform && npx convex export --path convex-backup.zip

# 2. Reset (guarded — see below), bootstrap a fresh deployment, then restore:
bun run setup:clean            # type: delete local convex
bun run dev                    # wait for the READY banner
cd services/platform && npx convex import --replace-all convex-backup.zip
```

`bun run setup:clean` is guarded on purpose (coding agents must not run it unless you explicitly asked):

1. Run it yourself in a terminal — not through an agent.
2. When prompted, type the exact phrase `delete local convex` (a bare `y` is rejected).
3. Non-interactive runs (CI) require `TALE_CONFIRM_DESTROY_LOCAL_CONVEX=delete-local-convex` — never set that in agent shells.

Try automatic maintenance and a normal `bun run dev` first. If you must reset, **export first** (above) to keep your data — only skip the export when you truly don't need the local conversations, uploads, and other anonymous-deployment state.

## Hybrid mode against a containerised Convex

`bun run dev` spawns an ephemeral Convex backend by default, which is the right thing for most work. When you want fast Vite reloads against a stable Convex that mirrors production, run the dedicated `convex` container and point Vite at it instead:

```bash
docker compose up convex                 # one terminal: the stable backend
CONVEX_EXTERNAL=true bun run dev          # another: Vite against the container
```

Set `CONVEX_URL` if your container exposes Convex on a non-default host or port. This is the only local-dev path that needs Docker, and it is optional — the default ephemeral backend needs nothing beyond the three prerequisites.

## Before you open a PR

Every PR runs through one gate: `bun run check`, which is format, lint, typecheck, and the full test suite across every touched workspace. A green run is the merge signal; a red one blocks. The pre-PR checklist in [`AGENTS.md`](https://github.com/tale-project/tale/blob/main/AGENTS.md) lists the rest — docs and translations ship in the same PR as the code that changed them.

If your change touches `services/docs/`, also run the docs gate (`bun run --filter @tale/docs test`) so structural parity, terminology, and prose checks pass before review. Anything a user can see, configure, or call needs its docs updated in all three base locales in the same commit.

## Where this fits

Contributor setup is the floor every other developer task stands on: get the prerequisites in place, let `setup:check` confirm the machine, and `bun run dev` gives you the whole platform with a local backend in under two minutes once the images are warm. The pre-flight check and the port remediation exist because the most common first-run failures are a wrong tool version or a leftover process holding a port — both are five-second fixes once you can see them.

Once the stack runs, the [Develop overview](/develop/overview) frames the external surface you build against, and [AI-assisted development](/develop/ai-assisted-development) covers using Tale's own agents to author Tale configs. If you are contributing a container change rather than a source change, [Contributing](/self-hosted/contributing-docker) under the Self-hosted tab is the build-and-test walk for that path.
