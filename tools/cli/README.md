# Tale CLI

A self-contained CLI tool for managing Tale deployments and services.

## Features

- **Blue-green deployments** - Zero-downtime deployments with automatic rollback capability
- **Secure by default** - Only ports 80/443 exposed, all other ports are internal
- **Single binary** - Easy deployment to any server
- **Extensible** - Modular command structure for future features

## Installation

### Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

### From GitHub Releases

```bash
# Download latest binary
curl -fsSL https://github.com/tale-project/tale/releases/latest/download/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

### Build from Source

```bash
cd tools/cli
bun install
bun run build:linux
# Binary at: dist/tale
```

## Usage

### Deploy Commands

```bash
# Deploy the current CLI version (blue-green, zero-downtime)
tale deploy

# Also update the stop-gated tier (db, proxy) — brief downtime
tale deploy --stop

# Deploy specific services only (in-place update)
tale deploy --services platform

# Dry run to preview changes
tale deploy --dry-run
```

The deployed version always matches the running CLI's version. The CLI keeps
itself aligned to the instance automatically — every command checks the
workspace's recorded version and self-updates the binary to match. To move to a
new version, run `tale update` (updates the CLI + syncs project files), then
`tale deploy` to roll the containers.

### Management Commands

```bash
# Show current deployment status
tale status

# View service logs
tale logs platform
tale logs platform --follow
tale logs db --tail 100

# Snapshot all data volumes (also taken automatically before migrating deploys)
tale backup

# List snapshots / restore one (stack must be stopped; --stop stops it)
tale restore
tale restore <snapshot-id> --stop

# Roll back to the previous patch version (minor/major recovery = tale restore)
tale rollback

# Remove inactive (non-current) color containers
tale cleanup

# Remove ALL blue-green containers (prompts unless --force)
tale reset --force

