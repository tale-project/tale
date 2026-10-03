---
title: Run your first self-hosted instance
description: Install the CLI, start Tale locally, create your owner account and verify a first chat reply.
---
Run Tale locally with the published CLI, then create your workspace and send a message. You do not need to clone the repository, install Bun or build the application. The CLI downloads the container images and prepares the configuration.

## Prepare the local machine

You need:

- macOS, Linux or Windows with PowerShell, and Docker running Linux containers with Compose. Docker Desktop includes Compose on macOS and Windows. If Docker is missing, `tale dev` offers to help install it.
- Network access to GitHub for the CLI and container registries for the images. The first start downloads several GB; leave room for the images and your data.
- A supported model provider credential for the first reply. You can create the account and explore the application before connecting a provider.

On ARM64, including Apple Silicon, the bundled object store needs amd64 emulation. Docker Desktop includes it; a standalone Linux Docker host needs emulation configured separately. Check the [architecture requirements](/self-hosted/install/cli-install#before-you-begin) before starting on ARM64 Linux.

The default HTTPS port is `443`; the sandbox service also uses `127.0.0.1:8003`. Keep the instance private until you have created its owner account.

## Install the CLI

Choose the installer for your operating system:

<Tabs>

<Tab title="macOS / Linux">

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

</Tab>

<Tab title="Windows (PowerShell)">

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

</Tab>

</Tabs>

Run `tale --version` in the same terminal to confirm installation. If the command is missing, follow the installer’s `PATH` guidance and reopen any terminals that were already open. The [CLI installation guide](/self-hosted/install/cli-install) covers pinned versions and custom installation directories.

Check `tale --help` before using `tale doctor`. If `doctor` is not listed, run `docker info` and `docker compose version` to check Docker and Compose. When available, `tale doctor` also checks container architecture and local ports without installing software or changing files. Follow any reported recovery steps; a passing check does not verify image downloads or model access.

## Initialize and start

Choose where you want to keep the project, then run:

```bash
tale init my-project
cd my-project
tale dev
```

`tale init` creates the project and a private `.env` containing generated secrets. Keep that file and its encryption keys in secure backups. At the sandbox Docker prompt, keep the default disabled unless your agents need to run Docker: enabling it permits privileged nested Docker.

`tale dev` starts the containers and prints the address when the application is ready. Leave it running during the first image downloads and database setup. Open the printed URL, normally `https://localhost`. The local certificate is self-signed; verify that the address is your own instance before accepting the browser warning.

<Note>

The generated `default/` directory contains catalog examples as well as automatically installed entries. You do not need to edit it for this first run. Its `README.md` explains which configuration changes affect an organization.

</Note>

## Create the owner and test a reply

1. Follow the setup flow to create your account and name the organization. This first account becomes its **Owner**; [First owner](/self-hosted/install/first-admin) covers ownership and existing accounts.
2. After setup, open **Settings > AI providers** and add a supported credential. The setup completion page also links to provider settings. Follow [AI providers](/platform/admin/providers) for the fields and supported authentication methods.
3. Open **Home**, choose **New chat**, select an available model and send a short request such as “Write a three-item meeting checklist.” Wait for the answer to finish.

A completed reply confirms that the account, provider and chosen model work together. If the model list is empty or the request fails, use the provider guide’s recovery steps. [Send your first message](/get-started/quickstart) explains how to continue and find the conversation again. When you are ready to delegate project work, [create your first agent](/tutorials/editor/first-agent-end-to-end).

## Stop and return later

Press `Ctrl-C` in the terminal running `tale dev` to stop the foreground instance. From the same project directory, run `tale dev` again to resume it with its existing data.

Check `tale dev --help` before using the background commands below. If it does not list `--stop`, keep `tale dev` in the foreground and stop it with `Ctrl-C`.

```bash
tale dev --detach
tale dev --stop
```

Stopping preserves the project, secrets and persistent data. Keep using the same project directory; creating a new project starts a separate instance.

## Resolve startup problems

| Symptom | Next action |
| --- | --- |
| `tale` is not found | Check the installer destination and terminal `PATH`; on Windows, open a new terminal. |
| Docker cannot start | Open Docker Desktop or start the daemon. Confirm `docker info` works in the same terminal, then retry. |
| Compose is missing | Check `docker compose version`; install the Compose plugin or update Docker Desktop. |
| An image pull is slow or fails | Check the reported registry/network error and free disk space. After fixing the cause, rerun `tale dev` in the same directory. |
| HTTPS port is busy | Inspect the process using port `443`. With the published v0.5.70 CLI, free that port before retrying. |
| Port `8003` is busy | Stop the other local Tale stack or service using it. Changing `--port` changes HTTPS only. |
| A container keeps restarting | Run `tale status`, then `tale logs backend-api --tail 100` or `tale logs platform --tail 100`. Use the reported service’s logs to find the cause. |
| Login appears instead of first-time setup | An account already exists. Sign in with it; do not reset the data to repeat setup. |
| The app opens but no reply arrives | Check the provider credential and selected model under **Settings > AI providers**. |

Rerun after correcting the reported cause; keep `.env` and the data volumes. For persistent failures, follow [Troubleshooting](/self-hosted/operate/observability/troubleshooting) and include the CLI version and relevant error when asking for help. Remove credentials from logs before sharing them.

## Prepare a production deployment

`tale deploy` deploys the project configuration to the selected Docker host. Development and deployment use separate data volumes: deploying does not transfer the local account, chats or uploaded files. Prepare DNS, TLS, backups and access controls before adding a production team.

Read [TLS and domains](/self-hosted/configuration/tls-and-domains), [Backups and restore](/self-hosted/operate/backups-and-restore) and [Hardening](/self-hosted/operate/security/hardening). If your infrastructure requires service definitions you maintain directly, use [Run Compose yourself](/self-hosted/install/own-compose).
