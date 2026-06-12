---
title: Self-hosted quickstart
description: Get a working Tale instance running on your machine in three commands with the tale CLI — install, tale init, tale start, then sign in.
---

This is the fastest way to a running Tale: install the `tale` CLI, then two commands. The result is your own org running on your own machine, reachable in the browser. It is meant for a laptop or a single host you want to try Tale on; when you are ready to run it for real, the [Linux server](/self-hosted/install/linux-server) walk covers a hardened production install.

You need two things:

- **[Docker Desktop](https://www.docker.com/products/docker-desktop)** (v24+) running, or Docker Engine plus the Compose plugin on Linux.
- An **[OpenRouter API key](https://openrouter.ai)** so agents have a model to talk to. You can swap in any provider later.

## Step 1 — Install the CLI

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

On Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

The installer detects your OS, drops the `tale` binary on your `PATH`, and is the only step that touches your system. Confirm it landed:

```bash
tale --version
```

## Step 2 — Create a project

```bash
tale init my-project
cd my-project
```

`tale init` scaffolds a project directory and walks you through the essentials: it prompts for your OpenRouter API key, generates every security secret for you, and writes the `.env` so there is nothing to hand-edit. It also drops example agents, workflows, and integrations under `default/`, and generates editor config for Claude Code, Cursor, Copilot, and Windsurf so an AI editor can build configs with full schema awareness.

## Step 3 — Start Tale

```bash
tale start
```

The first run pulls the images and builds the container graph — expect five to ten minutes on a fresh machine. Once the platform reports ready (`Tale Platform is running`), `tale start` opens your browser automatically. If it cannot, it prints the URL to visit.

> Your browser shows a certificate warning for the local self-signed certificate. That is expected — accept it to continue.

Your config under `default/` is bind-mounted into the running instance, so edits to agents, workflows, and integrations reload live. Stop the stack with `Ctrl-C` (or `tale start --detach` to run it in the background).

## Step 4 — Create your account

On the sign-in screen, click **Sign up** and fill in your name, email, and a password. The first account on a brand-new instance claims the **Owner** role and creates your **Organization**. You land in the dashboard.

> If the sign-up screen asks for a one-time admin key, [First admin](/self-hosted/install/first-admin) is the short walk that prints it and explains how to close signup once your team is in.

## Step 5 — Add a model and publish an agent

You now have an empty org. Two moves get you to something useful:

1. Open **Settings > Providers** and confirm your OpenRouter key is connected (the CLI added it during `tale init`).
2. Publish your first agent — [Create an agent](/platform/agents/create) takes it from a role and some instructions to a working specialist.

From here the [Platform](/platform) docs are the canonical reference for every feature, and they are identical to Cloud.

## Prefer raw Docker Compose?

The CLI wraps `docker compose` so you do not have to. If you would rather run the stack from a clone of the repository and manage compose yourself — for transparency, air-gapped builds, or your own automation — clone the repo, copy `.env.example` to `.env`, set `HOST` and `SITE_URL`, generate the secrets, and `docker compose up -d`. The [Linux server](/self-hosted/install/linux-server) walk and the [Docker Compose reference](/self-hosted/install/docker-compose-reference) cover that path end to end.

## Troubleshooting

- **`tale` not found after install.** The installer names the destination directory in its output; make sure that directory is on your `PATH` (on Linux it is usually `/usr/local/bin`).
- **`tale start` exits with a port conflict.** Another service already binds 443 on the host. Free it, or start on a different port with `tale start --port 8443`.
- **Docker is not running.** `tale start` needs the Docker daemon up. Start Docker Desktop (or `sudo systemctl start docker` on Linux) and retry.
- **A container crash-loops on first boot.** Almost always a missing secret — re-run `tale start`, which re-runs environment setup, or inspect logs with `tale logs platform`.

## Where this gets used

You now have a working Tale instance on your machine. To run it for real, the [Linux server](/self-hosted/install/linux-server) walk covers TLS, firewall, a non-root user, and the operational hooks you want before real traffic lands; [CLI install](/self-hosted/install/cli-install) sets the CLI up to deploy and upgrade a remote instance from your workstation.
