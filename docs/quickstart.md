---
title: Quick start
description: Get Tale running locally in under 5 minutes.
---

This guide walks you through getting Tale running locally for the first time using the Tale CLI.

## Prerequisites

| Software | Minimum version | Where to get it |
| --- | --- | --- |
| Docker Desktop | 24.0+ | https://www.docker.com/products/docker-desktop |

### Get an API key

Tale uses OpenRouter as its default AI gateway, which gives you access to hundreds of models through a single API key.

1. Go to https://openrouter.ai and create a free account.
2. Navigate to Keys in your account dashboard and generate a new API key.
3. Copy the key. You will need it during setup.

> **Tip:** You can use any OpenAI-compatible provider, including a local Ollama instance. OpenRouter is the recommended default for its model variety and simple pricing.

## Setup

### Step 1: Install the CLI

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Or download the binary directly from [GitHub Releases](https://github.com/tale-project/tale/releases):

```bash
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

> **Tip:** The CLI also generates configuration files for AI-powered editors (Claude Code, Cursor, GitHub Copilot, Windsurf) and extracts the full platform source code to `.tale/reference/`. Open your project in any of these editors to create and edit agents, workflows, and integrations by describing what you want in natural language. See [AI-assisted development](/ai-assisted-development) for details.

### Step 3: Start Tale

```bash
tale start
```

Wait for the ready message:

```text
🎉 Tale Platform is running!
```

> **Note:** You will see a stream of health check messages while services are starting. Those are normal. Wait for the ready message before opening your browser.

### Step 4: Open the app

Go to https://localhost (or your configured domain) in your browser. The first time you open it, you will be taken to a sign-up page to create your admin account.

## Daily workflow

### Starting and stopping

```bash
tale start              # Start all services
tale start --detach     # Start in background
```

To stop all services while keeping your data:

```bash
docker compose down
```

> **Important:** Never run `docker compose down -v`. The `-v` flag deletes all Docker volumes, which permanently erases your database, uploaded documents, crawler state, and all platform data. There is no recovery from this.

### Updating

```bash
tale update             # Update project files to match CLI version
```

### Viewing backend data

```bash
tale convex admin       # Generate admin key for the Convex Dashboard
```

Open `/convex-dashboard` in your browser and paste the key to inspect the database, view function logs, and manage background jobs.

## Alternative: build from source

If you want to contribute to Tale or customize the platform code, you can run from source instead of using pre-built images.

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Edit `.env` and fill in the required values:

| Variable | How to fill it in |
| --- | --- |
| `OPENAI_API_KEY` | Your OpenRouter (or other provider) API key |
| `BETTER_AUTH_SECRET` | Generate with: `openssl rand -base64 32` |
| `ENCRYPTION_SECRET_HEX` | Generate with: `openssl rand -hex 32` |
| `DB_PASSWORD` | Choose any password for the local database |

> **Important:** The `.env.example` file ships with example secrets that must be replaced before starting.

Then build and start:

```bash
docker compose up --build
```

The first build takes 3 to 5 minutes. Subsequent starts are much faster.
