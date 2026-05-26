---
title: Install the tale CLI
description: Install the tale CLI on macOS, Linux, or Windows — and configure it against your self-hosted instance for deploys and upgrades.
---

The `tale` CLI is the operator's tool for driving a self-hosted instance from a workstation. It wraps the most common operations — deploying a new version, running migrations, capturing diagnostics — so you do not have to remember every `docker compose` invocation. This walk installs it on the three supported platforms and points it at your instance.

The CLI is optional. Everything it does can be done with `docker compose` and `ssh` directly; the CLI is a convenience for teams that prefer a single command surface. If the team is already deep in their own automation, skip this page and stay with compose.

## Before you begin

You need:

- A workstation running macOS, Linux, or Windows 10+.
- SSH access to the host your Tale instance runs on, with the operator user able to run `docker compose`.
- The admin key from [First admin](/self-hosted/install/first-admin) handy.

The installer downloads a release binary from GitHub. Corporate networks that block raw-content downloads need to allow `raw.githubusercontent.com` and `github.com`.

## Step 1 — Run install-cli.sh or install-cli.ps1

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

On Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Both installers detect the OS, pull the matching release binary from the latest GitHub release, and drop it on the `PATH` (`/usr/local/bin/tale` or `%LOCALAPPDATA%\Programs\tale\tale.exe`). To pin a version, set the `VERSION` environment variable before piping into the installer.

| OS      | Installer script          |
| ------- | ------------------------- |
| macOS   | `scripts/install-cli.sh`  |
| Linux   | `scripts/install-cli.sh`  |
| Windows | `scripts/install-cli.ps1` |

## Step 2 — Verify

```bash
tale --version
```

The CLI prints its version. If the command is not found, the installer dropped the binary outside the `PATH` — the installer output names the destination directory.

## Step 3 — Configure the admin key

```bash
tale config set host tale.example.com
tale config set admin-key <key-from-first-admin>
```

The CLI stores configuration under `~/.config/tale/config.yml`. The admin key authenticates the CLI's calls to the platform container; restarting the platform container rotates the key, so refresh it then.

## Step 4 — Run tale deploy

```bash
tale deploy
```

`tale deploy` pulls the latest images for the configured `TALE_VERSION`, restarts the affected containers in the right order, and runs schema migrations. It is the supported replacement for the longer `docker compose pull && docker compose up -d` dance. If you prefer compose directly, the same effect lives in [Upgrades](/self-hosted/operate/upgrades).

## Troubleshooting

- **`tale --version` printed but `tale deploy` errors with "host not configured".** Run `tale config set host …` first; the CLI does not pick up the host from `.env`.
- **`tale deploy` errors with "auth failed".** The admin key rotated since you configured it. Re-run `./scripts/get-admin-key.sh` on the host and `tale config set admin-key …` on the workstation.
- **Installer fails on macOS with a Gatekeeper warning.** The binary is signed but not notarised yet on Apple silicon; the installer prints the `xattr` command to clear the quarantine flag.
- **`tale` not found after install on Linux.** The installer drops the binary in `/usr/local/bin`; verify the directory is on the user's `PATH` (`echo $PATH`).

## Where this gets used

Once the CLI is wired up, the operator's daily surface shrinks to a handful of subcommands. The pages worth reading next depend on what you came to do — [Upgrades](/self-hosted/operate/upgrades) for version bumps, [Backups and restore](/self-hosted/operate/backups-and-restore) for snapshot drills, [Container architecture](/self-hosted/operate/container-architecture) for what the CLI restarts when it deploys.
