---
title: Install the tale CLI
description: Install the tale CLI on macOS, Linux, or Windows — and configure it against your self-hosted instance for deploys and upgrades.
---

The `tale` CLI is the recommended way to run and operate Tale. The [quickstart](/self-hosted/install/quickstart) already uses it to stand an instance up locally with `tale init` and `tale dev`; this page is the other half — installing the CLI on a workstation so it can drive a _remote_ instance: deploying new versions, running migrations, and capturing diagnostics without you remembering every `docker compose` invocation.

Everything the CLI does can also be done with `docker compose` and `ssh` directly, so a team already deep in its own automation can stay on compose. For everyone else the CLI is the shorter path, and the rest of the self-hosted docs assume it is installed.

## Before you begin

You need:

- A workstation running macOS, Linux, or Windows 10+.
- SSH access to the host your Tale instance runs on, with the operator user able to run `docker compose`.

The installer downloads a release binary from GitHub. Corporate networks that block raw-content downloads need to allow `raw.githubusercontent.com` and `github.com`.

## Step 1 — Run install-cli.sh or install-cli.ps1

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

On Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Both installers detect the OS and CPU architecture, pull the matching release binary from the latest GitHub release, and drop it on the `PATH` (`/usr/local/bin/tale` or `%LOCALAPPDATA%\Programs\tale\tale.exe`) — asking for `sudo` when the install directory is not writable. Release binaries ship for macOS on Apple Silicon and Intel, and for Linux on x86_64 and arm64; Windows-on-ARM machines run the x64 binary through the built-in emulation. On an architecture without a released binary, the installer exits with a clear message and points you at building from source. To pin a version, set the `VERSION` environment variable before piping into the installer; to pick the install directory yourself, set `INSTALL_DIR`.

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

The host the proxy answers on, TLS settings, and every secret live in the project's `.env`. To change the host, edit `HOST` there or pass `--host` to `tale dev` / `tale deploy`. To operate a remote host, point your shell's Docker context (or `DOCKER_HOST`) at it — the CLI talks to the same Docker endpoint every `docker` command does.

## Step 4 — Run tale deploy

```bash
tale deploy
```

`tale deploy` always ships the CLI's own version: it pulls that version's images, restarts the affected containers in the right order, and runs schema migrations — `tale update` is how you move to a different version first. It is the supported replacement for the longer `docker compose pull && docker compose up -d` dance. If you prefer compose directly, the same effect lives in [Upgrades](/self-hosted/operate/upgrades).

## Command reference

The CLI groups its commands by what you are doing, the same way `tale --help` does. Each command and its arguments are listed below. How to read the notation:

- A positional argument in `[square brackets]` is **optional**; one in `<angle brackets>` is **required**.
- Every flag is **optional** — omit it to get the default behaviour.
- A flag written `--flag <value>` **requires a value** when you use it (e.g. `--port 8443`); a bare flag like `--detach` is a boolean switch.
- **Defaults** are shown in parentheses after the description. No default means the flag is off, or the command resolves the value from `.env` / context.

Run `tale <command> --help` for the authoritative list at your installed version.

**Global flags** work on every command:

- `--verbose` — verbose output: debug logs and the raw subprocess stream (long form only; there is no `-v`).
- `-q, --quiet` — only warnings and errors.
- `-y, --yes` — assume "yes" for all prompts (non-interactive).
- `--no-color` — disable ANSI colour (also honours `NO_COLOR` / `FORCE_COLOR`).
- `--json` — machine-readable JSON on stdout, human messages on stderr; supported by `status` and `config show`.
- `--ci` — force non-interactive, append-only output (no cursor control).

Commands exit `0` on success, `2` on a usage error, `3` on an unmet precondition (no project, Docker not running, port in use), `4` on a user abort (Ctrl-C, or a required prompt with no terminal), and `5` on an external-dependency failure — so scripts can branch on the cause.

### Setup

`tale init [directory]` — create a project: it scaffolds the example configs, `AGENTS.md` + a `CLAUDE.md` pointer, and a local-default `.env` (localhost, self-signed certificate, generated secrets). No Docker is needed, and the production domain and TLS are chosen later, at `tale deploy`. In a terminal it asks for a project name when `directory` is omitted, confirms before overwriting an existing project, and asks once whether agents may run `docker` inside sandboxes (default: no — enabling it runs a privileged inner Docker); non-interactive runs skip all prompts. `directory` is optional (default: the current directory).

- `-f, --force` — overwrite an existing `tale.json` instead of aborting.
- `--no-env` — scaffold the project but skip `.env` generation.

`tale dev` — launch all services locally with a self-signed certificate.

- `-d, --detach` — run in the background instead of streaming logs.
- `-p, --port <port>` — HTTPS port to expose (default `443`).
- `--host <hostname>` — host alias for the proxy (default `localhost`).
- `-y, --yes` — non-interactive: auto-accept prompts (e.g. installing or starting Docker).

