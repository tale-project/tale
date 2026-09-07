---
title: Install
description: Two ways to run Tale — the CLI, or a stack you write yourself (Compose or Kubernetes).
---

Installing Tale has two shapes. The CLI wraps Docker Compose so you never edit a file. Writing the stack yourself is the path when that wrapper is the thing you cannot run — one compose file, or a Kubernetes mapping of the same contract.

## The CLI

Install the CLI, then `tale init` and either `tale dev` or `tale deploy`. The same project directory is the unit: a laptop trial becomes a production host without re-initialising.

- [Quickstart](/self-hosted/install/quickstart) — `tale init`, then `tale dev` or `tale deploy`.
- After the first boot, [First admin](/self-hosted/install/first-admin) makes the first account the **Owner**. Everyone after that joins by invite.
- [CLI install](/self-hosted/install/cli-install) is the installer and the remote-workstation half (`DOCKER_HOST`).

## Write the stack yourself

No official Helm chart. The contract is the same whether you write Compose or Kubernetes: which services hold state, the DNS names, the probes, the volumes, and what a file you maintain does not do for you.

[Run Compose yourself](/self-hosted/install/own-compose) is that page.

## Where this fits

Pick by what you are willing to operate. The [quickstart](/self-hosted/install/quickstart) is the CLI path — laptop or production host. The compose-or-cluster path is for air-gap and existing automation.

Once installed, the [Configuration](/self-hosted/configuration/environment-reference) pages are every environment variable and provider file, and [Operate](/self-hosted/operate/container-architecture) covers upgrades, backups, and observability.
