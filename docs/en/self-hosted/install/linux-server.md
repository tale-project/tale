---
title: Production Linux server install
description: A hardened Linux install on a single host — TLS via Let's Encrypt, firewall, non-root user, and the operational hooks to put real traffic on.
---

This walk takes the [quickstart](/self-hosted/install/quickstart) shape and hardens it for production traffic. The result is a single Linux host running Tale behind real TLS, with a firewall, a non-root operator user, and the operational defaults the team should hit before pointing users at the URL.

The walk targets a recent Ubuntu LTS or Debian; commands translate one-for-one to RHEL-family distros with `dnf` substituted for `apt`. Skip nothing — the order matters, and each step assumes the previous one landed cleanly.

## Before you begin

You need:

- A VM or bare-metal host with at least 8 GB RAM, 4 vCPU, and 100 GB disk. Storage grows with attachments and knowledge.
- A DNS A record pointing at the host's public IP. Without DNS, Let's Encrypt cannot issue a cert.
- Ports 80, 443 reachable from the public internet for TLS issuance; SSH on whatever port your operator policy says.
- Sudo on the host.

## Step 1 — Provision the box

Update and install the basics:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw
```

Create a non-root operator user named `tale`:

```bash
sudo adduser tale
sudo usermod -aG sudo,docker tale
```

Switch to that user (`sudo su - tale`) for the rest of the walk. Operating Tale as root pulls a higher blast radius for no benefit; the rest of the steps assume the `tale` user.

## Step 2 — Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
```

Verify with `docker run hello-world`. If the user cannot run docker without sudo, log out and back in to pick up the `docker` group membership.

## Step 3 — Configure firewall and reverse path

Allow only what Tale needs:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

If you front Tale with an existing reverse proxy on the same host (rare on a single-host install), set `TLS_MODE=external` in `.env` and adjust the firewall accordingly. The Caddy container inside Tale terminates TLS by default.

## Step 4 — Pull Tale

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Set `HOST`, `SITE_URL`, and generate the four secrets as in the [quickstart](/self-hosted/install/quickstart). The production diff versus quickstart lives in step 5 (TLS) and the operational hooks at the end of this walk.

## Step 5 — TLS via Let's Encrypt

Open `.env` and set:

| Variable    | Value                   |
| ----------- | ----------------------- |
| `TLS_MODE`  | `letsencrypt`           |
| `TLS_EMAIL` | An ops mailbox you read |

Caddy issues and renews the cert automatically using the DNS record from the prerequisites. The first boot waits for the cert; expect a one-minute delay on the first `docker compose up -d` while the ACME challenge runs.

## Step 6 — First boot

```bash
docker compose up -d
docker compose ps
```

Every service should be `running` or `healthy`. Walk through **Step 4 — Create the first admin** from the [quickstart](/self-hosted/install/quickstart) to land in the dashboard. Open `SITE_URL` over `https://` — the browser should not warn about the cert.

## Step 7 — Operational hooks

Before pointing users at the URL, three hooks make life easier later:

- **Backups.** `tale backup` snapshots the data volumes — blobs included — into the `backups` volume; point your off-host tooling at that volume plus the project workspace and `.env` — see [Backups and restore](/self-hosted/operate/backups-and-restore).
- **Logs.** Tale logs to stdout. If the host has journald, `journalctl -u docker` carries everything; otherwise pipe to your aggregator.
- **Metrics.** Set `METRICS_BEARER_TOKEN` in `.env` and scrape `/metrics` from your Prometheus — see [Observability config](/self-hosted/configuration/observability-config).

## Port table

| Port | Direction | Purpose                              | Required        |
| ---- | --------- | ------------------------------------ | --------------- |
| 22   | inbound   | SSH                                  | yes, restricted |
| 80   | inbound   | HTTP, used for ACME and 301 to HTTPS | yes             |
| 443  | inbound   | HTTPS, primary traffic               | yes             |
| 53   | outbound  | DNS                                  | yes             |
| 443  | outbound  | model providers, image pulls         | yes             |

## Troubleshooting

- **Let's Encrypt issuance fails.** DNS must resolve to this host's public IP from the public internet, and port 80 must be reachable from the public internet. Run `curl -I http://$HOST` from another machine; if it hits the Caddy challenge, the path works.
- **Containers cannot reach model providers.** The host's outbound firewall might block; verify with `docker compose exec platform curl -I https://api.openai.com`.
- **TLS cert renews fail later.** Caddy renews 30 days before expiry; failures show in `docker compose logs proxy`. The two common causes are an expired `TLS_EMAIL` mailbox and a DNS change that broke the record.

## Where this gets used

You now have a production-shaped install on one host. Two follow-ups belong on the calendar — [Backups and restore](/self-hosted/operate/backups-and-restore) and [Hardening](/self-hosted/operate/security/hardening). If your scale outgrows one host (the rule of thumb is roughly a hundred concurrent users on the recommended spec), the multi-host architecture lives at [Container architecture](/self-hosted/operate/container-architecture).