`tale deploy` — blue-green, zero-downtime deploy of the current CLI version. On the first deploy it prompts for your production domain and Let's Encrypt email (or pass `--host`).

- `--stop` — also update the stop-gated tier (`db`, `proxy`) — recreates those containers, so accept a brief downtime; without it, running `db`/`proxy` are left untouched.
- `-s, --services <list>` — update only these comma-separated services (default: all rotatable services).
- `--host <hostname>` — host alias for the proxy (default: the `HOST` value from `.env`).
- `--override` — overwrite container config from the host workspace (encrypted `*.secrets.json` and `.history/` are always preserved).
- `--override-all` — factory-reseed the builtin catalog into every org server-side; implies `--stop`.
- `-q, --quiet` — suppress container logs during the deploy.
- `-y, --yes` — auto-accept destructive confirmation prompts (e.g. `--override-all`).
- `--skip-backup` — skip the automatic pre-deploy volume snapshot.
- `--dry-run` — preview what would change without touching anything.

### Operate

`tale status` — show the current deployment status. No arguments.

`tale logs <service>` — stream a service's logs (`service` is one of the running services; on a dev-only stack with no deployment, it falls back to the dev container).

- `-f, --follow` — follow log output as it is written.
- `-n, --tail <lines>` — show only the last N lines.
- `--since <duration>` — show logs since a relative time (e.g. `1h`, `30m`).
- `-c, --color <color>` — target a specific deployment colour (`blue` or `green`).
- `--raw` — stream raw, unfiltered log output (no classification).

`tale backup` — snapshot all data volumes into the project backups volume. No arguments.

`tale restore [snapshot-id]` — restore a snapshot; omit the id to list available snapshots.

- `--stop` — stop running project containers before restoring.
- `-y, --yes` — skip the confirmation prompt.

`tale rollback` — roll back to the previous patch version (patch-level only). Prompts for confirmation before it touches anything.

- `-y, --yes` — skip the confirmation prompt (required when running non-interactively).

### Maintain

`tale update` — move this Tale instance to a new version: update the CLI binary, then sync project files to that version's templates. Run `tale deploy` afterwards to roll the containers. The CLI also self-aligns to the instance version on every command, so this is only needed to deliberately change versions.

- `-v, --version <version>` — update to this exact version (e.g. `0.9.0`) instead of the latest; allows downgrades.
- `-f, --force` — force re-sync and overwrite locally modified project files.
- `--dry-run` — show what would change without modifying anything.

`tale migrate` — re-provision the built-in defaults for every organization against the running deployment — the same idempotent step every deploy runs, on demand. Schema migrations are not a command: the backend applies them at boot, so a deployed container is always at its own schema.

- `--dry-run` — show what would run without executing it.

`tale cleanup` — remove inactive (non-current colour) containers. No arguments.

`tale reset` — remove all blue-green containers.

- `-f, --force` — skip the confirmation prompt.
- `-a, --all` — also remove the stateful infrastructure containers.
- `--dry-run` — preview the reset without making changes.

`tale uninstall` — remove the `tale` CLI binary from this system. It prompts before deleting anything and _offers_ to also remove the per-user config (`~/.tale-daemon`) and tear down a project's Docker resources and files. Without `--purge`, a project and its containers are left intact — run `tale reset --all` inside one to remove those.

- `-f, --force` — skip the confirmation prompt (removes the binary only; the optional cleanups still need `--purge`).
- `--purge` — also remove `~/.tale-daemon` and, for a project found from the current directory, tear down its Docker resources and delete its files. Irreversible.
- `--dry-run` — show what would be removed without removing anything.

`tale config` — manage CLI configuration. Use the `show` subcommand to print the resolved config.

### Advanced

`tale auth reset-owner` — reset the owner account credentials.

- `-e, --email <email>` — set a new owner email address.
- `-p, --password <password>` — set a new owner password.

## Troubleshooting

- **`tale deploy` targets the wrong machine.** The CLI uses your shell's Docker context / `DOCKER_HOST`. Switch with `docker context use …` (or set `DOCKER_HOST`) so it points at the intended host, then re-run.
- **`tale deploy` uses the wrong host alias.** The host the proxy answers on comes from `HOST` in the project's `.env`, not a separate CLI store. Edit `.env` or pass `--host` to override it for one run.
- **Installer fails on macOS because the binary cannot execute.** When the freshly installed binary refuses to run (e.g. Gatekeeper kills it), the installer fails with recovery hints instead of reporting success — follow them, then re-run the installer.
- **`tale` not found after install on Linux.** The installer drops the binary in `/usr/local/bin`; verify the directory is on the user's `PATH` (`echo $PATH`).

## Where this gets used

Once the CLI is wired up, the operator's daily surface shrinks to a handful of subcommands. The pages worth reading next depend on what you came to do — [Upgrades](/self-hosted/operate/upgrades) for version bumps, [Backups and restore](/self-hosted/operate/backups-and-restore) for snapshot drills, [Container architecture](/self-hosted/operate/container-architecture) for what the CLI restarts when it deploys.
