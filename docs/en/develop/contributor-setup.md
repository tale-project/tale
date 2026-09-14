---
title: Run Tale from source
description: Prepare a local contributor environment, start the backend and app, and verify your change.
---
Run Tale from source when you want to change the product or test a contribution. You will run the web app and backend on your machine, with databases and sandbox services in Docker. For a packaged installation, follow the [self-hosted quickstart](/self-hosted/install/quickstart).

## Prepare your machine

Use a local checkout of the [Tale repository](https://github.com/tale-project/tale). Run the commands below from its root.

| Requirement | What it runs | Check |
| --- | --- | --- |
| Bun version pinned in the root `package.json` | Workspaces, dependency installation, Vite and development scripts | `bun --version` |
| Node.js 22.21.1 or newer in the 22.x line | The application backend; the container pins 22.21.1 | `node --version` |
| Docker with Compose | Application and knowledge databases, object storage and sandbox services | `docker info` and `docker compose version` |
| Free local ports | App on 3000 and backend on 3005 | `bun run setup:check` |

The repository pins its package-manager version. Match that version when reproducing a failure or contributing a lockfile change; the startup pre-flight checks only a minimum version.

The pre-flight command checks Bun and the two ports. Check Node and Docker separately; a green pre-flight result does not verify them. The first boot also needs network access to fetch dependencies and container images. A model provider is needed for real AI replies, but not for signing in and inspecting the app.

## Install and start

Install the workspace dependencies, check the local ports, then start the development stack:

```bash
bun install
bun run setup:check
bun run dev
```

The root development script creates missing secrets in the gitignored root `.env` and keeps existing values. Keep that file private and retain it between restarts: the backend and sandbox must share the same secrets.

The orchestrator starts Docker dependencies, starts the Node backend, waits for its API and authentication routes, then starts Vite. The backend applies database migrations during startup. Wait for the `READY` banner before opening `http://localhost:3000`; image downloads and first-time provisioning can make a cold boot slower.

<Check>

Open the app and sign in. Loading the dashboard verifies the browser-to-backend path; send a message with a configured provider to check an actual model turn.

</Check>

Stop the foreground processes with `Ctrl-C`. Docker data volumes persist; stopping development does not erase the instance.

## Sign in to the local workspace

The local development seeder creates `dev@tale.test` with password `TaleDev!Passw0rd` and a **Dev Workspace** organization. It leaves an existing account unchanged. The seed is restricted to loopback `SITE_URL` values.

Set `TALE_DEV_SEED_USER=0` to test first-time setup instead. To use a different local identity, supply `TALE_DEV_SEED_USER_EMAIL` and `TALE_DEV_SEED_USER_PASSWORD` through the environment. Changing these values does not reset an existing account’s password.

## Choose what to run

For normal product work, keep `bun run dev`. It starts the backend and app together and supplies the shared configuration they need.

If the backing services already run with the correct ports and credentials, skip only their Docker startup:

```bash
TALE_DEV_SKIP_DOCKER=1 bun run dev
```

This still starts a local backend. It does not make the app independent of Postgres, object storage or the sandbox. Use [Contributor compose files](/develop/compose-files) when your change needs the full container build.

For frontend-only work against an existing backend, run Vite directly from `services/platform` and point it at that backend:

```bash
cd services/platform
TALE_BACKEND_URL=http://localhost:3005 bunx --bun vite --host 127.0.0.1 --port 3000
```

This command does not start services, seed accounts or run migrations. The backend must already be configured for the browser origin you use.

## Resolve startup failures

| Symptom | Check next |
| --- | --- |
| `node` is missing or a Node flag is unknown | Install the Node version above and confirm that your shell resolves it. |
| Docker cannot connect | Start Docker and check `docker info` in the same shell. |
| Port 3000 or 3005 is busy | Identify the process before stopping it; it may belong to another checkout. |
| Backend fails before Vite starts | Read the first backend error and check database connectivity and credentials. |
| Sign-in works but model calls fail | Check the provider credential, selected model and sandbox services. |
| Changes appear in the wrong app | Check the URL and which checkout owns the listening process. |

On macOS or Linux, inspect the listener with:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3005 -sTCP:LISTEN
```

Stop a known development process from its original terminal. Do not kill a process solely because it holds a port.

## Keep or reset local data deliberately

Databases and uploaded files persist outside the source checkout. A second Git worktree does not automatically isolate Docker service names, ports, volumes or `.env` credentials. Before running two instances, give each its own backing services and configuration.

A reset destroys development data and can affect another checkout using the same Compose project. Inspect the project's containers and volumes, back up anything you need, and stop the stack before removing state. Configuration trees under `TALE_CONFIG_DIR` have their own lifecycle; deleting a database does not reset those files.

## Verify a contribution

Read the repository's `AGENTS.md` and `.agents/repo.md` before changing code. Run the relevant checks while working, then the shared gate from the repository root:

```bash
bun run check
```

The gate includes formatting, lint, types and automated tests. Its Python formatting step also uses `uvx`; install that tooling before running the full gate. Browser behavior still needs a browser check, and database changes need the real-Postgres integration check required by the repository contract.

Update affected docs and every shipped locale with your change. For container work, continue with [Build Docker images](/develop/contributing-docker); for external integrations, start with [Call Tale from a script](/tutorials/developer/call-tale-from-a-script).
