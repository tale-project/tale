---
title: Self-hosted Tale
description: Run Tale on your own infrastructure — install with the CLI, configure with environment variables, upgrade with `tale deploy`.
kind: index
---

Self-hosted Tale is the same product as the [Cloud](/cloud) edition, packaged as a six-container Docker Compose stack you run on your own infrastructure. The `tale` CLI installs it, environment variables and JSON config files under `TALE_CONFIG_DIR` configure it, and `tale deploy` upgrades it blue-green so users never see a maintenance window. This tab is for the operator standing the instance up and keeping it running; end users — Members, Editors, Developers, Admins — read [Platform](/platform), which is identical between Cloud and self-hosted.

Three threads run through every page below. **Install** covers getting from a fresh box to a running instance, on a laptop or on a production Linux server. **Configure** catalogues the knobs that exist — environment variables, provider files, retention bounds — and where each one lives on disk. **Operate** is the steady state — observability, troubleshooting, advisories, release notes, the authentication surfaces that wire Tale to your identity provider.

## Pages in this section

The pages below are ordered the way an operator typically reaches them: pick an install path, read the configuration reference once, then live on the operate pages.

- **[Self-hosted overview](/self-hosted/overview)** — operators sizing up the platform. The six containers, where each one runs, what each port and volume does.
- **[Local quickstart](/self-hosted/install/quickstart)** — first-time installers on Linux, macOS, or Windows. Local install via the `tale` CLI in about ten minutes.
- **[Production deployment](/self-hosted/install/linux-server)** — operators deploying to a production server. TLS, reverse proxies, subpath deployments, external Postgres, blue-green upgrades.
- **[Environment reference](/self-hosted/configuration/environment-reference)** — every environment variable Tale reads, grouped by surface, with defaults pulled from `.env.example` and the env loaders.
- **[Providers](/self-hosted/configuration/providers)** — provider JSON files, the cost schema, gateway-vs-direct-vendor passthrough rules, and how to point Tale at a local Ollama, vLLM, or LocalAI server.
- **[Retention](/self-hosted/configuration/retention)** — the file/env/UI three-layer retention model, the sixteen data categories, the nightly cleanup job, and the GDPR erasure path.
- **[Authentication](/self-hosted/admin/authentication)** — password, Microsoft Entra ID SSO, and trusted-header integration with an upstream authenticating reverse proxy.
- **[Container architecture](/self-hosted/operate/container-architecture)** — how the six services connect on the internal Docker network, the volume map, the health-check shape, and the blue-green topology.
- **[Operations](/self-hosted/operate/observability/operations)** — Prometheus metrics, log streams, health probes, image budgets, container smoke tests.
- **[Troubleshooting](/self-hosted/operate/observability/troubleshooting)** — the handful of issues operators actually hit, each with the symptom-cause-fix shape.
- **[Security advisories](/self-hosted/operate/security/advisories)** — how CVEs are coordinated, how operators subscribe, what the patch-responsibility split between Ruler GmbH and the operator looks like.
- **[Release notes format](/self-hosted/operate/release-notes/format)** — the canonical shape of GitHub release notes; the order of sections; what every operator should scan before running `tale upgrade`.

## Install your instance

Two install paths, picked by environment.

- **Laptop or workstation.** Read the [Local quickstart](/self-hosted/install/quickstart). One `tale init`, one `tale start`, browse to `https://localhost` — enough to evaluate the product, run a demo, or develop against the platform. Self-signed TLS by default, so the first visit shows a browser warning you click through.
- **Production Linux server.** Read [Production deployment](/self-hosted/install/linux-server). Real domain, Let's Encrypt TLS, blue-green topology that survives upgrades without a maintenance window, optional external Postgres. This is the canonical path for putting Tale in front of a team.

Once the instance is up, every Member, Editor, Developer, and Admin you onboard reads [Platform](/platform). Nothing about the role-indexed sections there changes between editions — the difference is which tab they came from.

## Configure and operate

After install, two operator-side surfaces matter day to day.

The **configuration** surface is `.env` and `TALE_CONFIG_DIR`. Every runtime knob is either an environment variable read at container start or a JSON file watched on disk; the [Environment reference](/self-hosted/configuration/environment-reference) is exhaustive and the [Providers](/self-hosted/configuration/providers) and [Retention](/self-hosted/configuration/retention) pages are the JSON-file counterparts.

The **operate** surface is what the long-term shape of running Tale looks like. Prometheus metrics live on every service, structured logs go to Docker stdout, health probes drive blue-green cutover decisions. [Operations](/self-hosted/operate/observability/operations) is the index; [Troubleshooting](/self-hosted/operate/observability/troubleshooting) is the symptom-to-fix map for when something on a live instance goes sideways.

## Where this fits

Self-hosted is the operator's tab. The product itself — chat, agents, automations, knowledge, integrations, admin — lives once under [Platform](/platform) and reads identically here. Cross-reference the install pages when standing the instance up, the configuration reference when a value needs changing, the operate pages when something goes wrong in production. For source contributions and the API, [Develop](/develop/api-reference) is one tab over.
