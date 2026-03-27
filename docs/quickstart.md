---
title: Quick start
description: Get Tale running locally in 15 minutes.
---

This section walks you through getting Tale running locally for the first time. The whole process takes about 15 minutes.

## Prerequisites

### Required software

| Software | Minimum version | Where to get it |
| --- | --- | --- |
| Docker Desktop | 24.0+ | https://www.docker.com/products/docker-desktop |
| Git | Any recent version | https://git-scm.com |

### Required API key

Tale uses OpenRouter as its default AI gateway, which gives you access to hundreds of models through a single API key.

1. Go to https://openrouter.ai and create a free account.
2. Navigate to Keys in your account dashboard and generate a new API key.
3. Copy the key. You will need it in Step 3.

> **Tip:** You can use any OpenAI-compatible provider, including a local Ollama instance, by setting `OPENAI_BASE_URL` and `OPENAI_API_KEY` in your `.env`. OpenRouter is the recommended choice for its model variety and simple pricing.

## Local setup

If you are on Windows or want to skip building from source, jump to the [pre-built images](#using-pre-built-images) section instead. It is faster and has the same result.

### Step 1: Set up your local domain

Tale uses `tale.local` as its default local address. Add one line to your hosts file so your browser can reach it.

On macOS or Linux:

```bash
sudo sh -c 'echo "127.0.0.1 tale.local" >> /etc/hosts'
```

On Windows, run PowerShell as Administrator:

```powershell
Add-Content -Path "C:\Windows\System32\drivers\etc\hosts" -Value "127.0.0.1 tale.local"
```

### Step 2: Clone the repository

```bash
git clone https://github.com/tale-project/tale.git
cd tale
```

### Step 3: Set up your `.env` file

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` in any text editor. The file already has placeholder values for everything. You only need to fill in these required ones:

| Variable | Required? | How to fill it in |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | Paste your OpenRouter API key here |
| `BETTER_AUTH_SECRET` | Yes | Generate with: `openssl rand -base64 32` |
| `ENCRYPTION_SECRET_HEX` | Yes | Generate with: `openssl rand -hex 32` |
| `DB_PASSWORD` | Yes | Choose any password for the local database |

> **Important:** The `.env.example` file ships with example secrets that are not safe to use. You must replace `BETTER_AUTH_SECRET` and `ENCRYPTION_SECRET_HEX` with your own generated values before starting. Using the example values is a security risk even in local development.

### Step 4: Start the platform

The first time you run this, Docker builds the service images from source. This takes 3 to 5 minutes. Subsequent starts are much faster.

```bash
docker compose up --build
```

Watch the logs. When you see this message, everything is ready:

```text
🎉 Tale Platform is running!
```

> **Note:** You will see a stream of `200 OK` health check messages while services are starting. Those are normal and do not mean the UI is ready. Wait for the ready message before opening your browser.

### Step 5: Trust the certificate (recommended)

Tale generates a self-signed TLS certificate for local development. Your browser will show a security warning the first time you visit. To get rid of it permanently, run:

```bash
docker exec tale-proxy caddy trust
```

Then restart your browser.

### Step 6: Open the app

Go to https://tale.local in your browser. The first time you open it, you will be taken to a sign-up page to create your admin account.

## Using pre-built images

This approach skips the local build entirely. Docker pulls pre-built images from GitHub and starts them directly. You only need two files from the repository: `compose.yml` and `.env`.

Add these two lines to your `.env` file:

```dotenv
PULL_POLICY=always
VERSION=latest
```

Then start without the `--build` flag:

```bash
docker compose up
```

> **Tip:** To update Tale to the latest version when using pre-built images, run `docker compose down`, then `docker compose pull`, then `docker compose up`. This fetches new images without affecting your data.

## Daily workflow

### Starting the platform

1. Open Docker Desktop and wait until the engine status shows green.
2. In your terminal, go to the `tale` folder and run `docker compose up`.
3. Wait for the platform ready message, then open https://tale.local.

### Stopping the platform

To stop all services while keeping your data:

```bash
docker compose down
```

> **Important:** Never run `docker compose down -v`. The `-v` flag deletes all Docker volumes, which permanently erases your database, uploaded documents, crawler state, and all platform data. There is no recovery from this.
