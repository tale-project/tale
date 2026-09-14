---
title: Observability configuration
description: Collect container logs, scrape authenticated metrics and choose where errors are reported.
---
Start with container logs and dependency health. Add Prometheus metrics for trends and alerts, and configure error reporting if you need a searchable history of failures. Tale does not send these signals to an external monitoring service unless you configure one.

## Read the application logs

Containers write logs to stdout and stderr. The shipped Compose configuration uses Docker’s `json-file` logging driver with rotation at 10 MB per file and three files per container. Use the service names from your deployment’s Compose file:

```bash
docker compose logs --tail=100 backend-api backend-worker
docker compose logs -f backend-api
```

Stop following with `Ctrl-C`; the containers keep running. Look at `backend-api` for request and authentication failures, and `backend-worker` for background jobs, chat generation and ingestion. Use `docker compose ps` to find a container that is restarting.

`journalctl -u docker` shows the Docker daemon’s journal. With the default `json-file` driver, it does not replace container logs. If you use journald or a log aggregator, configure the Docker logging driver and collection separately. Tale does not include a log shipper. Changing a logging driver requires recreating the affected containers.

## Enable authenticated metrics

Set a strong `METRICS_BEARER_TOKEN` in the deployment environment and apply the change by recreating the affected services through your deployment workflow. A simple container restart does not reload Compose environment values. Store the same token in your monitoring system’s secret store.

The proxy requires `Authorization: Bearer <token>` for these routes. Without a configured token, requests receive **401**.

| Route | Content | How to use it |
| --- | --- | --- |
| `/metrics/platform` | Web-tier HTTP and process metrics, response-time targets | Prometheus scrape target |
| `/metrics/backend` | Backend HTTP and process metrics, queue depth, active generations and drain state | Prometheus scrape target |
| `/metrics/sla-rules` | Generated recording and alerting rules in YAML | Load as a Prometheus rules file |

Knowledge ingestion and search run in the backend worker. Their measurements are part of the backend metrics. `BACKEND_UPSTREAM` selects the backend for a split deployment; it does not enable a separate knowledge metrics service.

Use a separate scrape job for each metrics route. In this example, `/run/secrets/tale_metrics_token` is a file inside the Prometheus container containing only the token. Create it through your secret-management system and grant Prometheus read access.

```yaml
scrape_configs:
  - job_name: tale-platform
    scheme: https
    metrics_path: /metrics/platform
    authorization:
      credentials_file: /run/secrets/tale_metrics_token
    static_configs:
      - targets: ['tale.example.com']
  - job_name: tale-backend
    scheme: https
    metrics_path: /metrics/backend
    authorization:
      credentials_file: /run/secrets/tale_metrics_token
    static_configs:
      - targets: ['tale.example.com']
```

Do not scrape `/metrics/sla-rules` as metrics. Load its YAML through Prometheus’s rule configuration; [Prometheus and Grafana](/self-hosted/operate/observability/prometheus-grafana) covers the full setup.

## Choose where errors go

`SENTRY_DSN` enables optional error reporting. It can point to Sentry or a compatible service such as GlitchTip or Bugsink. Both the browser and backend use the DSN; backend events carry the process role and release version.

```bash
SENTRY_DSN=https://your-key@your-sentry-host/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
```

The trace sample rate applies to browser performance traces. The backend sends errors, not performance traces. Browser traces default to 1.0 in development; choose a production sample rate that fits your monitoring budget. Stack frames are sent without redaction, so choose the destination according to your data-handling requirements.

## Know the limits

Tale does not currently export OpenTelemetry traces through OTLP. An OpenTelemetry Collector can collect the Prometheus metrics, but scraping metrics does not produce distributed traces. End-to-end trace export needs application instrumentation as well as a collector.

For alert thresholds and response procedures, continue with [Operations](/self-hosted/operate/observability/operations). For a failing service, use the symptom tables in [Troubleshooting](/self-hosted/operate/observability/troubleshooting).
