---
title: Self-hosted quickstart
description: Single-host Tale instance on a fresh server in twenty minutes — clone, configure two variables, docker compose up, create the first admin.
---

This quickstart lands a working single-host Tale instance on a fresh server in about twenty minutes. The result is your own org running on your own machine, reachable on a URL you control. It is the smallest set of moves that gets you to a sign-in screen; production hardening lives on the [Linux server](/self-hosted/install/linux-server) page.

You need a host with Docker and Docker Compose installed, a DNS name pointing at the host (or a willingness to use the host's IP for now), and ports 80 and 443 open. The walk uses the bundled compose files unchanged — no edits beyond the two environment variables `HOST` and `SITE_URL`.

## Before you begin

Verify the host is ready:

```bash
docker --version
docker compose version
```

Both commands need to print version strings. If either is missing, install Docker Engine plus the Compose plugin from the official Docker docs before continuing. Production hosts run a recent Ubuntu LTS, a recent Debian, or a recent Fedora; container runtimes other than Docker are not supported.

## Step 1 — Clone and set HOST plus SITE_URL

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Open `.env` in your editor and set two variables:

- `HOST` — the hostname users will reach the instance at (e.g. `tale.example.com` or the host's public IP for local testing).
- `SITE_URL` — the full URL with scheme (`https://tale.example.com` or `http://<host>:80` for local).

Leave everything else alone for now. The other variables have sensible defaults; the [environment reference](/self-hosted/configuration/environment-reference) names them all.

## Step 2 — Generate secrets

The first boot needs three secrets initialized. The `.env.example` ships placeholders; replace them with values from `openssl`:

```bash
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 48)" >> .env
echo "ENCRYPTION_SECRET_HEX=$(openssl rand -hex 32)" >> .env
echo "DB_PASSWORD=$(openssl rand -base64 24)" >> .env
echo "INSTANCE_SECRET=$(openssl rand -base64 48)" >> .env
```

These get embedded in containers on first boot. Store the `.env` somewhere safe; you cannot recover the data if you lose `ENCRYPTION_SECRET_HEX` or `DB_PASSWORD`.

## Step 3 — Run docker compose up

```bash
docker compose up -d
```

The first run pulls every image and builds the container graph. Expect five to ten minutes on a fresh machine. When `docker compose ps` shows every service in the `running` (or `healthy`) state, the platform is up. The exposed services are Caddy on 80 and 443; everything else is internal.

## Step 4 — Create the first admin

The first account on a brand-new instance needs a bootstrap key. The shipped helper generates one:

```bash
./scripts/get-admin-key.sh
```

Copy the key the script prints. Visit `SITE_URL`, click **Sign up**, fill in your name, email, and a password. On the next screen, paste the admin key and create the **Organization**. You land in the dashboard with the **Owner** role.

For the deeper walk on the bootstrap rule, see [First admin](/self-hosted/install/first-admin).

## Step 5 — Visit SITE_URL

Open `SITE_URL` in a browser. You should see your org's dashboard, sidebar, and an empty agents list. Add a provider under **Settings > Providers**, publish an agent (see [Create an agent](/platform/agents/create)), and you are doing the same thing Cloud onboarding ends on.

## Troubleshooting

- **`docker compose up` exits with a port conflict.** Another service on the host already binds 80 or 443. Stop it (`sudo systemctl stop nginx` and friends) or set `TLS_MODE=external` in `.env` and front Tale with your existing reverse proxy.
- **The sign-up page loads but the admin key is rejected.** Run `./scripts/get-admin-key.sh` again — keys rotate per boot. If the script errors with "container not running", the platform container has not booted yet; `docker compose ps` will tell you which service is unhealthy.
- **HTTPS errors on first visit.** Let's Encrypt needs the DNS to be live and port 80 reachable from the public internet before it can issue a cert. While DNS propagates, browse over `http://` or set `TLS_MODE=selfsigned` in `.env`.
- **Containers crash-loop on a fresh boot.** Almost always missing secrets. `docker compose logs platform` will name the missing variable verbatim.

## Where this gets used

You now have a working Tale instance, but the host is not hardened for production. The [Linux server](/self-hosted/install/linux-server) walk covers TLS, firewall, non-root user, and the operational hooks you want before real traffic lands. If you want to manage the host with the `tale` CLI instead of `docker compose`, [CLI install](/self-hosted/install/cli-install) is the next read.
