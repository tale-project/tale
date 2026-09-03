---
title: Self-hosted
description: Self-hosted Tale runs on your infrastructure — on-premises, in your VPC, or air-gapped. Nine containers, your data on your disk, no per-seat billing.
kind: index
---

Self-hosted Tale runs on your own infrastructure — on-premises, in your VPC, or air-gapped. Nine containers, your data on your disk, no per-seat billing, and no traffic that crosses to Tale's servers unless you point a provider at one.

This section is for operators: the people who decide where Tale runs, install it, configure it, keep it patched, and pick up the pager when something goes wrong. End users of self-hosted instances mostly read the Platform tab — the product surface is identical between editions.

## Pages in this section

**[Architecture overview](/self-hosted/overview)** — what each container does, where data lives on disk, what talks to what.

**[Install](/self-hosted/install/quickstart)** — quickstart on a laptop, production install on a Linux host, the docker compose reference, first admin setup, the CLI installer.

**[Configuration](/self-hosted/configuration/environment-reference)** — every environment variable, provider files, authentication modes, TLS, storage, retention, SOPS-encrypted secrets, observability.

**[Operate](/self-hosted/operate/container-architecture)** — upgrades, backups and restore, observability and troubleshooting, security advisories, hardening, release notes format.

**[Contributing](/self-hosted/contributing-docker)** — how to build and test a local container change.

## Where this fits

Self-hosted is the edition where the operator owns more of the stack. If your team is small and the operational overhead would crowd out product work, [Cloud](/cloud) is the other shape of the same product. If you're standing up a fresh instance right now, [Quickstart](/self-hosted/install/quickstart) is the right next read.
