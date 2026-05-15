---
title: Operations
description: Monitoring, error tracking, logs, database backups, health checks, and container validation.
---

Operations is everything you need to do _after_ Tale is running: watch it, back it up, prove it's healthy, and recover when something goes wrong. The pages this section anchors are organised around that loop — observe (metrics, logs), preserve (backups, retention), verify (health checks, container validation), and react (advisories, release notes).

The choices below have sane defaults so a fresh install is operable on day one. The work documented here is what you tune once you have traffic worth protecting.

## Monitoring

All Tale services expose a Prometheus `/metrics` endpoint on the internal Docker network. To enable access from outside, set a bearer token in your `.env` file:

```dotenv
METRICS_BEARER_TOKEN=your-secret-token-here
```

Metrics are then available at these endpoints:

| Service        | Metrics endpoint                          |
| -------------- | ----------------------------------------- |
| Crawler        | `https://yourdomain.com/metrics/crawler`  |
| RAG            | `https://yourdomain.com/metrics/rag`      |
| Platform (Bun) | `https://yourdomain.com/metrics/platform` |
| Convex         | `https://yourdomain.com/metrics/convex`   |

> **Note:** The Convex backend exposes over 260 built-in metrics covering query latency, mutation throughput, and scheduler performance.

When the token is unset, all `/metrics/*` endpoints return `401`.

### Prometheus scrape config

```yaml
scrape_configs:
  - job_name: tale-crawler
    scheme: https
    metrics_path: /metrics/crawler
    authorization:
      credentials: your-secret-token-here
    static_configs:
      - targets: ['your-tale-host.com']

  # Repeat for: tale-rag, tale-platform, tale-convex
  # changing metrics_path accordingly
```

## Error tracking

Tale supports Sentry and compatible alternatives such as GlitchTip for error tracking. Set your DSN in `.env`:

```dotenv
SENTRY_DSN=https://your-key@your-sentry-host/project-id
```

If `SENTRY_DSN` is not set, error tracking is off and errors only appear in Docker logs.

## Viewing logs

All service logs go to Docker stdout with automatic rotation at 10 MB per file, keeping 3 files per service.

```bash
# Stream all service logs
docker compose logs -f

# Stream logs for a specific service
docker compose logs -f rag

# View recent logs without streaming
docker compose logs --tail=100 platform
```

## Database backups

To create a database snapshot:

```bash
docker exec tale-db pg_dump -U tale tale > backup-$(date +%Y%m%d).sql
```

To restore from a backup:

```bash
docker exec -i tale-db psql -U tale tale < backup-20260101.sql
```

## Health checks

Each service has a health check endpoint:

| Endpoint                       | What it checks                                        |
| ------------------------------ | ----------------------------------------------------- |
| `GET /health`                  | Proxy is running and listening                        |
| `GET /api/health`              | Platform is up and Convex backend is reachable        |
| `http://localhost:8001/health` | RAG service is running and database pool is connected |
| `http://localhost:8002/health` | Crawler service and browser engine are ready          |

## Container health validation

To validate that all containers are healthy after a deployment or configuration change, run the container smoke test:

```bash
bun run docker:test
```

This builds all images, starts them on non-conflicting ports, validates health endpoints and inter-service connectivity, then tears down. It is the same test that runs in CI on every pull request.

For image-level validation (OCI labels, no secrets, size budgets):

```bash
bun run docker:test:image
```

## Image size monitoring

Each container image has a size budget enforced by CI. Current sizes and budgets:

| Service  | Current size | Budget |
| -------- | ------------ | ------ |
| Crawler  | ~1.85 GB     | 2.1 GB |
| RAG      | ~515 MB      | 600 MB |
| Platform | ~2.58 GB     | 2.9 GB |
| DB       | ~1.06 GB     | 1.2 GB |
| Proxy    | ~88 MB       | 100 MB |

If an image exceeds its budget after a change, `bun run docker:test:image` will fail. See the [container architecture](/self-hosted/operate/container-architecture) page for details on multi-stage build strategies that keep images lean.

## Where this fits

Operations is the day-to-day surface for the operator running Tale in production — metrics to scrape, logs to ship, health probes to monitor, image budgets to enforce. When something starts going wrong on a live instance, [Troubleshooting](/self-hosted/operate/observability/troubleshooting) is the symptom-to-fix map; for the architectural model behind the services emitting those metrics, [Container architecture](/self-hosted/operate/container-architecture) is one click away.
