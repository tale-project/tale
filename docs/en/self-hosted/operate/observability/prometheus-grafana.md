---
title: Prometheus and Grafana
description: A copy-paste Prometheus and Grafana stack that scrapes Tale's two metrics endpoints, plus a starter dashboard and a first alert rule.
---

This is the worked example behind [Observability config](/self-hosted/configuration/observability-config): a Prometheus and Grafana pair you can drop next to Tale, pointed at the two bearer-token metrics endpoints, with a starter dashboard and one alert rule to build on. It's for self-hosted operators who have already set `METRICS_BEARER_TOKEN` and now want live graphs instead of a `curl` against `/metrics`.

The config-reference page lists the endpoints and the single scrape stanza; this page stands the whole stack up end to end. Everything here runs on the same host as Tale, so no metric leaves the box.

## Before you start

Set `METRICS_BEARER_TOKEN` in your `.env` and restart the proxy — without it the two endpoints return 401 to every request, and Prometheus will show each target as down. The endpoints, and what each one carries, are the table in [Observability config](/self-hosted/configuration/observability-config#metrics): `/metrics/platform` and `/metrics/backend` (the latter now carries the in-process RAG and crawl timings), both served by `tale-proxy` over the same hostname as the app.

## Add Prometheus and Grafana to your stack

Drop these two services into a compose override next to Tale. Prometheus scrapes on an interval and stores a local TSDB; Grafana reads Prometheus and renders the dashboards. Both bind to localhost only — reach Grafana through an SSH tunnel or put it behind the same proxy with auth, never expose it raw.

```yaml
# docker-compose.metrics.yml — start with: docker compose -f docker-compose.yml -f docker-compose.metrics.yml up -d
services:
  prometheus:
    image: prom/prometheus:v3.1.0
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    ports:
      - '127.0.0.1:9090:9090'
    restart: unless-stopped

  grafana:
    image: grafana/grafana:11.4.0
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?set a strong password}
      GF_USERS_ALLOW_SIGN_UP: 'false'
    volumes:
      - grafana-data:/var/lib/grafana
    ports:
      - '127.0.0.1:3001:3000'
    restart: unless-stopped

volumes:
  prometheus-data:
  grafana-data:
```

## Scrape configuration

Tale's two endpoints share one bearer token, so the scrape config is the published stanza repeated once per path. Save this as `prometheus.yml` next to the override above and substitute your host and token — Prometheus reads the token from the file, so keep it `chmod 600` and out of version control.

```yaml
global:
  scrape_interval: 30s

scrape_configs:
  - job_name: tale-platform
    scheme: https
    metrics_path: /metrics/platform
    authorization: { credentials: '${METRICS_BEARER_TOKEN}' }
    static_configs:
      - targets: ['tale.example.com']
  - job_name: tale-backend
    scheme: https
    metrics_path: /metrics/backend
    authorization: { credentials: '${METRICS_BEARER_TOKEN}' }
    static_configs:
      - targets: ['tale.example.com']
```

Open `http://127.0.0.1:9090/targets` after start — both jobs should read **UP**. A target stuck **DOWN** with a 401 means the token in `prometheus.yml` does not match `METRICS_BEARER_TOKEN`; a connection error means the hostname or scheme is wrong.

## A starter dashboard

Point Grafana at Prometheus first — add a Prometheus data source at `http://prometheus:9090` (Grafana reaches it by the compose service name). Then build a dashboard from these panels; the first three use metrics that are always present, and the rest map to the signals in [Operations](/self-hosted/operate/observability/operations).

| Panel           | Query                                                | Reads as                                          |
| --------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Targets up      | `up{job=~"tale-.*"}`                                 | `1` per healthy endpoint, `0` when scraping fails |
| Platform memory | `process_resident_memory_bytes{job="tale-platform"}` | Resident memory of the platform container         |
| Event-loop lag  | `nodejs_eventloop_lag_seconds{job="tale-platform"}`  | Spikes when the platform is saturated             |
| Backend up      | `up{job="tale-backend"}`                             | Backend reachability — `0` is a page              |

The platform endpoint carries Node's default process metrics (CPU, memory, event-loop lag, GC), which is why the concrete queries above target it. The backend endpoint exposes its own richer series, including the in-process RAG and crawl timings — open it once (`curl -H "Authorization: Bearer $TOKEN" https://tale.example.com/metrics/backend`) to read the exact metric names your version exposes, then add panels for knowledge-ingestion throughput and provider error rate called out in Operations.

## A first alert rule

Start with the one signal that is unambiguous — a metrics target that stops responding. Add this rule file to Prometheus (mount it and reference it under `rule_files:` in `prometheus.yml`), then wire Alertmanager or Grafana alerting to your pager.

```yaml
groups:
  - name: tale
    rules:
      - alert: TaleTargetDown
        expr: up{job=~"tale-.*"} == 0
        for: 2m
        labels: { severity: page }
        annotations:
          summary: 'Tale metrics target {{ $labels.job }} is down'
```

The full list of what's worth paging on versus what can wait — platform 5xx rate, Postgres pool saturation, knowledge-database reachability, daily-backup-did-not-write — is the signal table in [Operations](/self-hosted/operate/observability/operations); translate each row into a rule once the matching series is on your dashboard.

## Where this fits

This page turns the two documented metrics endpoints into a running Prometheus and Grafana stack: a compose override, a two-job scrape config, a starter dashboard, and a target-down alert you extend with the Operations thresholds. Keep both services bound to localhost and the bearer token off disk-in-the-clear, and the whole monitoring surface stays on the host with Tale.

The endpoints and the token that gate them are owned by [Observability config](/self-hosted/configuration/observability-config); the thresholds and the oncall checklist are [Operations](/self-hosted/operate/observability/operations). When a panel goes red, the symptom-to-fix lookup is [Troubleshooting](/self-hosted/operate/observability/troubleshooting).
