---
title: Contributor setup
description: The single source of truth for setting up Tale's source for local development — prerequisites, bun install, the pre-flight check, what bun run dev does, port conflicts, and the pre-PR checklist.
---

This page is for contributors who want to run Tale from source and ship a change back. It covers the prerequisites, the one-time setup, the pre-flight check that catches a broken machine before a long boot, and what to expect from `bun run dev`. It is not the operator path — if you want to run Tale to use it, not change it, the [self-hosted quickstart](/self-hosted/install/quickstart) installs the packaged stack with the CLI instead.

The source is one Bun workspace, end to end — the whole stack is TypeScript, with no Python and no second package manager to install. A single `bun install` wires up every service, and `bun run dev` brings up the backing containers, the platform backend, and Vite with generated dev secrets — no cloud account, no hand-edited `.env`. Knowledge work that used to live in standalone services (RAG search, document ingestion, web crawling, document generation) runs inside the backend, so there is nothing extra to start for it.

## A working setup, start to finish

The shortest path from a fresh clone to a running app is three commands. The pre-flight check between install and dev is the one that saves you a confusing failure ten layers deep:

```bash
bun install            # wire up every workspace
bun run setup:check    # validate Bun and the dev ports
bun run dev            # boot the stack (watch for the READY banner)
```

If `setup:check` prints all green and `bun run dev` reaches its `READY` banner, your environment is sound. The rest of this page explains each piece and what to do when one of them complains.

## Prerequisites

Two things have to be on your machine, because the whole stack is TypeScript on a single runtime plus a real database:

- **Bun 1.3 or higher** — the workspace runtime and package manager. Install it from [bun.sh](https://bun.sh/docs/installation), then confirm with `bun --version`. Every service dependency is resolved by `bun install`.
- **Docker** — `bun run dev` runs the backend on your host but its backing services in containers: Postgres (the app database), ParadeDB (the knowledge corpus), the LLM gateway, and the sandbox tier. Docker Desktop or any daemon your shell's Docker context points at will do.

## Install and pre-flight

A single install covers every workspace, because the repo is one Bun workspace graph:

```bash
bun install
```

Before the first `bun run dev`, run the pre-flight check. It validates your Bun version and that ports 3000 and 3005 are free — and prints the exact fix for anything missing, so you do not discover a wrong Bun version halfway through a cold boot:

```bash
bun run setup:check
```

Each failing line carries its remediation: a `bun upgrade` for an old Bun, an `lsof`/`kill` pair for a busy port. A clean run exits zero and tells you to go ahead with `bun run dev`.

## What `bun run dev` does

`bun run dev` is the development orchestrator. It loads your `.env` files, generates insecure local defaults for any secret you have not set, brings up the docker backing services, then spawns the **platform backend** — the same `backend/main.ts` entry the container runs, in the combined `all` role (HTTP API and job worker in one process) — and waits for it to bind. Vite starts last and proxies `/api`, `/events`, `/dav`, and `/scim` to it. A cold start takes 20 to 60 seconds; a warm one is far quicker.

The backend applies its own database migrations at startup, under an advisory lock, so a fresh clone gets a fully migrated database with no extra step. A health probe supervises it: if it stops answering, the orchestrator restarts it up to a cap and tells you when it gives up.

Until the orchestrator prints its `READY` banner, the app refusing connections on `http://localhost:3000` is expected, not a failure — Vite has not bound the port yet. When you see the banner, the app is reachable and auth is healthy. Stop the whole stack with `Ctrl-C`; it shuts down the backend and Vite cleanly.

The dev orchestrator generates everything it needs, so a local `.env.example` copy is optional for local development — the insecure defaults (`INSTANCE_SECRET`, `BETTER_AUTH_SECRET`, the WebDAV HMAC key) are filled in at boot and printed as warnings. Set real values in `services/platform/.env.local` only when you need production-shaped behaviour or want to override a default.

Already have the containers running, or want to iterate on frontend code alone? `TALE_DEV_SKIP_DOCKER=1 bun run dev` skips the docker bring-up and goes straight to the backend and Vite.

## A ready-to-use dev login

A fresh stack seeds an owner account so you do not have to walk the `/setup` wizard before testing: `dev@tale.test` / `TaleDev!Passw0rd`, owning a scaffolded "Dev Workspace" organization. The seeder is idempotent (it runs on every boot and does nothing when the account already exists) and refuses to run unless `SITE_URL` is a loopback host — a known password on a reachable hostname would be an account takeover, not a convenience. Opt out with `TALE_DEV_SEED_USER=0`, or override the identity with `TALE_DEV_SEED_USER_EMAIL` / `TALE_DEV_SEED_USER_PASSWORD`.

## When a port is busy

`bun run dev` binds two ports: 3000 for the Vite app and 3005 for the backend. It fails fast with an actionable message when either is taken, because a silent fallback to another port would break the Vite proxy and every `localhost:3000` link. The usual culprit is a previous `bun run dev` or `tale dev` that did not fully exit.

Free the port and re-run. The command that finds and stops the holder is the same one `setup:check` and the orchestrator suggest:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # show the PID holding the app port
kill <PID>                         # stop it
```

## Resetting local dev data

Local dev state lives in the docker volumes of the backing services, so a reset is a compose command rather than a bespoke script:

```bash
docker compose -f compose.yml -f compose.dev.yml down -v db knowledge-db
```

This destroys the local databases — every organization, conversation, and uploaded file in your dev stack. Org config trees on disk (`$TALE_CONFIG_DIR`) and `.env.local` are untouched. The next `bun run dev` re-migrates from empty and re-seeds the dev login.

## Hybrid mode against a containerised backend

`bun run dev` runs the backend on your host, which is the right thing for most work. To point Vite at a backend running somewhere else — a container, or a colleague's stack — set `TALE_BACKEND_URL`:

```bash
TALE_BACKEND_URL=http://localhost:3105 TALE_DEV_SKIP_DOCKER=1 bun run dev
```

Vite proxies every backend lane there, and the orchestrator waits on that URL instead of spawning its own child.

## Before you open a PR

Every PR runs through one gate: `bun run check`, which is format, lint, typecheck, and the full test suite across every touched workspace. A green run is the merge signal; a red one blocks. The pre-PR checklist in [`AGENTS.md`](https://github.com/tale-project/tale/blob/main/AGENTS.md) lists the rest — docs and translations ship in the same PR as the code that changed them.

If your change touches `services/docs/`, also run the docs gate (`bun run --filter @tale/docs test`) so structural parity, terminology, and prose checks pass before review. Anything a user can see, configure, or call needs its docs updated in all three base locales in the same commit.

## Where this fits

Contributor setup is the floor every other developer task stands on: get the prerequisites in place, let `setup:check` confirm the machine, and `bun run dev` gives you the whole platform in under two minutes once the images are warm. The pre-flight check and the port remediation exist because the most common first-run failures are a wrong tool version or a leftover process holding a port — both are five-second fixes once you can see them.

Once the stack runs, the [Develop overview](/develop/overview) frames the external surface you build against, and [AI-assisted development](/develop/ai-assisted-development) covers using Tale's own agents to author Tale configs. If you are contributing a container change rather than a source change, [Contributing](/self-hosted/contributing-docker) under the Self-hosted tab is the build-and-test walk for that path.
