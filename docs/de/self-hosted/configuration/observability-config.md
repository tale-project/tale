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

| Pfad                 | Quelle             | Was drinsteckt                                                                                                                                                                        |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/metrics/platform`  | `tale-platform`    | HTTP-Latenz, Route-Counter, Node-Prozessmetriken, Antwortzeit-SLA-Ziel-Gauges                                                                                                         |
| `/metrics/sla-rules` | `tale-platform`    | Generierte Prometheus-Recording- + Alerting-Rules für die Antwortzeit-SLAs                                                                                                            |
| `/metrics/backend`   | `tale-backend-api` | Prozess-Metriken, HTTP-Counter und Latenz pro Routen-Klasse, Queue-Tiefe je Job-Status, laufende Chat-Generierungen, offene Hint-Streams, Drain-Zustand und dieselben SLA-Ziel-Gauges |

Wissens-Arbeit (RAG-Suche, Dokument-Ingestion, Web-Crawling) läuft jetzt im Backend-Worker, also reiten ihre Timings auf der `/metrics/backend`-Reihe statt auf einem separaten Endpoint. Setze `METRICS_BEARER_TOKEN` in `.env`, um diese Endpoints zu aktivieren; lass es unset, damit sie jeder Anfrage 401 zurückgeben. Der `/metrics/sla-rules`-Pfad ist eine schreibgeschützte YAML-Rules-Datei, die du in Prometheus lädst, kein Scrape-Target — die Schwellen darin sind in [Operations](/de/self-hosted/operate/observability/operations) dokumentiert. Alles ausser den gelisteten Pfaden gibt ebenfalls 401 zurück, damit ein fehlgerouteter Scraper die internen Health-Endpoints der Plattform nicht versehentlich sieht.

`/metrics/backend` wird vom Application-Backend bedient, das jedes Deployment betreibt; `BACKEND_UPSTREAM` überschreibt nur den Upstream für ein Split-Deployment. Ein gegateter Metrics-Pfad ohne Lane auf dem Deployment antwortet mit 404, statt still die Zahlen eines anderen Dienstes unter dem falschen Namen auszuliefern.

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

Sentry ist opt-in über `SENTRY_DSN`. Selbst gehostete GlitchTip und Bugsink funktionieren auch, da sie dasselbe DSN-Format sprechen. Ein DSN deckt beide Seiten des Stacks ab: die Browser-App meldet Frontend-Fehler, und die Container `backend-api` / `backend-worker` melden die Server-Seite — abgestürzte Anfragen, fehlgeschlagene Hintergrund-Jobs und Boot-Fehler — getaggt mit der Prozessrolle (`tale.role`) und der Release-Version.

```bash
# .env
SENTRY_DSN=https://your-key@your-sentry-host/project-id
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Die Sample-Rate begrenzt Performance-Traces im Browser und gilt nur dort — das Backend meldet Fehler, nie Traces. Lass sie unset für den Default 1.0 in Development und ziehe sie an (0.05–0.2) in Produktion. Stack-Frames werden auf beiden Seiten unredigiert geschickt, also richte den DSN auf Infrastruktur, die du kontrollierst, wenn deine Error-Payloads sensibel sind.

## Aggregierte Nutzungsstatistik mit Umami

Die aggregierte Verkehrsmessung aktivierst du getrennt pro Deployment. Setze `UMAMI_URL`, `UMAMI_WEBSITE_ID` und `UMAMI_PROXY_TOKEN` gemäß der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference). Eine leere Website-ID deaktiviert sie ohne neues Image. Das Token bleibt auf dem Server. Verwende für jedes Deployment eine eigene Website-ID.

Der Proxy auf der eigenen Domain liefert den Umami-Tracker aus und leitet nur Seitenaufrufe sowie abgeschlossene Kontakt- und Demo-Anfragen der Marketing-Seite weiter. Das Erfassungs-Gateway muss `GET /_collect/script.js` und `POST /_collect/api/send` mit dem konfigurierten Bearer-Token authentifizieren. Caddy muss `X-Analytics-Client-IP` aus der vertrauenswürdigen Client-Adresse neu setzen. Halte die Anwendungsports privat und konfiguriere vertrauenswürdige Proxy-Netze, wenn ein weiterer Proxy vorgeschaltet ist. Browser-Cookies, Anmeldedaten, Referrer-Kopfzeilen, Seitentitel, Suchparameter, Fragmente, Kontokennungen, Formularfelder und Produktinhalte gelangen nie zur Erfassung.

Die Berichte enthalten bekannte öffentliche Seitenpfade, Routenvorlagen der privaten Plattform, Referrer-Ursprünge, Browsersprache, Bildschirmgröße, Browser, Betriebssystem, Gerät und ungefähren Standort. Die Erfassung leitet Besuche und Standort aus der IP-Adresse ab, ohne diese im Klartext zu speichern. Private Organisations- und Ressourcenkennungen erscheinen als Platzhalter. Es gibt keine websiteübergreifende Identität, automatische Klickerfassung oder Sitzungsaufzeichnung. Do Not Track und Global Privacy Control deaktivieren die Erfassung.

Öffne nach dem Rollout eine bekannte Seite, navigiere innerhalb der Anwendung und prüfe beide Seitenaufrufe in der Umami-Website des Deployments. Prüfe den Inhalt der Erfassungsanfrage: Eine private Route enthält Platzhalter, aber keine Suchparameter, Titel oder Formulardaten. Die Navigation muss auch bei blockierter oder ausgefallener Erfassung funktionieren.

## Was noch nicht mitkommt

OpenTelemetry-Traces sind nicht in die Container eingebaut. Die Daten sind indirekt erreichbar — Backend-Request-Dauern und HTTP-Route-Timings kommen durch die Prometheus-Metriken — aber es gibt heute keinen OTLP-Exporter auf der Box. Brauchst du vollen Trace-Export, betreib einen OpenTelemetry Collector neben Tale und scrape die Prometheus-Endpoints aus ihm.

## Wo das hingehört

Die drei Nähte oben sind die Kontaktpunkte mit dem Rest deines Monitoring-Stacks; die Alert-Schwellen und die Oncall-Checkliste leben in [Operations](/de/self-hosted/operate/observability/operations). Brennt etwas gerade und du brauchst den symptomorientierten Index, spring zu [Troubleshooting](/de/self-hosted/operate/observability/troubleshooting).