# Also remove stateful services
tale reset --force --all
```

## Command Reference

### `tale deploy`

Deploy the current CLI version with the blue-green strategy. The deployed
platform version always matches the running CLI. To move to a different version,
use `tale update` first (updates the CLI + syncs project files), then `tale
deploy` to roll the containers.

| Option                  | Description                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `--stop`                | Also update the stop-gated tier (db, proxy) — brief downtime                                                  |
| `-s, --services <list>` | Specific services to update (comma-separated)                                                                 |
| `--override`            | Overwrite container config from the host workspace (encrypted `*.secrets.json` and `.history/` are preserved) |
| `--override-all`        | Factory-reseed the builtin catalog into ALL orgs server-side; implies `--stop`                                |
| `-q, --quiet`           | Suppress container logs during deployment                                                                     |
| `-y, --yes`             | Non-interactive: auto-accept destructive confirmation prompts (e.g. `--override-all`)                         |
| `--dry-run`             | Preview deployment without making changes                                                                     |
| `--skip-backup`         | Skip the automatic pre-deploy volume snapshot (logged loudly)                                                 |
| `--host <hostname>`     | Host alias for proxy (default: `localhost` or `$HOST`)                                                        |

### `tale update`

Move the CLI and your on-disk project files to a new version. Updates the CLI
binary first, then syncs the project files to that version's templates. It does
**not** roll the containers — run `tale deploy` afterwards for that. If the file
sync fails, the CLI is rolled back to the workspace's previous version so the
binary and `tale.json` never drift apart. With no `--version`, targets the
latest release **in the current x.y release line** (a 0.3.x CLI moves to the
newest 0.3.x). Line upgrades (e.g. 0.3.x → 0.4.0) can be breaking, so they
never happen implicitly: when a newer line exists the command says so and
stays put; move lines deliberately with `--version`.

The CLI also self-aligns to the instance version on every command, so you rarely
run `tale update` except to deliberately move versions.

| Option                | Description                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `-v, --version <ver>` | Update to this exact version instead of the in-line latest (allows downgrade and line changes) |
| `-f, --force`         | Force re-sync of locally modified project files                                                |
| `--dry-run`           | Preview the version change and file sync without modifying                                     |

### `tale status`

Show current deployment status including active color, running containers, and health.

### `tale logs <service>`

View logs from a service.

| Option                | Description                                           |
| --------------------- | ----------------------------------------------------- |
| `-c, --color <color>` | Deployment color (blue or green)                      |
| `-f, --follow`        | Follow log output                                     |
| `--since <duration>`  | Show logs since duration (e.g., 1h, 30m)              |
| `-n, --tail <lines>`  | Number of lines to show from end                      |
| `--raw`               | Stream raw, unfiltered log output (no classification) |

### `tale backup`

Snapshot all data volumes (db-data, convex-data, caddy-data, caddy-config)
into the project-scoped `backups` volume. The same
snapshot is taken automatically before any deploy step that can migrate
data. Containers using a volume are paused for the seconds the tar takes so
the archive is crash-consistent.

### `tale restore`

List snapshots, or restore one into the data volumes. Restoring verifies
the sha256 sidecars first, refuses while any project container is running,
and asks for confirmation. After a restore, redeploy the version recorded
in the snapshot (`tale update --version <version>` then `tale deploy --stop`).

| Option      | Description                                      |
| ----------- | ------------------------------------------------ |
| `--stop`    | Stop running project containers before restoring |
| `-y, --yes` | Non-interactive: skip the confirmation prompt    |

### `tale rollback`

Roll back to the recorded previous version. Gated to patch-level steps
(the target must share `major.minor` with the running platform) — minor
and major upgrades can run forward-only migrations, and their recovery
path is `tale restore` plus a redeploy of the matching version.

### `tale cleanup`

Remove inactive (non-current) color containers.

### `tale reset`

Remove ALL blue-green containers.

| Option        | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `-f, --force` | Skip the confirmation prompt                                    |
| `-a, --all`   | Also remove stateful services (db, proxy, convex, sandbox tier) |
| `--dry-run`   | Preview reset without making changes                            |

### `tale daemon`

Run Tale board tasks on this machine with the coding-agent CLIs you already use
(**Claude Code**, **Codex**, **OpenCode**, auto-detected on PATH). Agents bound
to an external runtime get their tasks dispatched here instead of Tale's internal
LLM loop; each run executes in an isolated git worktree and reports back as a task
comment, parking the task at **In review**. Nothing is ever pushed. The effective
permission is `min(server-configured, local ceiling)` — `safe` by default.

```bash
tale daemon setup    # base URL, API key, workspace, permission ceiling
tale daemon start    # register + claim loop (Ctrl-C drains the current run)
tale daemon status   # config, detected CLIs, server connectivity
```

Any `setup` answer can be passed as a flag (`--url`, `--key`, `--name`,
`--workspace`, `--workspace-key`, `--ceiling`) to skip its prompt; add `--yes`
to run unattended. This is what the **Generate key & copy command** button under
**Settings → API → Runtimes** produces:

```bash
tale daemon setup --yes --url https://your-org.tale.dev --key <api-key>
tale daemon start
```

Config lives at `~/.tale-daemon/config.json` (chmod 600). Set
`TALE_DAEMON_API_KEY` to keep the key out of the file.

## Environment Variables

| Variable               | Description                                             | Default                     |
| ---------------------- | ------------------------------------------------------- | --------------------------- |
| `GHCR_REGISTRY`        | Container registry                                      | `ghcr.io/tale-project/tale` |
| `HEALTH_CHECK_TIMEOUT` | Health check timeout (seconds)                          | `300`                       |
| `DRAIN_TIMEOUT`        | Connection drain timeout (seconds)                      | `30`                        |
| `BACKUP_KEEP_COUNT`    | Snapshots kept regardless of age                        | `5`                         |
| `BACKUP_KEEP_DAYS`     | Days a snapshot is kept regardless of count             | `14`                        |
| `HOST`                 | Host alias for proxy                                    | `localhost`                 |
| `TALE_DAEMON_API_KEY`  | `tale daemon` API key (keeps it out of the config file) | _(unset)_                   |
| `TALE_DAEMON_HOME`     | Override the `tale daemon` config directory             | `~/.tale-daemon`            |

## Architecture

### Services

**Stop-gated (only updated with `tale deploy --stop`):**

- `db` - TimescaleDB (PostgreSQL)
- `proxy` - Caddy reverse proxy

**Rolled in place on every deploy:**

- `convex` - Convex backend (owns the single `convex-data` volume)
- `sandbox` / `sandbox-egress` - sandbox tier (drained before rolling)
- `sandbox-llm-gateway` - LLM gateway for sandbox harnesses

**Rotatable (blue-green):**

- `platform` - the Tale app (TanStack Start)

### Deployment Flow

1. Pull images for new version
2. Deploy new color (blue/green)
3. Wait for health checks
4. Switch traffic (update state file)
5. Drain old color
6. Remove old containers

After successful deployment, the new version is live and the previous color's containers are cleaned up.
