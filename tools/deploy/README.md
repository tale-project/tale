# Tale Deploy CLI

A self-contained Bun CLI tool for secure blue-green deployments of Tale services.

## Security Features

- **Only ports 80/443 exposed** - All other ports (5432, 6379, 8001-8003) are internal only
- **Inline compose generation** - No external file dependencies
- **Single binary** - Easy deployment to any server

## Installation

### From GitHub Releases

```bash
# Download latest binary
curl -L https://github.com/tale-project/tale/releases/latest/download/tale-deploy-linux \
  -o /usr/local/bin/tale-deploy
chmod +x /usr/local/bin/tale-deploy
```

### Build from Source

```bash
cd tools/deploy
bun install
bun run build:linux
# Binary at: dist/tale-deploy-linux
```

## Usage

### Deploy a New Version

```bash
# Deploy version 1.0.0 (blue-green, zero-downtime)
tale-deploy deploy 1.0.0

# Deploy with stateful services update
tale-deploy deploy 1.0.0 --update-stateful
```

### Rollback

```bash
# Rollback to previous version
tale-deploy rollback
```

### Status

```bash
# Show current deployment status
tale-deploy status
```

### Cleanup

```bash
# Remove inactive (non-current) color containers
tale-deploy cleanup
```

### Reset

```bash
# Remove ALL blue-green containers (requires confirmation)
tale-deploy reset --force

# Also remove stateful services
tale-deploy reset --force --include-stateful
```

## Options

| Option | Description |
|--------|-------------|
| `-d, --dir <path>` | Deployment directory (default: current directory) |
| `--host <hostname>` | Host alias for proxy (default: `tale.local` or `$HOST`) |
| `--update-stateful` | Also update db, graph-db, proxy |
| `--force` | Required for reset command |
| `--include-stateful` | Include stateful services in reset |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GHCR_REGISTRY` | Container registry | `ghcr.io/tale-project/tale` |
| `HEALTH_CHECK_TIMEOUT` | Health check timeout (seconds) | `180` |
| `DRAIN_TIMEOUT` | Connection drain timeout (seconds) | `30` |
| `PROJECT_NAME` | Docker project name | `tale` |
| `HOST` | Host alias for proxy | `tale.local` |

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
- `search` - SearXNG meta search engine

### Deployment Flow

1. Pull images for new version
2. Deploy new color (blue/green)
3. Wait for health checks
4. Switch traffic (update state file)
5. Drain old color
6. Remove old containers
