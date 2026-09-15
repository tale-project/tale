---
title: Prometheus und Grafana
description: Erfasse Tale-Metriken mit einer Token-Datei, prüfe Scrape- und Alarmregeln und baue ein Dashboard aus vorhandenen Zeitreihen.
---

Nutze eine vorhandene Prometheus- und Grafana-Installation, wenn du bereits eine betreibst. Das folgende Beispiel startet ein separates Compose-Projekt zur Überwachung und ruft Tale über den öffentlichen Proxy ab. Es umfasst dauerhaften Metrikspeicher, eine eingebundene Token-Datei und zwei erste Alarmregeln.

## Zugriff und Dateien vorbereiten

Setze `METRICS_BEARER_TOKEN` für Tales Proxy und übernimm die Änderung mit deinem Bereitstellungsverfahren. Ein einfacher Container-Neustart lädt keine geänderten Umgebungswerte. Prüfe die geschützten Pfade unter [Observability konfigurieren](/de/self-hosted/configuration/observability-config#metriken), bevor du den Scraper einrichtest.

Erstelle einen eigenen Überwachungsordner mit `compose.monitoring.yml`, `prometheus.yml`, `tale-alerts.yml` und `secrets/tale-metrics-token`. Schreibe mit deinem Secret-Manager ausschließlich den Token-Wert in die Geheimnisdatei. Halte diese Datei und die Monitoring-`.env` aus der Versionsverwaltung heraus. Beschränke den Zugriff auf den Betreiber und den Container, der die Datei benötigt.

Lege in der Monitoring-`.env` geprüfte Tags für `PROMETHEUS_IMAGE` und `GRAFANA_IMAGE` sowie `GRAFANA_ADMIN_PASSWORD` fest. Wähle unterstützte Versionen auf den offiziellen Downloadseiten von [Prometheus](https://prometheus.io/download/) und [Grafana](https://grafana.com/grafana/download). Diese Versionen sind unabhängig vom Tale-Release-Tag.

## Überwachungsdienste definieren

Beide Oberflächen sind an Loopback gebunden. Öffne sie auf dem Docker-Host oder über einen SSH-Tunnel. Ein entfernter Docker-Kontext bindet sie nicht an deinen Arbeitsplatzrechner.

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

Prometheus erhält das Geheimnis unter `/run/secrets/tale_metrics_token`. Stelle sicher, dass die Container-Laufzeit die Quelldatei lesen kann, ohne sie für andere Nutzer freizugeben.

## Erfassung und Alarme konfigurieren

Ersetze `tale.example.com` durch den erreichbaren Tale-Hostnamen, einschließlich Port, wenn du nicht 443 verwendest. Ergänze bei Bedarf den Basispfad der Instanz in jedem `metrics_path`. Nutze ein vertrauenswürdiges HTTPS-Zertifikat oder binde eine CA-Datei ein. Schalte die Zertifikatsprüfung nicht ab, um den Abruf zum Funktionieren zu bringen.

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

Das Token wird über `credentials_file` gelesen, wie in der [HTTP-Konfiguration von Prometheus](https://prometheus.io/docs/prometheus/latest/configuration/configuration/#http_config) beschrieben. Ein wörtliches `${METRICS_BEARER_TOKEN}` in dieser YAML-Datei wird nicht durch Docker Compose ersetzt: Compose bindet die Datei ein, ohne ihren Inhalt umzuschreiben.

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

Passe Dringlichkeit und Wartezeiten an deine Anforderungen an und richte die Zustellung über Alertmanager oder Grafana ein. Eine in Prometheus sichtbare Regel versendet für sich allein keine Benachrichtigung. Der Speicher-Alarm umfasst Bereitstellungsstandards, keine organisationsspezifischen Datenbanken oder Buckets.

## Erfassung starten und prüfen

Prüfe die Dateien vor dem Start:

```bash
docker compose -f compose.monitoring.yml config --quiet
docker compose -f compose.monitoring.yml run --rm --entrypoint promtool \
  prometheus check config /etc/prometheus/prometheus.yml
docker compose -f compose.monitoring.yml up -d
```

Öffne `http://127.0.0.1:9090/targets`. Beide Tale-Jobs sollten **UP** anzeigen. Prüfe die Abfrage `up{job=~"tale-.*"}` und die Alarmregeln. Ein `401` weist auf die Token-Konfiguration hin. Bei DNS-, Verbindungs- oder Zertifikatsfehlern prüfst du den Netzwerkweg des Scrapers. **UP** belegt einen erfolgreichen Metrikabruf, nicht jede Anwendungsfunktion.

Öffne Grafana unter `http://127.0.0.1:3001` und füge eine Prometheus-Datenquelle mit `http://prometheus:9090` hinzu. Diese Adresse wird innerhalb des Monitoring-Compose-Netzwerks aufgelöst.

## Ein hilfreiches erstes Dashboard aufbauen

| Panel | Abfrage | Aussage |
| --- | --- | --- |
| Scrape-Verfügbarkeit | `up{job=~"tale-.*"}` | Ob jeder öffentliche Metrikpfad dem Scraper geantwortet hat. |
| Backend-Speicher | `process_resident_memory_bytes{job="tale-backend"}` | Arbeitsspeicher des antwortenden API-Replikats. |
| Backend-Antwortrate | `sum by (status) (rate(tale_backend_http_requests_total[5m]))` | Anfrageraten nach Antwortstatusklasse. |
| Job-Zustände | `tale_backend_jobs` | Jobs nach Warteschlangenzustand; achte auf anhaltendes Wachstum und Fehler. |
| Standardspeicher | `tale_backend_store_up` | Zwischengespeicherte Erreichbarkeit von `app_db`, `knowledge_db` und `object_store`. |
| Bereitstellungs-Drain | `tale_backend_drain_active` | Ob das Entleeren vor einer Bereitstellung neue Turns zurückweist. |

Einige Metriken lesen gemeinsame Datenbankzähler, andere beschreiben einen einzelnen Prozess. Erfasse bei mehreren Replikaten die Prozessmetriken einzeln über dein privates Monitoring-Netz und vermeide mehrfaches Zählen gemeinsamer Werte. [Betrieb überwachen](/de/self-hosted/operate/observability/operations) erklärt die Grenzen der Speicherprüfungen und die zusätzlichen Messungen für die SLA-Regelvorlage.
