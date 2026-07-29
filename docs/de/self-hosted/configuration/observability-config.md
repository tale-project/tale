---
title: Observability-Konfiguration
description: Die Env-Vars und Flags, die Logs, Metriken und Error-Tracking aktivieren — und was jede davon wohin routet.
---

Tale bringt drei Observability-Nähte mit: stdout-Logs aus jedem Container, Metriken im Prometheus-Format hinter einem Bearer-Token und optionales Sentry-Error-Reporting. Die Defaults sind laut genug, um einen Crash zu sehen, und leise genug, um in das journald eines einzelnen Hosts zu passen; die Produktions-Knöpfe unten fügen die strukturierten Pfade hinzu, die dein bestehender Monitoring-Stack scrapen kann. Keine der drei schickt etwas vom Host weg, ausser du konfigurierst sie dazu.

Diese Seite deckt die serverseitigen Schalter ab. Das operatorseitige Alert-Playbook lebt in [Operations](/de/self-hosted/operate/observability/operations), und das symptomorientierte Nachschlagen in [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting).

## Logs

Jeder Container schreibt strukturierte JSON- oder Console-Logs nach stdout, vom Default-Driver `json-file` von Docker mit einer Rotation von 10 MB pro Datei und drei Dateien aufgefangen. Das Log-Ziel ist eine Funktion davon, wie du deployest:

- Einzelner Host mit journald — `journalctl -u docker` trägt alles.
- Einzelner Host ohne journald — `docker compose logs -f <service>` für live tailing.
- Aggregator (Loki, Vector, Fluent Bit) — richte den Docker-Logging-Driver über `daemon.json` dorthin.

Tale bringt keinen Log-Shipper mit. Der Driver-Tausch ist der unterstützte Connector-Punkt.

## Metriken

Der Caddy-Proxy exponiert drei Metric-Pfade, gegated von einem einzigen Bearer-Token:

| Pfad                 | Quelle          | Was drinsteckt                                                                |
| -------------------- | --------------- | ----------------------------------------------------------------------------- |
| `/metrics/platform`  | `tale-platform` | HTTP-Latenz, Route-Counter, Node-Prozessmetriken, Antwortzeit-SLA-Ziel-Gauges |
| `/metrics/convex`    | `tale-convex`   | 261 eingebaute Convex-Metriken, plus die RAG- und Crawl-Timings               |
| `/metrics/sla-rules` | `tale-platform` | Generierte Prometheus-Recording- + Alerting-Rules für die Antwortzeit-SLAs    |

Wissens-Arbeit (RAG-Suche, Dokument-Ingestion, Web-Crawling) läuft jetzt im Convex-Backend, also reiten ihre Timings auf der `/metrics/convex`-Reihe statt auf einem separaten Endpoint. Setze `METRICS_BEARER_TOKEN` in `.env`, um diese Endpoints zu aktivieren; lass es unset, damit sie jeder Anfrage 401 zurückgeben. Der `/metrics/sla-rules`-Pfad ist eine schreibgeschützte YAML-Rules-Datei, die du in Prometheus lädst, kein Scrape-Target — die Schwellen darin sind in [Operations](/de/self-hosted/operate/observability/operations) dokumentiert. Alles ausser den gelisteten Pfaden gibt ebenfalls 401 zurück, damit ein fehlgerouteter Scraper die internen Health-Endpoints der Plattform nicht versehentlich sieht.

Eine funktionierende Prometheus-Scrape-Stanza:

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

Dupliziere die Stanza pro Pfad, oder nutze einen einzelnen Job mit `relabel_configs`, wenn du das bevorzugst.

## Error-Tracking mit Sentry

Sentry ist opt-in über `SENTRY_DSN`. Selbst gehostete GlitchTip und Bugsink funktionieren auch, da sie dasselbe DSN-Format sprechen. Die Plattform- und die Convex-Container lesen beide den DSN und taggen Events mit dem Container-Namen.

```bash
# .env
SENTRY_DSN=https://your-key@your-sentry-host/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Die Sample-Rate begrenzt Performance-Traces; lass sie unset für den Default 1.0 in Development und ziehe sie an (0.05–0.2) in Produktion. Stack-Frames werden unredigiert geschickt, also richte den DSN auf Infrastruktur, die du kontrollierst, wenn deine Error-Payloads sensibel sind.

## Was noch nicht mitkommt

OpenTelemetry-Traces sind nicht in die Container eingebaut. Die Daten sind indirekt erreichbar — Convex-Action-Dauern und HTTP-Route-Timings kommen durch die Prometheus-Metriken — aber es gibt heute keinen OTLP-Exporter auf der Box. Brauchst du vollen Trace-Export, betreib einen OpenTelemetry Collector neben Tale und scrape die Prometheus-Endpoints aus ihm.

## Wo das hingehört

Die drei Nähte oben sind die Kontaktpunkte mit dem Rest deines Monitoring-Stacks; die Alert-Schwellen und die Oncall-Checkliste leben in [Operations](/de/self-hosted/operate/observability/operations). Brennt etwas gerade und du brauchst den symptomorientierten Index, spring zu [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting).
