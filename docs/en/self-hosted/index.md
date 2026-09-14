---
title: Run Tale on your infrastructure
description: Choose an installation path, understand your operating responsibilities, and find the configuration and maintenance guides.
kind: index
---

Self-hosted Tale gives your organization control of the deployment, storage, and model connections. The open-source platform provides the same product functionality used in the enterprise edition. Your team operates the infrastructure and decides which external services it may contact.

## Choose your starting point

| What you need | Start here |
| --- | --- |
| Try a local instance or install a new workspace | [Installation quickstart](/self-hosted/install/quickstart) |
| Understand services, data, and network connections | [Architecture overview](/self-hosted/overview) |
| Supply your own Compose or Kubernetes deployment | [Run your own stack](/self-hosted/install/own-compose) |
| Change the application source | [Contributor setup](/develop/contributor-setup) |
| Use an instance someone else operates | [Send your first message](/get-started/quickstart) |

## Plan what your team will operate

Assign responsibility for access, TLS, upgrades, backups, monitoring, and incident response before inviting users. Configure an AI provider and, when you need searchable documents, an embedding model and knowledge storage. Test an upload and a complete chat before treating the instance as ready.

Hosting the application yourself does not keep every request on the same network. A configured model provider, connector, web crawler, or external monitoring destination can receive data. Review the actual destinations in [Security hardening](/self-hosted/operate/security/hardening) and your provider configuration. An isolated deployment needs locally available images, models, credentials, and dependencies.

## Configure and maintain the instance

Use the [environment reference](/self-hosted/configuration/environment-reference) for deployment variables and the configuration guides for organization settings. The [container architecture](/self-hosted/operate/container-architecture) explains operational dependencies; [Backups and restore](/self-hosted/operate/backups-and-restore) covers recovery planning.

If your team wants Tale to operate the service, read [Tale Cloud](/cloud). Platform guides apply to both hosting options.
