---
title: Choose an installation method
description: Use the Tale CLI for a workspace deployment, or run the documented service contract in your own infrastructure tooling.
---

Use the Tale CLI for the standard workspace installation. Choose a custom stack when your infrastructure tooling must own the service definitions. Both paths need the same application services and an operator responsible for configuration and maintenance.

## Install with the CLI

The [quickstart](/self-hosted/install/quickstart) takes you through the prerequisites, project creation, startup, and first sign-in. `tale init` prepares a project directory; `tale dev` starts a development instance and `tale deploy` deploys that workspace.

The CLI manages container operations, but you still own the project's configuration, credentials, volumes, and updates. Keep the project directory and its deployment settings together. [Install the CLI](/self-hosted/install/cli-install) covers supported systems, remote Docker access, commands, and managed deployment options.

## Use your own service definitions

[Run your own stack](/self-hosted/install/own-compose) describes the services, volumes, networking, readiness checks, and boot order you must preserve. Use it when maintaining Compose yourself. [Deploy on Kubernetes](/self-hosted/install/kubernetes) translates that contract into Deployments, Services, and NetworkPolicies, and lists the checks a cluster must pass. Tale does not ship an official Helm chart.

For changes to Tale's source code, follow [Contributor setup](/develop/contributor-setup) instead of starting with a production deployment.

## Complete the first setup

After the instance is ready, [create the first administrator](/self-hosted/install/first-admin), connect a provider, and test a chat. Add team members through [Members and roles](/platform/admin/members-and-roles), using the account and sign-in options available in your organization.

Before using production data, configure TLS and backups, confirm the [environment settings](/self-hosted/configuration/environment-reference), and read the [operating architecture](/self-hosted/operate/container-architecture).
