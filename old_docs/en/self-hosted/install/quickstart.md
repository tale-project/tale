---
title: Local quickstart
description: Run Tale locally with Docker Desktop in about ten minutes — for evaluation, demos, and contributing.
---

The local quickstart is the fastest way to put a running Tale instance on your laptop. The `tale` CLI handles the install — one command to scaffold the project, one command to start the stack, then a browser at `https://localhost`. Use it to evaluate the product, run a demo for a team, or hack on the source. For a public instance with real TLS and zero-downtime upgrades, follow [Production deployment](/self-hosted/install/linux-server) instead.

This walk-through assumes a developer laptop with Docker Desktop installed. Everything below uses the same CLI that runs in production — the only differences are the TLS mode (self-signed by default) and that all ports are exposed locally for development convenience.

## Before you begin

- **Docker Desktop 24.0 or newer** — installed and running. The Linux, macOS, and Windows builds all work.
- **An OpenRouter API key** — free to create at [openrouter.ai](https://openrouter.ai). OpenRouter gives you access to hundreds of models through one key. Any OpenAI-compatible endpoint works, including a local Ollama server; OpenRouter is the recommended default because it covers the most ground.

Pull the key from the **Keys** section of the OpenRouter dashboard once you have an account, then keep it handy — `tale init` will prompt for it during setup.

## Step 1 — Install the CLI

The `tale` CLI is one binary that runs the full lifecycle: init, start, upgrade, deploy, logs, rollback. The installer script writes to `/usr/local/bin/tale` on Linux and macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

On Windows, use PowerShell:

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Both installers honour a `VERSION` environment variable for pinning a specific release:

```bash
VERSION=0.9.0 curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

```powershell
$env:VERSION = '0.9.0'
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Available tags are on the [GitHub Releases](https://github.com/tale-project/tale/releases) page. If you'd rather skip the installer, the binary is also available as a direct download from each release tag.

## Step 2 — Create a project

Pick a directory and run `tale init`:

```bash
tale init my-project
cd my-project
```

The CLI prompts for the domain (default `localhost`), the OpenRouter key, and the TLS mode (default `selfsigned`). It writes a `.env` file with auto-generated secrets — `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`, `INSTANCE_SECRET`, and a `SOPS_AGE_KEY` for the SOPS-encrypted provider secrets mode. The project directory is the source of truth for this instance: `.env` holds the secrets, `TALE_CONFIG_DIR` holds the provider, retention, and agent JSON files.

`tale init` also drops config files for AI editors (Claude Code, Cursor, GitHub Copilot, Windsurf) and extracts the platform source to `.tale/reference/`, so you can open the project in an AI-assisted editor and create agents, workflows, and integrations in natural language. The full pattern is on [AI-assisted development](/develop/ai-assisted-development).

## Step 3 — Start Tale

```bash
tale start
```

Health-check messages stream while services boot — that's expected. Wait for the `Tale Dev v0.x.x  Ready.` line before opening the browser; the platform container takes up to three minutes on a cold boot because the entrypoint waits for env sync to finish and `bunx convex deploy` to push the function set before signalling healthy.

To run in the background, pass `--detach`:

```bash
tale start --detach
```

## Step 4 — Open the app

Open `https://localhost` (or whatever domain you configured during `tale init`). The first visit takes you to a sign-up page — the first user to register becomes the Owner of the instance.

The self-signed certificate triggers a browser warning on the first visit. Click through (Chrome: **Advanced → Proceed**; Firefox: **Advanced → Accept the Risk**); the warning is expected for `TLS_MODE=selfsigned`. For a public-facing instance, pick `letsencrypt` during `tale init` or follow [Production deployment](/self-hosted/install/linux-server).

## Daily workflow

`tale start` and `docker compose down` are the start/stop pair you use most.

```bash
tale start                       # Start all services in the foreground
tale start --detach              # Start in the background
docker compose -p tale-dev down  # Stop containers, keep volumes (and data)
```

The `-p tale-dev` flag is required because `tale start` uses that compose project name rather than a default `docker-compose.yml`. **Never add `-v` to the `down` command** — it deletes every named volume, which means the database, every uploaded file, and the crawler state. There is no recovery.

### Upgrade

```bash
tale upgrade                       # Pull the latest release and sync project files
tale upgrade --version 0.9.0       # Migrate or downgrade to a specific version
tale start                         # Restart with the new version
```

Read the [release notes](https://github.com/tale-project/tale/releases) before upgrading; breaking changes and migration notes are called out explicitly per [Release notes format](/self-hosted/operate/release-notes/format).

### Inspect Convex data

The bundled Convex backend ships a dashboard for inspecting collections, function logs, and background jobs. Generate an admin key, then open the dashboard:

```bash
tale convex admin
```

Open `/convex-dashboard` in your browser and paste the key. The dashboard gives direct read and write access to everything in Convex, so keep the key local.

## Build from source

If you want to contribute or customise the platform, run from a checkout instead of pulling prebuilt images. Clone the repository, copy the example env, and replace the placeholder secrets:

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

The `.env.example` ships with placeholder secrets that must be replaced before the stack starts. Generate fresh values:

| Variable                | Generate with                       |
| ----------------------- | ----------------------------------- |
| `BETTER_AUTH_SECRET`    | `openssl rand -base64 32`           |
| `ENCRYPTION_SECRET_HEX` | `openssl rand -hex 32`              |
| `DB_PASSWORD`           | Any password for the local database |

Then build and start:

```bash
docker compose up --build
```

For a faster edit-reload cycle, layer in the development override that bind-mounts your local source into the containers:

```bash
docker compose -f compose.yml -f compose.dev.yml up --build
```

After modifying a `Dockerfile` or a dependency, run `bun run docker:test` to smoke-test the build. The [Contributing Docker guide](/develop/contributing-docker) covers the image validation and vulnerability scan scripts.

## Where this gets used

What you have now is a working Tale instance on `localhost` with sample agents, sample knowledge, and a configured AI provider. That's enough to evaluate the product, demo it to a team, or develop against the platform. It's not enough to expose to anyone outside your laptop — the quickstart uses self-signed TLS, runs every service on one container, and skips the blue-green topology that survives upgrades without a maintenance window.

When you're ready to put Tale in front of users, [Production deployment](/self-hosted/install/linux-server) walks the same install with a real domain, real TLS, and the blue-green roll. For the rest of the operator surface — observability, retention, advisories — [Operations](/self-hosted/operate/observability/operations) is the index.
