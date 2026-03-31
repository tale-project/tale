---
title: Operations
description: Monitoring, error tracking, logs, database backups, and health checks.
---

## Monitoring

All Tale services expose a Prometheus `/metrics` endpoint on the internal Docker network. To enable access from outside, set a bearer token in your `.env` file:

```dotenv
METRICS_BEARER_TOKEN=your-secret-token-here
```

Metrics are then available at these endpoints:

| Service | Metrics endpoint |
| --- | --- |
| Crawler | `https://yourdomain.com/metrics/crawler` |
| RAG | `https://yourdomain.com/metrics/rag` |
| Platform (Bun) | `https://yourdomain.com/metrics/platform` |
| Convex | `https://yourdomain.com/metrics/convex` |

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

| Endpoint | What it checks |
| --- | --- |
| `GET /health` | Proxy is running and listening |
| `GET /api/health` | Platform is up and Convex backend is reachable |
| `http://localhost:8001/health` | RAG service is running and database pool is connected |
| `http://localhost:8002/health` | Crawler service and browser engine are ready |
