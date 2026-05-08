---
title: Self-hosted Tale
description: Run Tale on your own infrastructure — install, configure, operate.
---

The self-hosted edition of Tale runs inside your own VPC, data centre, or air-gapped environment. You get the full platform as a Docker Compose bundle, upgraded with a single command (`tale deploy`), and a published certification story — at the cost of running the stack yourself. Every user-facing feature is identical to the managed [Cloud](/cloud) edition; this tab only covers what is specific to operating your own instance.

Everything a Member, Editor, Developer, or Admin uses day-to-day — chat, knowledge base, agents, automations, org admin, role permissions — lives under [Platform](/platform) and applies to both editions. This tab is for the operator who installs, upgrades, monitors, and backs up the instance.

## Install your instance

Start with the [self-hosted overview](/self-hosted/overview) for the architecture and services, then follow the [Linux server install guide](/self-hosted/install/linux-server) end-to-end. TLS, reverse proxies, and subpath deployments are covered there.

## Configure

- [Environment reference](/self-hosted/configuration/environment-reference) — every env var Tale reads, grouped by service.
- [Retention](/self-hosted/configuration/retention) — data retention policies per table.
- [Authentication](/self-hosted/admin/authentication) — password, SSO (Microsoft Entra ID), or trusted-header integration. Self-hosted-specific because it is driven by env vars.

## Operate

- [Container architecture](/self-hosted/operate/container-architecture) — how the services fit together.
- [Observability](/self-hosted/operate/observability/operations) — metrics, logs, and health checks.
- [Troubleshooting](/self-hosted/operate/observability/troubleshooting) — diagnose problems on a live instance.
- [Security advisories](/self-hosted/operate/security/advisories) — patch responsibilities and CVE tracking.
- [Release notes](/self-hosted/operate/release-notes/format) — how to read release notes; upgrade notes per version.

## Platform features and admin

For feature documentation (chat, agents, automations, knowledge, integrations) and org admin (members, roles, teams, branding, governance, AI providers, analytics), go to [Platform](/platform). Role-based guidance for end users also lives there.
