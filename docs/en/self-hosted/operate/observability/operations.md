---
title: Operations
description: Monitoring, error tracking, logs, database backups, health checks, and container validation.
---

Operations is everything that happens after Tale is running — the metrics you scrape, the logs you ship, the backups you take, the health probes you alert on. This page is the index for operators living with a production instance day to day: what each service exposes, how to wire it into a Prometheus and a log-aggregator stack, and the validation steps that prove a deploy is actually healthy.

The defaults are sane enough that a fresh install is operable on day one. The work documented below is what you tune once you have traffic worth protecting.

## Monitoring

Every Tale service exposes a Prometheus text-format `/metrics` endpoint on the internal Docker network. The endpoints are useful for the platform's own service-to-service health checks even when nothing external scrapes them; to expose them through the proxy for an external Prometheus, set a bearer token in `.env`:

```dotenv
METRICS_BEARER_TOKEN=your-secret-token-here
```

The metrics surfaces then answer on the public URL behind the proxy:

| Service        | Metrics endpoint                          |
| -------------- | ----------------------------------------- |
| Crawler        | `https://yourdomain.com/metrics/crawler`  |
| RAG            | `https://yourdomain.com/metrics/rag`      |
| Platform (Bun) | `https://yourdomain.com/metrics/platform` |
| Convex         | `https://yourdomain.com/metrics/convex`   |

The Convex backend exposes over 260 built-in metrics covering query latency, mutation throughput, scheduler queue depth, and per-function call counts. When the bearer token is unset, every `/metrics/*` endpoint returns `401` — that's intentional, because the metrics carry enough operational detail to be worth gating.

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

  # Repeat for tale-rag, tale-platform, tale-convex — only metrics_path changes.
```

The four `job_name` blocks differ only in the `metrics_path` and `job_name` strings, so most operators paste the same config four times with one line changed.

## Error tracking

Tale's error pipeline speaks the Sentry DSN format. Self-hosted Sentry, GlitchTip, and Bugsink all accept the same DSN shape, so any of them works as a drop-in replacement. Set the DSN in `.env`:

```dotenv
SENTRY_DSN=https://your-key@your-sentry-host/project-id
```

With `SENTRY_DSN` unset, error tracking is off and errors only surface in Docker logs. The `SENTRY_TRACES_SAMPLE_RATE` variable controls the fraction of transactions sent for performance tracing; the default of `1.0` (every transaction) is fine for low-traffic instances, and you'd lower it on a busy production deployment.

## Logs

All service logs go to Docker stdout. The compose file caps every container at 10 MB per log file with three rotated files retained, so a misbehaving service can't fill the disk overnight.

```bash
# Stream every service's log.
docker compose logs -f

# Stream one service.
docker compose logs -f rag

# Recent lines without streaming.
docker compose logs --tail=100 platform
```

When the stack is running under `tale deploy`, `tale logs <service>` is the same picture filtered through the active blue-green color — useful when both colors exist briefly during a deploy and you only want the new one.

## Database backups

The bundled `db` container holds every persistent piece of state Tale writes — Convex tables, RAG embeddings, crawler URLs, audit log, the lot. Take a snapshot with `pg_dump` inside the container:

```bash
docker exec tale-db pg_dump -U tale tale > backup-$(date +%Y%m%d).sql
```

The restore is the inverse:

```bash
docker exec -i tale-db psql -U tale tale < backup-20260101.sql
```

For production, schedule the dump through cron and ship the file off the host. The `db-backup` named volume mounted at `/var/lib/postgresql/backup` is the staging area for off-host shipping; the bundled compose mounts it but does not write to it automatically.

## Health checks

Each service answers a health endpoint that's also what the proxy and Docker's own healthcheck poll:

| Endpoint                       | What it checks                                                |
| ------------------------------ | ------------------------------------------------------------- |
| `GET /health`                  | The proxy is running and listening.                           |
| `GET /api/health`              | The platform is up and Convex is reachable from inside.       |
| `http://localhost:8001/health` | RAG is running and the database pool is connected.            |
| `http://localhost:8002/health` | The crawler is running and the browser engine is initialised. |

The platform endpoint is the most useful single check during a deploy because it exercises the full chain — Bun answering, Convex reachable, the readiness file written by the entrypoint after env sync.

## Container health validation

Two scripts validate a fresh build before you push it to production. Both run in CI on every pull request and both are safe to run on a development host.

```bash
bun run docker:test
```

This builds every image, starts every container on non-conflicting ports (the test compose file uses the `13000+` range), validates the health endpoints, exercises inter-service connectivity, and tears down. It's the closest thing to a real production deploy that fits on a laptop.

For image-level validation — OCI labels, no secrets in layers, size budgets, non-root user, HEALTHCHECK instruction:

```bash
bun run docker:test:image
```

Both scripts are documented in detail on the [Contributing Docker guide](/develop/contributing-docker).

## Image size monitoring

Every container image has a size budget enforced by CI. The current sizes and budgets:

| Service  | Current size | Budget |
| -------- | ------------ | ------ |
| Crawler  | ~1.85 GB     | 2.1 GB |
| RAG      | ~515 MB      | 600 MB |
| Platform | ~320 MB      | 400 MB |
| Convex   | ~485 MB      | 600 MB |
| DB       | ~1.06 GB     | 1.2 GB |
| Proxy    | ~88 MB       | 100 MB |

A change that pushes an image over its budget fails `bun run docker:test:image`. The [Container architecture](/self-hosted/operate/container-architecture) page covers the multi-stage build strategies that keep each image inside its budget.

## Where this fits

Operations is the day-to-day surface for the operator running Tale in production — metrics to scrape, logs to ship, health probes to monitor, image budgets to enforce. When something starts going wrong on a live instance, [Troubleshooting](/self-hosted/operate/observability/troubleshooting) is the symptom-to-fix map; for the architectural model behind the services emitting those metrics, [Container architecture](/self-hosted/operate/container-architecture) is one click away.
