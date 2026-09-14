---
title: Prometheus and Grafana
description: Collect Tale metrics with a token file, validate scrape and alert configuration, and build a dashboard from the available series.
---

Use your existing Prometheus and Grafana installation when you have one. The example below runs a separate monitoring Compose project that scrapes Tale through its public proxy. It includes persistent metrics storage, a mounted token file, and two starter alerts.

## Prepare access and files

Set `METRICS_BEARER_TOKEN` for Tale's proxy, then apply the environment change through your deployment workflow. A container restart alone does not load changed environment values. Confirm the token-gated paths in [Observability config](/self-hosted/configuration/observability-config#metrics) before configuring a scraper.

Create a separate monitoring directory with `compose.monitoring.yml`, `prometheus.yml`, `tale-alerts.yml`, and `secrets/tale-metrics-token`. Put only the token value in that secret file using your secret manager. Keep it and the monitoring `.env` out of version control, with access limited to the operator and the container that needs it.

In the monitoring `.env`, pin tested `PROMETHEUS_IMAGE` and `GRAFANA_IMAGE` tags and set `GRAFANA_ADMIN_PASSWORD`. Select supported releases from the projects' official [Prometheus](https://prometheus.io/download/) and [Grafana](https://grafana.com/grafana/download) distribution pages. These versions are independent of Tale's release tag.

## Define the monitoring services

Both interfaces bind to loopback. Reach them on the Docker host or through an SSH tunnel; a remote Docker context does not bind them to your workstation.

```yaml
# compose.monitoring.yml
services:
  prometheus:
    image: ${PROMETHEUS_IMAGE:?set a tested Prometheus image tag}
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./tale-alerts.yml:/etc/prometheus/tale-alerts.yml:ro
      - prometheus-data:/prometheus
    secrets: [tale_metrics_token]
    ports: ['127.0.0.1:9090:9090']
    restart: unless-stopped
  grafana:
    image: ${GRAFANA_IMAGE:?set a tested Grafana image tag}
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?set a strong password}
      GF_USERS_ALLOW_SIGN_UP: 'false'
    volumes: ['grafana-data:/var/lib/grafana']
    ports: ['127.0.0.1:3001:3000']
    restart: unless-stopped
secrets:
  tale_metrics_token:
    file: ./secrets/tale-metrics-token
volumes:
  prometheus-data:
  grafana-data:
```

The secret is mounted inside Prometheus at `/run/secrets/tale_metrics_token`. Make sure your container runtime can read the source file without opening it to other users.

## Configure collection and alerts

Replace `tale.example.com` with the reachable Tale hostname, including a port when it is not 443. Add your deployment's base path to each `metrics_path` if needed. Use a trusted HTTPS certificate or configure a CA file; do not disable certificate verification to make a scrape pass.

```yaml
# prometheus.yml
global:
  scrape_interval: 30s
rule_files:
  - /etc/prometheus/tale-alerts.yml
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

The token comes from `credentials_file`, as supported by [Prometheus HTTP configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#http_config). A literal `${METRICS_BEARER_TOKEN}` in this YAML is not a substitution supplied by Docker Compose, because Compose mounts the file without rewriting it.

```yaml
# tale-alerts.yml
groups:
  - name: tale
    rules:
      - alert: TaleTargetDown
        expr: up{job=~"tale-.*"} == 0
        for: 2m
        labels: { severity: page }
        annotations:
          summary: 'Tale metrics target {{ $labels.job }} is down'
      - alert: TaleDefaultStoreUnreachable
        expr: tale_backend_store_up == 0
        for: 5m
        labels: { severity: page }
        annotations:
          summary: 'Tale cannot reach its default {{ $labels.store }} store'
```

Adjust severity and waiting periods to your service requirements, and configure Alertmanager or Grafana alert delivery. A rule visible in Prometheus does not send a notification by itself. The store alert covers deployment defaults; it does not monitor organization-specific databases or buckets.

## Start and verify collection

Validate the files before starting the services:

```bash
docker compose -f compose.monitoring.yml config --quiet
docker compose -f compose.monitoring.yml run --rm --entrypoint promtool \
  prometheus check config /etc/prometheus/prometheus.yml
docker compose -f compose.monitoring.yml up -d
```

Open `http://127.0.0.1:9090/targets`. Both Tale jobs should show **UP**. Check the query `up{job=~"tale-.*"}` and inspect the alert rules. A `401` points to token configuration; DNS, connection, and certificate errors require checking the scraper's own network path. An **UP** target proves a successful scrape, not every application feature.

Open Grafana at `http://127.0.0.1:3001` and add a Prometheus data source at `http://prometheus:9090`. That address is resolved inside the monitoring Compose network.

## Build a useful first dashboard

| Panel | Query | Interpretation |
| --- | --- | --- |
| Scrape availability | `up{job=~"tale-.*"}` | Whether each public metrics path answered the scraper. |
| Backend memory | `process_resident_memory_bytes{job="tale-backend"}` | Memory of the API replica that answered. |
| Backend response rate | `sum by (status) (rate(tale_backend_http_requests_total[5m]))` | Request rates grouped by response status class. |
| Job states | `tale_backend_jobs` | Jobs by queue state; inspect sustained growth and failures. |
| Default stores | `tale_backend_store_up` | Cached reachability for `app_db`, `knowledge_db`, and `object_store`. |
| Deployment drain | `tale_backend_drain_active` | Whether deployment draining is refusing new turns. |

Some collectors read shared database counts; others describe one process. With multiple replicas, collect per-replica process metrics through your private monitoring network and avoid double-counting shared gauges. [Operations](/self-hosted/operate/observability/operations) explains the limits of the store probes and the additional measurements required by the SLA rule template.
