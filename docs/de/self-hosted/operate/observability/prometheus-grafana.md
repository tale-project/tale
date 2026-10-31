---
title: Prometheus und Grafana
description: Erfasse Tale-Metriken mit einer Token-Datei, prüfe Scrape- und Alarmregeln und baue ein Dashboard aus vorhandenen Zeitreihen.
---

Nutze eine vorhandene Prometheus- und Grafana-Installation, wenn du bereits eine betreibst. Das folgende Beispiel startet ein separates Compose-Projekt zur Überwachung und ruft Tale über den öffentlichen Proxy ab. Es umfasst dauerhaften Metrikspeicher, eine eingebundene Token-Datei und erste Alarmregeln.

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
      - alert: TaleDispatchStopped
        expr: time() - tale_backend_dispatch_last_pass_timestamp_seconds > 900
        for: 5m
        labels: { severity: ticket }
        annotations:
          summary: 'The dispatch of project {{ $labels.project }} has not passed for 15 minutes'
      - alert: TaleAgentRunsOutOfMemory
        expr: max(increase(tale_backend_agent_run_failures_total{code="resource_exhausted"}[1h])) > 0
        labels: { severity: ticket }
        annotations:
          summary: 'An agent run ran out of memory in the last hour'
```

Passe Dringlichkeit und Wartezeiten an deine Anforderungen an und richte die Zustellung über Alertmanager oder Grafana ein. Eine in Prometheus sichtbare Regel versendet für sich allein keine Benachrichtigung. Der Speicher-Alarm umfasst Bereitstellungsstandards, keine organisationsspezifischen Datenbanken oder Buckets.

Der Alarm zur Arbeitsverteilung nennt ein Projekt, dessen Arbeitsverteilung eingeschaltet ist und seit 15 Minuten keinen Durchlauf abgeschlossen hat. Jede eingeschaltete Arbeitsverteilung läuft mindestens einmal pro Minute; ein Wert, der stehen bleibt, deutet auf angehaltene Job-Worker oder einen Durchlauf, der immer wieder fehlschlägt.

Der Arbeitsspeicher-Alarm meldet, dass die Sandbox mindestens eines Agentenlaufs in der letzten Stunde an ihre Arbeitsspeichergrenze gestoßen ist. Ein solcher Lauf wird nach einer Pause wiederholt, wie [Wartende und fehlgeschlagene Läufe behandeln](/de/platform/projects/task-automation#handle-waiting-and-failed-runs) beschreibt, und jeder Versuch, dem der Arbeitsspeicher ausgeht, zählt erneut. Kommt der Alarm immer wieder, gib jeder Agentensitzung mit `SANDBOX_AGENT_MEMORY` mehr Arbeitsspeicher oder lass weniger Sitzungen gleichzeitig laufen, wie es die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure) beschreibt.

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
| Herzschlag der Arbeitsverteilung | `time() - tale_backend_dispatch_last_pass_timestamp_seconds` | Sekunden seit dem letzten abgeschlossenen Durchlauf jeder eingeschalteten Arbeitsverteilung eines Projekts. |
| Wartende Agentenläufe | `max by (reason) (tale_backend_agent_runs_waiting)` | Agentenläufe, die gerade auf freien Platz warten, nach Grund. |
| Neu wartende Agentenläufe | `max by (reason) (increase(tale_backend_agent_run_parks_total[1h]))` | Wie oft Agentenläufe in der letzten Stunde auf freien Platz warten mussten, nach Grund. |
| Geweckte Agentenläufe | `max by (source) (increase(tale_backend_agent_run_wakes_total[1h]))` | Wartende Agentenläufe, die in der letzten Stunde neu gestartet wurden, nach Auslöser. `tale_backend_agent_run_wake_failures_total` zählt die fehlgeschlagenen Weckversuche; deren Läufe warten weiter auf den nächsten. |
| Fehlgeschlagene Agentenläufe | `max by (code) (increase(tale_backend_agent_run_failures_total[1h]))` | Fehlgeschlagene Agentenläufe der letzten Stunde, nach Fehlercode. `resource_exhausted` heißt, dass einer Sandbox der Arbeitsspeicher ausgegangen ist. |

Die Zeitreihen der Agentenläufe zählen die Aufgabenläufe von Projektagenten in allen Organisationen; Automatisierungsläufe zählen nicht mit. Ihre Summen liegen in der Datenbank, ein Neustart setzt sie also nicht zurück, und jedes API-Replikat meldet dieselben Werte für die ganze Bereitstellung: Fasse Replikate mit `max` zusammen, nie mit `sum`. Kann ein Replikat die Datenbank nicht lesen, meldet es bei diesem Scrape keine Summen; ein Diagramm zeigt dann eine Lücke statt eines Rückgangs. Ein Ereignis zählt, sobald es gespeichert ist; endet ein Prozess genau dazwischen, kann diese eine Zählung fehlen. Die Labels stammen aus festen Listen und nennen nie eine Organisation, eine Aufgabe oder einen Lauf:

- `reason`: `org_limit` (alle Agenten-Worker der Organisation sind belegt), `host` (die Bereitstellung ist voll oder hat zu wenig Arbeitsspeicher oder Speicherplatz), `destroy_pending` (der Arbeitsbereich, den der Lauf nutzen würde, wird gerade gelöscht), `exec_limit` (seine Sandbox beendet noch einen früheren Prozess), `model_capacity` (sein KI-Modell ist ausgelastet) oder `unknown`. [Sandboxes](/de/platform/admin/sandboxes#einen-blockierten-start-klaeren) erklärt, wie du jedes Warten auflöst.
- `source`: `release` (ein Worker oder Sandbox-Platz wurde freigegeben), `scheduled` (der für diesen Lauf geplante Weckruf wurde fällig, etwa weil er in der Warteschlange des Sandbox-Hosts an der Reihe war) oder `watchdog` (der regelmäßige Durchgang, der Läufe weckt, die sonst nichts geweckt hat).
- `code`: der Fehlercode, mit dem der Lauf endete, oder `unknown`, wenn er keinen hat, den diese Version kennt.

Einige Metriken lesen gemeinsame Datenbankzähler, andere beschreiben einen einzelnen Prozess. Erfasse bei mehreren Replikaten die Prozessmetriken einzeln über dein privates Monitoring-Netz und vermeide mehrfaches Zählen gemeinsamer Werte. [Betrieb überwachen](/de/self-hosted/operate/observability/operations) erklärt die Grenzen der Speicherprüfungen und die zusätzlichen Messungen für die SLA-Regelvorlage.
