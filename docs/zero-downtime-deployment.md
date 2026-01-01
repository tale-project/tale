# Zero-Downtime Deployment

This guide covers blue-green deployment for production environments where downtime is not acceptable.

> **Looking for simple deployment?** See the main [README](../README.md) for standard Docker Compose deployment.

## Overview

Blue-green deployment runs two versions of stateless services simultaneously:

1. **Blue** and **Green** environments alternate as active/standby
2. New version starts alongside the current one
3. Traffic switches only after health checks pass
4. Old version is drained and removed

**Stateful services** (database, proxy) are shared between environments and are not affected by deployments.

## Requirements

- Docker and Docker Compose
- At least **12-16 GB RAM** (runs 2x services during deployment)
- Services must respond to health checks within 3 minutes

## Quick Start

```bash
# Deploy new version (zero-downtime)
./scripts/deploy.sh deploy

# Check current status
./scripts/deploy.sh status

# Rollback to previous version
./scripts/deploy.sh rollback

# Clean up inactive containers
./scripts/deploy.sh cleanup
```

## Commands

| Command | Description |
|---------|-------------|
| `deploy` | Build and deploy a new version with zero downtime |
| `status` | Show current deployment status and health |
| `rollback` | Revert to the previous version |
| `cleanup` | Remove inactive containers |
| `help` | Show usage information |

## Configuration

Environment variables to customize deployment:

| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_CHECK_TIMEOUT` | 180s | Max time to wait for health checks |
| `HEALTH_CHECK_INTERVAL` | 3s | Interval between health checks |
| `DRAIN_TIMEOUT` | 30s | Time to drain old containers before removal |

Example with custom timeout:

```bash
HEALTH_CHECK_TIMEOUT=300 ./scripts/deploy.sh deploy
```

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Caddy Proxy                          │
│              (Routes traffic to healthy backend)             │
└─────────────────────────┬───────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
┌───────────────────┐               ┌───────────────────┐
│   Blue Services   │               │  Green Services   │
│    (Active)       │               │   (Standby)       │
├───────────────────┤               ├───────────────────┤
│ platform-blue     │               │ platform-green    │
│ rag-blue          │               │ rag-green         │
│ crawler-blue      │               │ crawler-green     │
│ search-blue       │               │ search-green      │
│ graph-db-blue     │               │ graph-db-green    │
└───────────────────┘               └───────────────────┘
        │                                   │
        └─────────────────┬─────────────────┘
                          ▼
              ┌───────────────────┐
              │  Shared Services  │
              │   (Stateful)      │
              ├───────────────────┤
              │ db (TimescaleDB)  │
              │ proxy (Caddy)     │
              └───────────────────┘
```

### Deployment Flow

1. **Detect current state** - Determine which color (blue/green) is currently active
2. **Build new version** - Build containers for the opposite color
3. **Start new version** - Run the new containers alongside existing ones
4. **Health checks** - Wait for all new services to report healthy
5. **Traffic switch** - Caddy automatically routes to healthy backends
6. **Drain old version** - Wait for in-flight requests to complete
7. **Cleanup** - Remove old containers

### Files

| File | Purpose |
|------|---------|
| `compose.yml` | Base configuration for all services |
| `compose.blue.yml` | Blue environment overlay (container names, network aliases) |
| `compose.green.yml` | Green environment overlay |
| `scripts/deploy.sh` | Deployment automation script |
| `.deployment-color` | Tracks current active deployment (auto-generated) |

## Database Migrations

Database changes require special handling since the database is shared between blue and green environments. Both old and new versions of the application must work with the database during the transition period.

### Guidelines

1. **Backward-compatible migrations only** - New code must work with old schema, old code must work with new schema
2. **Expand-contract pattern** - Split breaking changes into multiple deployments:
   - **Deploy 1 (Expand)**: Add new columns/tables, keep old ones
   - **Deploy 2 (Migrate)**: Application uses new structure
   - **Deploy 3 (Contract)**: Remove old columns/tables after confirming success

### Examples

| Change | Safe Approach |
|--------|---------------|
| Add column | Add as nullable or with default value |
| Remove column | First deploy code that stops using it, then remove |
| Rename column | Add new column → migrate data → update code → remove old |
| Change type | Add new column with new type → migrate → update code → remove old |

### Migration Workflow

```bash
# 1. Run migrations BEFORE deploying new code
npm run db:migrate  # or your migration command

# 2. Deploy new version
./scripts/deploy.sh deploy

# 3. Verify everything works

# 4. (Later) Run cleanup migrations if needed
npm run db:migrate:cleanup
```

### Non-Backward-Compatible Changes

If a migration cannot be made backward-compatible:

1. Schedule a maintenance window
2. Use standard deployment with downtime
3. Or coordinate a multi-phase rollout over several deployments

## Rollback

If a deployment fails or you need to revert:

```bash
./scripts/deploy.sh rollback
```

Rollback restarts containers from the previous deployment. It works best immediately after a failed deployment when the previous containers still exist.

For a fresh deployment after cleanup:

```bash
./scripts/deploy.sh deploy
```

## Troubleshooting

### Health checks timing out

```bash
# Increase timeout
HEALTH_CHECK_TIMEOUT=300 ./scripts/deploy.sh deploy

# Check container logs
docker logs tale-platform-blue
docker logs tale-platform-green
```

### Deployment failed

```bash
# Clean up failed deployment
./scripts/deploy.sh cleanup

# Try again
./scripts/deploy.sh deploy
```

### Check service health

```bash
# View all container status
docker ps --format "table {{.Names}}\t{{.Status}}"

# Check specific service
docker inspect --format='{{.State.Health.Status}}' tale-platform-blue
```

### Memory issues during deployment

Blue-green deployment temporarily runs 2x services. If you run out of memory:

1. Increase available RAM to at least 12-16 GB
2. Or use standard deployment instead (with brief downtime)

## When to Use

| Scenario | Recommendation |
|----------|----------------|
| Development / Testing | Standard deployment |
| Low traffic, scheduled maintenance OK | Standard deployment |
| Production, zero-downtime required | Blue-green deployment |
| High availability requirements | Blue-green deployment |
| Limited server resources (<12 GB RAM) | Standard deployment |
