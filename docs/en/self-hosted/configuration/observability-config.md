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

Stop following with `Ctrl-C`; the containers keep running. Look at `backend-api` for requests, authentication, and interactive chat generation; use `backend-worker` for background jobs, queued agent turns, and ingestion. Use `docker compose ps` to find a container that is restarting.

`journalctl -u docker` shows the Docker daemon’s journal. With the default `json-file` driver, it does not replace container logs. If you use journald or a log aggregator, configure the Docker logging driver and collection separately. Tale does not include a log shipper. Changing a logging driver requires recreating the affected containers.

## Enable authenticated metrics {#metrics}

Set a strong `METRICS_BEARER_TOKEN` in the deployment environment and apply the change by recreating the affected services through your deployment workflow. A simple container restart does not reload Compose environment values. Store the same token in your monitoring system’s secret store.

The proxy requires `Authorization: Bearer <token>` for these routes. Without a configured token, requests receive **401**.

| Route | Content | How to use it |
| --- | --- | --- |
| `/metrics/platform` | Web-tier process metrics and response-time targets | Prometheus scrape target |
| `/metrics/backend` | Backend HTTP and process metrics, queue depth, active generations and drain state | Prometheus scrape target |
| `/metrics/sla-rules` | Generated recording and alerting rules in YAML | Load as a Prometheus rules file |

The backend serves knowledge requests and runs ingestion jobs. Its HTTP and queue metrics help detect failures and backlog; they are not dedicated measurements of retrieval or generation latency. `BACKEND_UPSTREAM` selects the backend target for a split deployment. It does not create a separate knowledge metrics service.

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

Do not scrape `/metrics/sla-rules` as metrics. The generated rules reference latency series that need additional instrumentation; loading the file alone does not measure response-time compliance. Review them before loading through Prometheus’s rule configuration; [Prometheus and Grafana](/self-hosted/operate/observability/prometheus-grafana) covers the full setup.

## Choose where errors go

`SENTRY_DSN` enables optional error reporting. It can point to Sentry or a compatible service such as GlitchTip or Bugsink. Both the browser and backend use the DSN; backend events carry the process role and release version.

```bash
SENTRY_DSN=https://your-key@your-sentry-host/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
```

The trace sample rate applies to browser performance traces. The backend sends errors, not performance traces. Browser traces default to 1.0 in development; choose a production sample rate that fits your monitoring budget. Stack frames are sent without redaction, so choose the destination according to your data-handling requirements.

## Aggregate analytics with Umami

Aggregate traffic collection is disabled by default and enabled separately for each deployment. Set `UMAMI_URL`, `UMAMI_WEBSITE_ID` and `UMAMI_PROXY_TOKEN` as described in the [environment reference](/self-hosted/configuration/environment-reference). Use a separate website ID for each deployment. Apply environment changes by recreating the affected production service; no image rebuild is needed. Clear the website ID and apply the change to disable collection. The Vite development server does not inject this configuration.

The browser loads the Umami tracker from its own origin at `/_a/script.js` and sends curated events to `/_a/api/send`. A configured base path prefixes these URLs. Only the website ID and proxy path enter the browser configuration; the collector origin and bearer token stay on the server.

`UMAMI_URL` must point to a collector gateway that authenticates `GET /_collect/script.js` and `POST /_collect/api/send` with that bearer token. A stock Umami dashboard URL alone does not provide this gateway contract. Caddy must overwrite `X-Analytics-Client-IP` from a trusted client address. Keep application ports private, and configure trusted proxy ranges when another proxy sits in front. The server forwards the validated IP, browser User-Agent and required Umami headers; it drops browser cookies, credentials and referrer headers.

Reports contain known public page paths or private platform route templates, referrer origins, browser language, screen size, browser/OS/device information and approximate location. The collector derives visits and location from the IP without storing the raw address. Private organization and resource IDs become placeholders. Page titles, query strings, fragments, form fields and product content are excluded. The marketing site also counts completed contact and demo submissions without their contents. There is no cross-site identity, automatic click capture or session replay. Do Not Track and Global Privacy Control disable collection.

After rollout, verify the behavior with a browser that permits analytics:

1. Open a known page, navigate to another page and confirm both pageviews in the deployment’s Umami website.
2. Inspect the request body. Private routes contain placeholders; query strings, titles and form data are absent.
3. Enable Do Not Track or Global Privacy Control and confirm that collection stops.
4. Block the collector or test with it unavailable. Normal navigation must continue to work.

## Know the limits

Tale does not currently export OpenTelemetry traces through OTLP. An OpenTelemetry Collector can collect the Prometheus metrics, but scraping metrics does not produce distributed traces. End-to-end trace export needs application instrumentation as well as a collector.

For alert thresholds and response procedures, continue with [Operations](/self-hosted/operate/observability/operations). For a failing service, use the symptom tables in [Troubleshooting](/self-hosted/operate/observability/troubleshooting).
