---
title: Self-hosted Tale
description: Run Tale on your own infrastructure — install with the CLI, configure with environment variables, upgrade with `tale deploy`.
---

The self-hosted edition runs Tale inside your VPC, your data centre, or an air-gapped environment. You get the full platform as a Docker Compose bundle, install it with a single CLI command, and upgrade with `tale deploy` — blue-green, zero-downtime, the same way the [Cloud](/cloud) edition rolls forward. Every user-facing feature documented under [Platform](/platform) is identical to Cloud; this tab covers only what is specific to running your own instance.

This section is for the operator who installs, configures, observes, upgrades, and backs up the stack. End users — Members, Editors, Developers, Admins — consume [Platform](/platform) directly; the role-specific pages there apply on both editions. The only Self-hosted-specific surfaces are install, configuration files and environment variables, container architecture, observability, release notes, and trusted-header authentication.

## Pages in this section

Each page lives at the level of one operator decision. The shape: title in bold, em-dash, one-sentence promise.

- **[Self-hosted overview](/self-hosted/overview)** — operators sizing up the platform. Architecture, the five services, the database choice, and what runs where.
- **[Install: Quickstart](/self-hosted/install/quickstart)** — first-time installers on Linux/macOS/Windows. Local install via the `tale` CLI, ten-minute walkthrough.
- **[Install: Linux server](/self-hosted/install/linux-server)** — operators deploying to a production server. TLS, reverse proxy, subpath, hardening.
- **[Configuration: Environment reference](/self-hosted/configuration/environment-reference)** — every `TALE_*` environment variable, grouped by service, with defaults.
- **[Configuration: Providers](/self-hosted/configuration/providers)** — AI provider config files: schema, fields, cost rules, gateway-vs-vendor distinction.
- **[Configuration: Retention](/self-hosted/configuration/retention)** — per-table data-retention policies and how they're enforced.
- **[Authentication](/self-hosted/admin/authentication)** — password, Microsoft Entra ID SSO, and trusted-header integration with an upstream reverse proxy.
- **[Container architecture](/self-hosted/operate/container-architecture)** — how the five services connect on the internal Docker network, where ports are exposed, and what the blue-green roll looks like.
- **[Observability: Operations](/self-hosted/operate/observability/operations)** — Prometheus metrics, log streams, health probes, and what to wire into your monitoring stack.
- **[Observability: Troubleshooting](/self-hosted/operate/observability/troubleshooting)** — the three or four issues operators actually hit and how to diagnose them on a live instance.
- **[Security advisories](/self-hosted/operate/security/advisories)** — how Ruler GmbH publishes CVEs, how operators subscribe, and the patch-responsibility split between the project and the operator.
- **[Release notes format](/self-hosted/operate/release-notes/format)** — the canonical format for GitHub release notes; what's in scope, what's out, how to read them before an upgrade.

## Install your instance

Two install paths. Pick the one that matches your environment.

- **Local laptop or workstation.** Follow the [Quickstart](/self-hosted/install/quickstart) — `tale init my-project`, `tale start`, browse to `https://localhost`. Best for evaluating the product or for solo developer use.
- **Production Linux server.** Follow the [Linux server install](/self-hosted/install/linux-server) — sets up TLS via Caddy, configures a reverse proxy if one is in front, and walks through subpath deployment. This is the canonical path for org-wide use.

Once the instance is up, every Member, Editor, Developer, and Admin you onboard reads [Platform](/platform); the role-specific pages there don't change between editions.

## Configure and operate

After install, two operational surfaces matter:

- **Configuration** — every knob is either an environment variable or a JSON config file under `TALE_CONFIG_DIR`. The reference pages under [Configuration](/self-hosted/configuration/environment-reference) are exhaustive; reach for them when a value needs changing.
- **Observability** — Tale exports Prometheus metrics on each service's port, writes structured logs to stdout, and exposes a liveness/readiness probe on every container. The [Operations](/self-hosted/operate/observability/operations) page covers what to scrape, what to alert on, and what each log line means.

## Where this fits

Self-hosted is the operator's tab. The product itself — chat, agents, automations, knowledge, integrations, admin — lives once under [Platform](/platform) and reads identically here. Cross-reference the install pages when standing the instance up; reach for the configuration reference when a value needs changing; reach for the operate pages when something goes wrong in production. For source contributions and the API, [Develop](/develop/api-reference) is one tab over.
