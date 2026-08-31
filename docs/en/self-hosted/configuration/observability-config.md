---
title: Observability config
description: The env vars and flags that turn on logs, metrics, and error tracking — and what each one routes where.
---

Tale ships three observability seams: stdout logs from every container, Prometheus-format metrics behind a bearer token, and optional Sentry error reporting. The defaults are loud enough to spot a crash and quiet enough to fit in a single host's journald; the production knobs below add the structured paths your existing monitoring stack can scrape. None of the three send anything off-host unless you configure them to.

This page covers the server-side switches. The operator-facing alert playbook lives in [Operations](/self-hosted/operate/observability/operations), and the symptom-first lookup in [Troubleshooting](/self-hosted/operate/observability/troubleshooting).

## Logs

Every container writes structured JSON or console logs to stdout, captured by Docker's default `json-file` driver with a 10 MB-per-file, 3-file rotation. The log destination is a function of how you deploy:

- Single host with journald — `journalctl -u docker` carries the lot.
- Single host without journald — `docker compose logs -f <service>` for live tailing.
- Aggregator (Loki, Vector, Fluent Bit) — point the Docker logging driver at it via `daemon.json`.

Tale does not ship a log shipper. The driver swap is the supported connector point.

## Metrics

The Caddy proxy exposes up to four metrics paths gated by a single bearer token:

| Path                 | Source          | What's inside                                                                       |
| -------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `/metrics/platform`  | `tale-platform` | HTTP latency, route counters, Node process metrics, response-time SLA target gauges |
| `/metrics/convex`    | `tale-convex`   | 261 built-in Convex metrics, plus the RAG and crawl timings                         |
| `/metrics/sla-rules` | `tale-platform` | Generated Prometheus recording + alerting rules for the response-time SLAs          |
| `/metrics/backend`   | `tale-backend-api` | Process metrics, HTTP counters and latency by route class, queue depth per job state, in-flight chat generations, open hint streams, drain state, and the same SLA target gauges |

Knowledge work (RAG search, document ingestion, web crawling) runs inside the Convex backend now, so its timings ride the `/metrics/convex` series rather than a separate endpoint. Set `METRICS_BEARER_TOKEN` in `.env` to enable these endpoints; leave it unset to keep them returning 401 to every request. The `/metrics/sla-rules` path is a read-only YAML rules file you load into Prometheus, not a scrape target — the thresholds it carries are documented in [Operations](/self-hosted/operate/observability/operations). Anything other than the listed paths returns 401 too, so a misrouted scraper does not accidentally see the platform's internal health endpoints.

`/metrics/backend` appears only once a deployment has cut over to the Postgres backend (`BACKEND_UPSTREAM` set in `.env`). Before that the path answers 404 rather than quietly serving another service's numbers under the backend's name, so a scrape target you add early fails loudly instead of charting the wrong process.

A working Prometheus scrape stanza:

```yaml
scrape_configs:
  - job_name: tale-platform
    scheme: https
    metrics_path: /metrics/platform
    authorization:
      credentials: <METRICS_BEARER_TOKEN>
    static_configs:
      - targets: ['tale.example.com']
```

Duplicate the stanza per path, or use a single job with `relabel_configs` if you prefer.

## Error tracking with Sentry

Sentry is opt-in via `SENTRY_DSN`. Self-hosted GlitchTip and Bugsink work too, since they speak the same DSN format. One DSN covers both sides of the stack: the browser app reports front-end errors, and the `backend-api` / `backend-worker` containers report server-side ones — crashed requests, failed background jobs, and boot failures — tagged with the process role (`tale.role`) and the release version.

```bash
# .env
SENTRY_DSN=https://your-key@your-sentry-host/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
```

The sample rate caps browser performance traces and applies only there — the backend reports errors, never traces. Leave it unset for the default 1.0 in development and tighten it (0.05–0.2) in production. Stack frames are sent unredacted on both sides, so point the DSN at infrastructure you control if your error payloads are sensitive.

## What does not ship yet

OpenTelemetry traces are not built into the containers. The data is reachable indirectly — Convex action durations and HTTP route timings come through the Prometheus metrics — but there is no OTLP exporter on the box today. If you need full trace export, run an OpenTelemetry Collector alongside Tale and scrape the Prometheus endpoints from it.

## Where this fits

The three seams above are the contact points with the rest of your monitoring stack; the alert thresholds and the oncall checklist live in [Operations](/self-hosted/operate/observability/operations). If something is on fire right now and you need the symptom-first index, jump to [Troubleshooting](/self-hosted/operate/observability/troubleshooting).
