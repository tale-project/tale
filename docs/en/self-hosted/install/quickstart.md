---
title: Local quickstart
description: Run Tale locally with Docker Desktop in about ten minutes — for evaluation, demos, and contributing.
---

This is the fastest way to get a local Tale instance running on your laptop. Use this quickstart to evaluate the product, run a demo, or develop against the platform. For a public-facing instance with TLS and zero-downtime upgrades, follow the [production deployment](/self-hosted/install/linux-server) guide instead.

## Prerequisites

| Software       | Minimum version | Where to get it                                |
| -------------- | --------------- | ---------------------------------------------- |
| Docker Desktop | 24.0+           | https://www.docker.com/products/docker-desktop |

### Get an API key

Tale uses OpenRouter as its default AI gateway, which gives you access to hundreds of models through a single API key.

Create a free account at https://openrouter.ai, generate a new API key from the **Keys** section of your account dashboard, and copy it so you can paste it during setup.

> **Tip:** Any OpenAI-compatible provider works, including a local Ollama instance. OpenRouter is the recommended default for its model variety and simple pricing.

## Setup

### Step 1: Install the CLI

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

> **Pin a specific version:** Both installers honor a `VERSION` environment variable. Run `VERSION=0.9.0 curl -fsSL …/install-cli.sh | bash` on Linux/macOS, or `$env:VERSION = '0.9.0'; irm …/install-cli.ps1 | iex` on Windows. Available tags are on the [GitHub Releases](https://github.com/tale-project/tale/releases) page.

Or download the binary directly — replace `latest` with a tag (e.g. `v0.9.0`) to pin:

```bash
# Linux
curl -fsSL https://github.com/tale-project/tale/releases/latest/download/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

### Step 2: Create a project

```bash
tale init my-project
cd my-project
```

The CLI prompts for your domain, API key, and TLS mode. Security secrets (`BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`) are generated automatically.

> **Tip:** `tale init` also drops configuration files for AI-powered editors (Claude Code, Cursor, GitHub Copilot, Windsurf) and extracts the platform source to `.tale/reference/`. Open the project in any of these editors to create and edit agents, workflows, and integrations in natural language. See [AI-assisted development](/develop/ai-assisted-development).

### Step 3: Start Tale

```bash
tale start
```

Wait for `Tale Dev v0.x.x  Ready.` Health-check messages while services boot are normal — wait for the `Ready` line before opening your browser.

### Step 4: Open the app

Go to https://localhost (or your configured domain). The first visit takes you to a sign-up page to create your Admin account.

> **Self-signed certificate warning.** The default `selfsigned` TLS mode generates a local certificate, so your browser will show a "Your connection is not private" warning the first time. Click through (Chrome: **Advanced → Proceed**, Firefox: **Advanced → Accept the Risk**). For a public deployment, choose `letsencrypt` during `tale init` or follow the [production deployment](/self-hosted/install/linux-server) guide.

## Daily workflow

### Start and stop

```bash
tale start              # Start all services
tale start --detach     # Start in background
```

To stop while keeping your data:

```bash
# Stops containers but keeps volumes (your data).
# Never add -v: it deletes the database, uploads, crawler state — there is no recovery.
docker compose -p tale-dev down
```

The `-p tale-dev` flag is required because `tale start` uses that compose project name rather than a standard `docker-compose.yml`.

### Upgrade

```bash
tale upgrade                       # Update to the latest release and sync project files
tale upgrade --version 0.9.0       # Migrate or downgrade to a specific version
tale start                         # Restart with the new version
```

Breaking changes are called out in the [release notes](https://github.com/tale-project/tale/releases).

### Inspect backend data

```bash
tale convex admin       # Generate an admin key for the Convex Dashboard
```

Open `/convex-dashboard` in your browser and paste the key to inspect the database, view function logs, and manage background jobs.

## Alternative: build from source

If you want to contribute to Tale or customize the platform, run from source instead of pulling pre-built images.

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Edit `.env` and replace the example values:

| Variable                | How to fill it in                   |
| ----------------------- | ----------------------------------- |
| `BETTER_AUTH_SECRET`    | `openssl rand -base64 32`           |
| `ENCRYPTION_SECRET_HEX` | `openssl rand -hex 32`              |
| `DB_PASSWORD`           | Any password for the local database |

> **Important:** `.env.example` ships with placeholder secrets that must be replaced before starting.

Then build and start:

```bash
docker compose up --build
```

For a faster edit-reload cycle, use the development override which mounts your local source into the containers:

```bash
docker compose -f compose.yml -f compose.dev.yml up --build
```

After modifying Dockerfiles or dependencies, run `bun run docker:test` to smoke-test the build. See the [Contributing Docker guide](/develop/contributing-docker) for image validation and vulnerability scan scripts.

## Where this gets used

What you have now is a Tale instance reachable on `localhost`, with sample agents, sample knowledge, and a working AI provider. That's enough to evaluate the product, run a demo, or develop against the platform — but not enough to expose to the rest of your team, since the quickstart sets up self-signed TLS and runs everything on one container per service.

When you're ready to put Tale in front of users, [Production deployment](/self-hosted/install/linux-server) walks the same setup with a real domain, a real TLS certificate, and the blue-green deployment topology that survives upgrades without a maintenance window. For the rest of the operational surface — observability, backups, retention, advisories — the [Operations](/self-hosted/operate/observability/operations) section is the index.
