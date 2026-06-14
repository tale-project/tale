---
title: Install the tale CLI
description: Install the tale CLI on macOS, Linux, or Windows — and configure it against your self-hosted instance for deploys and upgrades.
---

The `tale` CLI is the recommended way to run and operate Tale. The [quickstart](/self-hosted/install/quickstart) already uses it to stand an instance up locally with `tale init` and `tale start`; this page is the other half — installing the CLI on a workstation so it can drive a _remote_ instance: deploying new versions, running migrations, and capturing diagnostics without you remembering every `docker compose` invocation.

Everything the CLI does can also be done with `docker compose` and `ssh` directly, so a team already deep in its own automation can stay on compose. For everyone else the CLI is the shorter path, and the rest of the self-hosted docs assume it is installed.

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

## Step 3 — Confirm configuration

There is no `tale config set` — everything the CLI needs lives in the project that `tale init` created. Run any `tale` command from inside that directory (the CLI walks up the tree to find `tale.json`), and confirm it resolves:

```bash
tale config show
```

The host the proxy answers on, TLS settings, and every secret live in the project's `.env`. To change the host, edit `HOST` there or pass `--host` to `tale start` / `tale deploy`. To operate a remote host, point your shell's Docker context (or `DOCKER_HOST`) at it — the CLI talks to the same Docker endpoint every `docker` command does.

The one-time admin key that claims the first **Owner** account at sign-up is separate from CLI configuration — generate it with `tale convex admin` when you need it (see [First admin](/self-hosted/install/first-admin)).

## Step 4 — Run tale deploy

```bash
tale deploy
```

`tale deploy` pulls the latest images for the configured `TALE_VERSION`, restarts the affected containers in the right order, and runs schema migrations. It is the supported replacement for the longer `docker compose pull && docker compose up -d` dance. If you prefer compose directly, the same effect lives in [Upgrades](/self-hosted/operate/upgrades).

## Command reference

The CLI groups its commands by what you are doing, the same way `tale --help` does. Each command and its arguments are listed below. How to read the notation:

- A positional argument in `[square brackets]` is **optional**; one in `<angle brackets>` is **required**.
- Every flag is **optional** — omit it to get the default behaviour.
- A flag written `--flag <value>` **requires a value** when you use it (e.g. `--port 8443`); a bare flag like `--detach` is a boolean switch.
- **Defaults** are shown in parentheses after the description. No default means the flag is off, or the command resolves the value from `.env` / context.

Run `tale <command> --help` for the authoritative list at your installed version.

### Setup

`tale init [directory]` — create a project: it scaffolds the example configs, `AGENTS.md` + `CLAUDE.md`, and a local-default `.env` (localhost, self-signed certificate, generated secrets). No prompts and no Docker — the production domain and TLS are chosen later, at `tale deploy`. `directory` is optional (default: the current directory).

- `-f, --force` — overwrite an existing `tale.json` instead of aborting.
- `--no-env` — scaffold the project but skip `.env` generation.

`tale start` — launch all services locally with a self-signed certificate.

- `-d, --detach` — run in the background instead of streaming logs.
- `-p, --port <port>` — HTTPS port to expose (default `443`).
- `--host <hostname>` — host alias for the proxy (default `tale.local`).
- `-y, --yes` — non-interactive: auto-accept prompts (e.g. installing or starting Docker).

`tale deploy` — blue-green, zero-downtime deploy of the current CLI version. On the first deploy it prompts for your production domain and Let's Encrypt email (or pass `--host`).

- `-a, --all` — also update the stateful infrastructure services, not just the rotatable ones.
- `-s, --services <list>` — update only these comma-separated services (default: all rotatable services).
- `--host <hostname>` — host alias for the proxy (default: the `HOST` value from `.env`).
- `--override` — overwrite container config from the host workspace (encrypted `*.secrets.json` and `.history/` are always preserved).
- `--override-all` — factory-reseed the builtin catalog into every org server-side; implies `--all`.
- `-q, --quiet` — suppress container logs during the deploy.
- `-y, --yes` — auto-accept destructive confirmation prompts (e.g. `--override-all`).
- `--skip-backup` — skip the automatic pre-deploy volume snapshot.
- `--dry-run` — preview what would change without touching anything.

### Operate

`tale status` — show the current deployment status. No arguments.

`tale logs <service>` — stream a service's logs (`service` is one of the running services).

- `-f, --follow` — follow log output as it is written.
- `-n, --tail <lines>` — show only the last N lines.
- `--since <duration>` — show logs since a relative time (e.g. `1h`, `30m`).
- `-c, --color <color>` — target a specific deployment colour (`blue` or `green`).

`tale backup` — snapshot all data volumes into the project backups volume. No arguments.

`tale restore [snapshot-id]` — restore a snapshot; omit the id to list available snapshots.

- `--stop` — stop running project containers before restoring.
- `-y, --yes` — skip the confirmation prompt.

`tale rollback` — roll back to the previous patch version (patch-level only). No arguments.

### Maintain

`tale upgrade` (alias `tale update`) — upgrade the CLI to the latest release and sync project files.

- `-v, --version <version>` — install this exact version (e.g. `0.9.0`) instead of the latest; allows downgrades.
- `-f, --force` — force re-download and overwrite locally modified files.
- `--dry-run` — show what would change without modifying anything.

`tale cleanup` — remove inactive (non-current colour) containers. No arguments.

`tale reset` — remove all blue-green containers.

- `-f, --force` — skip the confirmation prompt.
- `-a, --all` — also remove the stateful infrastructure containers.
- `--dry-run` — preview the reset without making changes.

`tale config` — manage CLI configuration. Use the `show` subcommand to print the resolved config.

### Advanced

`tale auth reset-owner` — reset the owner account credentials.

- `-e, --email <email>` — set a new owner email address.
- `-p, --password <password>` — set a new owner password.

`tale convex admin` — generate a Convex dashboard admin key. No arguments.

## Troubleshooting

- **`tale deploy` targets the wrong machine.** The CLI uses your shell's Docker context / `DOCKER_HOST`. Switch with `docker context use …` (or set `DOCKER_HOST`) so it points at the intended host, then re-run.
- **`tale deploy` uses the wrong host alias.** The host the proxy answers on comes from `HOST` in the project's `.env`, not a separate CLI store. Edit `.env` or pass `--host` to override it for one run.
- **The sign-up screen rejects the admin key.** The bootstrap key rotates every time the platform container restarts. Generate a fresh one with `tale convex admin` and use it right away.
- **Installer fails on macOS with a Gatekeeper warning.** The binary is signed but not notarised yet on Apple silicon; the installer prints the `xattr` command to clear the quarantine flag.
- **`tale` not found after install on Linux.** The installer drops the binary in `/usr/local/bin`; verify the directory is on the user's `PATH` (`echo $PATH`).

## Where this gets used

Once the CLI is wired up, the operator's daily surface shrinks to a handful of subcommands. The pages worth reading next depend on what you came to do — [Upgrades](/self-hosted/operate/upgrades) for version bumps, [Backups and restore](/self-hosted/operate/backups-and-restore) for snapshot drills, [Container architecture](/self-hosted/operate/container-architecture) for what the CLI restarts when it deploys.
