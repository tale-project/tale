---
title: Run your first self-hosted instance
description: Install the CLI, start a local Tale project and verify a first model reply.
---
Start a local Tale instance with the CLI, create the first owner account and test a chat. The CLI prepares the project and container stack; you keep the project configuration and persistent data on infrastructure you control.

## Prepare the local machine

Use a machine that can run Docker with Compose and has enough free storage for container images and your data. The CLI can help install or start Docker when it is missing. The initial image pull needs network access and can take longer on a slow connection.

You also need credentials for a supported model provider before an agent can answer. You can add them after account setup. Keep this first instance private while creating its initial owner.

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

Run `tale --version` in a new terminal if necessary. If the command is missing, check the installation directory printed by the installer and add it to `PATH`. The [CLI installation guide](/self-hosted/install/cli-install) covers pinned releases and remote Docker access.

## Initialize and start

Create a new project directory and start its development stack:

```bash
tale init my-project
cd my-project
tale dev
```

`tale init` writes the project configuration and generated secrets. Keep `.env` private and preserve it with the project. Review the sandbox Docker question before enabling it: privileged nested Docker changes the isolation requirements of the host.

`tale dev` starts Docker dependencies and waits for the stack. Open the URL the CLI prints when it is ready. The default local URL uses a self-signed certificate; confirm you are opening your own local instance before accepting the browser warning.

<Note>

The generated `default/` tree contains catalog examples as well as entries installed automatically. Editing a catalog example does not necessarily change an existing organization. Read its generated `README.md` before relying on live configuration reload.

</Note>

Keep `tale dev` running while using the instance. `Ctrl-C` stops the foreground run; `tale dev --detach` starts it in the background. Stopping containers does not erase their persistent data.

## Create the owner and test a reply

On an empty instance, complete the setup flow to create your account and organization. Confirm the **Owner** role under **Settings > Members** using [First owner](/self-hosted/install/first-admin).

Connect a model provider during setup or under **Settings > AI providers**, then follow [Create your first agent](/tutorials/editor/first-agent-end-to-end). A provider credential being saved is not enough: send a message and inspect the finished reply to verify the provider, model and execution path.

## Resolve startup problems

| Symptom | Next action |
| --- | --- |
| `tale` is not found | Check the installer destination and terminal `PATH`. |
| Docker cannot start | Open Docker Desktop or start the daemon, then retry. |
| An image pull is slow or fails | Read the image name and network error; confirm registry access and available disk space. |
| HTTPS port is busy | Inspect the process using it or select `tale dev --port 8443`. This changes the HTTPS port only. |
| A container keeps restarting | Read `tale status` and `tale logs <service>`; fix the reported cause before restarting again. |
| The app opens but no reply arrives | Check model credentials and the chosen model, then inspect backend and sandbox logs. |

The sandbox spawner uses `127.0.0.1:8003`, so changing the HTTPS port alone does not isolate two local projects.

## Prepare a production deployment

`tale deploy` deploys the project configuration to the selected Docker host. Prepare DNS, TLS, backups and access controls before inviting a production team. Reusing the project directory does not by itself transfer databases or uploaded files to a different host.

Read [TLS and domains](/self-hosted/configuration/tls-and-domains), [Backups and restore](/self-hosted/operate/backups-and-restore) and [Hardening](/self-hosted/operate/security/hardening). If your infrastructure requires a deployment you maintain directly, use [Run Compose yourself](/self-hosted/install/own-compose).
