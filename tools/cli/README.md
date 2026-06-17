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

# Also update stateful services
tale deploy --all

# Deploy specific services only (in-place update)
tale deploy --services platform,rag

# Dry run to preview changes
tale deploy --dry-run
```

The deployed version always matches the running CLI's version. To move
to a newer version, run `tale upgrade` first, then `tale deploy`.

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

# Remove ALL blue-green containers (requires confirmation)
tale reset --force

# Also remove stateful services
tale reset --force --all
```

## Command Reference

### `tale deploy`

Deploy the current CLI version with the blue-green strategy. The deployed
platform version always matches the running CLI; to upgrade, run
`tale upgrade` first.

| Option                  | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `-a, --all`             | Also update infrastructure (db, proxy)                        |
| `-s, --services <list>` | Specific services to update (comma-separated)                 |
| `--dry-run`             | Preview deployment without making changes                     |
| `--skip-backup`         | Skip the automatic pre-deploy volume snapshot (logged loudly) |
| `--host <hostname>`     | Host alias for proxy (default: `tale.local` or `$HOST`)       |

### `tale status`

Show current deployment status including active color, running containers, and health.

### `tale logs <service>`

View logs from a service.

| Option                | Description                              |
| --------------------- | ---------------------------------------- |
| `-c, --color <color>` | Deployment color (blue or green)         |
| `-f, --follow`        | Follow log output                        |
| `--since <duration>`  | Show logs since duration (e.g., 1h, 30m) |
| `-n, --tail <lines>`  | Number of lines to show from end         |

### `tale backup`

Snapshot all data volumes (db-data, convex-data, rag-data, crawler-data,
caddy-data, caddy-config) into the project-scoped `backups` volume. The same
snapshot is taken automatically before any deploy step that can migrate
data. Containers using a volume are paused for the seconds the tar takes so
the archive is crash-consistent.

### `tale restore`

List snapshots, or restore one into the data volumes. Restoring verifies
the sha256 sidecars first, refuses while any project container is running,
and asks for confirmation. After a restore, redeploy the version recorded
in the snapshot (`tale upgrade --version <version> && tale deploy --all`).

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

| Option      | Description                            |
| ----------- | -------------------------------------- |
| `--force`   | Required to confirm reset              |
| `-a, --all` | Also remove infrastructure (db, proxy) |
| `--dry-run` | Preview reset without making changes   |

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
| `PROJECT_NAME`         | Docker project name                                     | `tale`                      |
| `HOST`                 | Host alias for proxy                                    | `tale.local`                |
| `TALE_DAEMON_API_KEY`  | `tale daemon` API key (keeps it out of the config file) | _(unset)_                   |
| `TALE_DAEMON_HOME`     | Override the `tale daemon` config directory             | `~/.tale-daemon`            |

## Architecture

### Services

**Stateful (single instance):**

- `db` - TimescaleDB (PostgreSQL)
- `proxy` - Caddy reverse proxy

**Rotatable (blue-green):**

- `platform` - TanStack Start + Convex
- `rag` - RAG service
- `crawler` - Crawl4AI web crawler

### Deployment Flow

1. Pull images for new version
2. Deploy new color (blue/green)
3. Wait for health checks
4. Switch traffic (update state file)
5. Drain old color
6. Remove old containers

After successful deployment, the new version is live and the previous color's containers are cleaned up.
