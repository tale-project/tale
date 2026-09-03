---
title: Prometheus und Grafana
description: Ein Copy-paste-Stack aus Prometheus und Grafana, der Tales zwei Metrics-Endpoints scrapt — plus ein Starter-Dashboard und eine erste Alert-Regel.
---

Das ist das durchgespielte Beispiel hinter [Observability-Konfiguration](/de/self-hosted/configuration/observability-config): ein Paar aus Prometheus und Grafana, das du neben Tale stellst, auf die zwei Bearer-Token-Metrics-Endpoints gerichtet, mit einem Starter-Dashboard und einer Alert-Regel zum Ausbauen. Es ist für selbst hostende Betreiber, die `METRICS_BEARER_TOKEN` bereits gesetzt haben und jetzt Live-Graphen statt eines `curl` gegen `/metrics` wollen.

Die Konfigurations-Referenzseite listet die Endpoints und die einzelne Scrape-Stanza; diese Seite stellt den ganzen Stack von Anfang bis Ende auf. Alles hier läuft auf demselben Host wie Tale, also verlässt keine Metrik die Maschine.

## Bevor du startest

Setz `METRICS_BEARER_TOKEN` in deiner `.env` und starte den Proxy neu — ohne ihn geben die zwei Endpoints auf jede Anfrage 401 zurück, und Prometheus zeigt jedes Target als down. Die Endpoints, und was jeder trägt, sind die Tabelle in [Observability-Konfiguration](/de/self-hosted/configuration/observability-config#metrics): `/metrics/platform` und `/metrics/backend` (Letzterer trägt jetzt die In-Process-RAG- und Crawl-Timings), beide von `tale-proxy` über denselben Hostnamen wie die App ausgeliefert.

## Prometheus und Grafana zu deinem Stack hinzufügen

Leg diese zwei Services in ein Compose-Override neben Tale. Prometheus scrapt in einem Intervall und speichert eine lokale TSDB; Grafana liest Prometheus und rendert die Dashboards. Beide binden nur an localhost — erreich Grafana über einen SSH-Tunnel oder stell es mit Auth hinter denselben Proxy, exponier es nie roh.

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

## Scrape-Konfiguration

Tales zwei Endpoints teilen sich ein Bearer-Token, also ist die Scrape-Konfiguration die veröffentlichte Stanza, einmal pro Pfad wiederholt. Speicher das als `prometheus.yml` neben dem Override oben und setz deinen Host und dein Token ein — Prometheus liest das Token aus der Datei, also halt sie `chmod 600` und aus der Versionskontrolle raus.

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

Öffne `http://127.0.0.1:9090/targets` nach dem Start — beide Jobs sollten **UP** anzeigen. Ein Target, das mit 401 auf **DOWN** hängt, heisst, das Token in `prometheus.yml` stimmt nicht mit `METRICS_BEARER_TOKEN` überein; ein Verbindungsfehler heisst, Hostname oder Schema sind falsch.

## Ein Starter-Dashboard

Richte Grafana zuerst auf Prometheus — füg eine Prometheus-Datenquelle unter `http://prometheus:9090` hinzu (Grafana erreicht sie über den Compose-Servicenamen). Bau dann ein Dashboard aus diesen Panels; die ersten drei nutzen Metriken, die immer vorhanden sind, und der Rest bildet die Signale in [Operations](/de/self-hosted/operate/observability/operations) ab.

| Panel           | Query                                                | Liest sich als                                               |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| Targets up      | `up{job=~"tale-.*"}`                                 | `1` pro gesundem Endpoint, `0` wenn das Scraping fehlschlägt |
| Platform-Memory | `process_resident_memory_bytes{job="tale-platform"}` | Resident-Memory des platform-Containers                      |
| Event-Loop-Lag  | `nodejs_eventloop_lag_seconds{job="tale-platform"}`  | Springt, wenn die Plattform gesättigt ist                    |
| Backend up      | `up{job="tale-backend"}`                             | Backend-Erreichbarkeit — `0` ist ein Page                    |

Der platform-Endpoint trägt Nodes Default-Prozessmetriken (CPU, Memory, Event-Loop-Lag, GC), darum zielen die konkreten Queries oben auf ihn. Der Backend-Endpoint exponiert seine eigene reichere Reihe, inklusive der In-Process-RAG- und Crawl-Timings — öffne ihn einmal (`curl -H "Authorization: Bearer $TOKEN" https://tale.example.com/metrics/backend`), um die exakten Metriknamen deiner Version zu lesen, und füg dann Panels für den Wissens-Ingestion-Durchsatz und die Provider-Fehlerrate aus Operations hinzu.

## Eine erste Alert-Regel

Fang mit dem einen Signal an, das eindeutig ist — ein Metrics-Target, das aufhört zu antworten. Füg diese Regel-Datei zu Prometheus hinzu (mounte sie und referenzier sie unter `rule_files:` in `prometheus.yml`), dann verdrahte Alertmanager oder Grafana-Alerting mit deinem Pager.

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

Die volle Liste, was ein Page wert ist gegenüber was warten kann — platform-5xx-Rate, Postgres-Pool-Sättigung, Erreichbarkeit der Wissensdatenbank, tägliches-Backup-nicht-geschrieben — ist die Signaltabelle in [Operations](/de/self-hosted/operate/observability/operations); übersetz jede Zeile in eine Regel, sobald die passende Reihe auf deinem Dashboard ist.

## Wo das hingehört

Diese Seite verwandelt die zwei dokumentierten Metrics-Endpoints in einen laufenden Prometheus-und-Grafana-Stack: ein Compose-Override, eine Zwei-Job-Scrape-Konfiguration, ein Starter-Dashboard und einen Target-down-Alert, den du mit den Operations-Schwellen ausbaust. Halt beide Services an localhost gebunden und das Bearer-Token nicht im Klartext auf der Festplatte, und die ganze Monitoring-Oberfläche bleibt mit Tale auf dem Host.

Die Endpoints und das Token, das sie absichert, gehören [Observability-Konfiguration](/de/self-hosted/configuration/observability-config); die Schwellen und die Oncall-Checkliste sind [Operations](/de/self-hosted/operate/observability/operations). Wenn ein Panel rot wird, ist die Symptom-zu-Fix-Suche [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting).
