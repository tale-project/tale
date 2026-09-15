---
title: Review a release before upgrading
description: Find the target release, assess changes that affect your deployment, and prepare the upgrade.
---

Read the [GitHub release notes](https://github.com/tale-project/tale/releases) for the version you plan to deploy. Start with your installed version, then review every release you will cross. A patch number alone does not establish that there are no migrations or operator actions.

## Identify your starting point

Run `tale --version` to identify the CLI. Also check the deployed runtime version: updating the CLI and rolling the running containers are separate operations. For a managed deployment, use the deployment receipt and its pinned runtime source and image digests.

The current CLI's `tale update` selects a newer version within its existing `x.y` release line. Moving between release lines requires an explicit `--version`. Use `tale update --help` for the options in your installed CLI; read the notes on GitHub.

## Read for deployment impact

Use this order when scanning a release. Headings and detail vary by release; follow any linked migration or advisory before applying the change.

| Information | Decision to make |
| --- | --- |
| Breaking and behavior changes | Which user workflows, defaults or configuration values change? |
| Migrations and upgrading instructions | What prerequisites, downtime or recovery preparation does this version require? |
| API contract changes | Do clients need updated request fields, endpoint behavior or error handling? |
| Security | Is your deployment affected, and what patched version or mitigation applies? |
| Known issues | Can you accept the remaining limitations, and are the workarounds practical? |
| Highlights and full change list | Which new capabilities or fixes should your users know about? |

Tale is a rolling-release 0.x project. Patch releases can include additive migrations and behavior changes. Security fixes target the latest release, without backports to older versions; see the [security policy](https://github.com/tale-project/tale/security/policy).

## Prepare the change

1. Record the current and target versions, including exact source pins for a managed deployment.
2. Read the notes between them and identify changes to configuration, authentication, data storage and integrations.
3. Arrange the backup, recovery path and maintenance window required by [Upgrades](/self-hosted/operate/upgrades).
4. Try the target in a separate environment and exercise your important workflows, including API clients and approval policies.
5. After deployment, check health and repeat those workflows. Keep the release notes with the deployment record.

A successful image pull is not proof that the application works after a migration. Verify the running platform before considering the upgrade complete. [Security advisories](/self-hosted/operate/security/advisories) explains how to assess and report a vulnerability.
