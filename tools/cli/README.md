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
# Deploy with interactive version selection
tale deploy

# Deploy a specific version (blue-green, zero-downtime)
tale deploy 1.0.0

# Deploy with stateful services update
tale deploy 1.0.0 --all

# Deploy specific services only (in-place update)
tale deploy 1.0.0 --services platform,rag

# Dry run to preview changes
tale deploy 1.0.0 --dry-run
```

### Management Commands

```bash
# Show current deployment status
tale status

# View service logs
tale logs platform
tale logs platform --follow
tale logs db --tail 100

# Rollback to previous version
tale rollback

# Rollback to a specific version
tale rollback --version 0.9.0

# Remove inactive (non-current) color containers
tale cleanup

# Remove ALL blue-green containers (requires confirmation)
tale reset --force

# Also remove stateful services
tale reset --force --all
```

## Command Reference

### `tale deploy [version]`

Deploy a new version with blue-green strategy. If no version is specified, an interactive version selector is shown.

| Option                  | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `-a, --all`             | Also update infrastructure (db, graph-db, proxy)        |
| `-s, --services <list>` | Specific services to update (comma-separated)           |
| `--dry-run`             | Preview deployment without making changes               |
| `-d, --dir <path>`      | Deployment directory (default: current directory)       |
| `--host <hostname>`     | Host alias for proxy (default: `tale.local` or `$HOST`) |

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

### `tale rollback`

Rollback to previous or specific version.

| Option                    | Description                     |
| ------------------------- | ------------------------------- |
| `-v, --version <version>` | Specific version to rollback to |
| `-d, --dir <path>`        | Deployment directory            |

### `tale cleanup`

Remove inactive (non-current) color containers.

### `tale reset`

Remove ALL blue-green containers.

| Option      | Description                                      |
| ----------- | ------------------------------------------------ |
| `--force`   | Required to confirm reset                        |
| `-a, --all` | Also remove infrastructure (db, graph-db, proxy) |
| `--dry-run` | Preview reset without making changes             |

## Environment Variables

| Variable               | Description                        | Default                     |
| ---------------------- | ---------------------------------- | --------------------------- |
| `GHCR_REGISTRY`        | Container registry                 | `ghcr.io/tale-project/tale` |
| `HEALTH_CHECK_TIMEOUT` | Health check timeout (seconds)     | `180`                       |
| `DRAIN_TIMEOUT`        | Connection drain timeout (seconds) | `30`                        |
| `PROJECT_NAME`         | Docker project name                | `tale`                      |
| `HOST`                 | Host alias for proxy               | `tale.local`                |

## Architecture

### Services

**Stateful (single instance):**

- `db` - TimescaleDB (PostgreSQL)
- `graph-db` - FalkorDB (Redis-based graph database)
- `proxy` - Caddy reverse proxy

**Rotatable (blue-green):**

- `platform` - TanStack Start + Convex
- `rag` - RAG service (Cognee)
- `crawler` - Crawl4AI web crawler
- `operator` - Browser automation (Chromium + Playwright)

### Deployment Flow

1. Pull images for new version
2. Deploy new color (blue/green)
3. Wait for health checks
4. Switch traffic (update state file)
5. Drain old color
6. Remove old containers

After successful deployment, the new version is live and the previous color's containers are cleaned up.
