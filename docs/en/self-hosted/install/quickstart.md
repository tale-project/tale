---
title: Self-hosted quickstart
description: Get a working Tale instance running on your machine — install the tale CLI, then two commands, and the setup wizard makes you the Owner.
---

This is the fastest way to a running Tale: install the `tale` CLI, then two commands. The result is your own org running on your own machine, reachable in the browser. It is meant for a laptop or a single host you want to try Tale on; when you are ready to run it for real, the [Linux server](/self-hosted/install/linux-server) walk covers a hardened production install.

You need nothing to start, and one thing before an agent can answer:

- **Docker** — but the CLI provisions it for you: when Docker is missing, `tale dev` offers to install or start it before anything else. If you already run [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+), or Docker Engine plus the Compose plugin on Linux, the CLI uses that.
- An **[OpenRouter API key](https://openrouter.ai)** (or any OpenAI-compatible provider) so agents have a model to talk to. You do not need it for `tale init` — you add it in the app, in the setup wizard or under **Settings > AI providers**, and you can swap in any provider later.

## Step 1 — Install the CLI

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

On Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

The installer detects your OS, drops the `tale` binary on your `PATH`, and is the only step that touches your system — it asks for `sudo` when the install directory (default `/usr/local/bin`) is not writable. Confirm it landed:

```bash
tale --version
```

## Step 2 — Create a project

```bash
tale init my-project
cd my-project
```

`tale init` scaffolds a project directory, generates every security secret, and writes the `.env`, so there is nothing to hand-edit. The defaults are localhost and a self-signed certificate; the production domain is chosen later, at `tale deploy`. The one question it asks is whether agents may run `docker` / `docker compose` inside their sandboxes — the default is No, because enabling it runs a privileged inner Docker; a single-user install can say yes, while multi-tenant operators should install Sysbox instead. It does not ask for an API key; that is collected in the app once you sign in. It also drops example agents, workflows, integrations, providers, skills, and branding under `default/`, and writes `AGENTS.md` (plus a `CLAUDE.md` pointer) so an AI editor can build configs with full schema awareness. Most of that tree is a catalog rather than live configuration — only entries marked `autoInstall` are active on a new organization, and the generated `default/README.md` explains the split.

## Step 3 — Start Tale

```bash
tale dev
```

If Docker is missing, `tale dev` offers to install or start it first. The first run then pulls several gigabytes of images and builds the container graph — the CLI prints per-image pull progress and keeps waiting, so on a slow network this can take tens of minutes. Once the stack reports ready (`Tale is running — open https://localhost`), `tale dev` opens your browser automatically. If it cannot, it prints the URL to visit.

> Your browser shows a certificate warning for the local self-signed certificate. That is expected — accept it to continue.

Your config under `default/` is bind-mounted into the running instance, so edits to agents, workflows, and integrations reload live. Stop the stack with `Ctrl-C` (or `tale dev --detach` to run it in the background).

## Step 4 — Run the setup wizard

On an empty instance there is no sign-up page to hunt for: the first visit lands in the one-time setup wizard, which creates your account, signs you in, makes you the **Owner**, and names your **Organization**. You land in the dashboard — no admin key involved, and nothing to lock down afterward, because everyone after you joins by invite.

> [First admin](/self-hosted/install/first-admin) covers the wizard in detail, how teammates join, and the Convex dashboard admin key — a backend-inspection tool that plays no part in sign-in.

## Step 5 — Add a model and publish an agent

You now have an empty org. Two moves get you to something useful:

1. Add your OpenRouter key. The setup wizard prompts for it right after you create the owner account; if you skipped it, open **Settings > AI providers** and paste it there. A tick on the provider row means the key works.
2. Publish your first agent — [Create an agent](/platform/agents/create) takes it from a role and some instructions to a working specialist.

From here the [Platform](/platform) docs are the canonical reference for every feature, and they are identical to Cloud.

## Prefer raw Docker Compose?

The CLI wraps `docker compose` so you do not have to. If you would rather run the stack from a clone of the repository and manage compose yourself — for transparency, air-gapped builds, or your own automation — clone the repo, copy `.env.example` to `.env`, set `HOST` and `SITE_URL`, generate the secrets, and `docker compose up -d`. The [Linux server](/self-hosted/install/linux-server) walk and the [Docker Compose reference](/self-hosted/install/docker-compose-reference) cover that path end to end.

## Troubleshooting

- **`tale` not found after install.** The installer names the destination directory in its output; make sure that directory is on your `PATH` (on Linux it is usually `/usr/local/bin`).
- **`tale dev` exits with a port conflict.** Read the compose error to see which port is taken. If it is 443, another service binds HTTPS on the host — free it, or remap with `tale dev --port 8443` (the flag remaps only the HTTPS port). The sandbox spawner always binds `127.0.0.1:8003` and cannot be remapped, so two Tale dev projects cannot run on one machine at the same time.
- **Docker is not running.** `tale dev` offers to start (or install) it — accept the prompt, or start Docker Desktop yourself (`sudo systemctl start docker` on Linux) and retry.
- **A container crash-loops on first boot.** Almost always a missing secret — re-run `tale dev`, which re-runs environment setup, or inspect logs with `tale logs platform`.

## Where this gets used

You now have a working Tale instance on your machine. To run it for real, the [Linux server](/self-hosted/install/linux-server) walk covers TLS, firewall, a non-root user, and the operational hooks you want before real traffic lands; [CLI install](/self-hosted/install/cli-install) sets the CLI up to deploy and upgrade a remote instance from your workstation.
