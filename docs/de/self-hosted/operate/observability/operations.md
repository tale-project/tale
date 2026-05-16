---
title: Betrieb
description: Monitoring, Error-Tracking, Logs, DB-Backups, Health-Checks und Container-Validierung.
---

Betrieb ist alles, was passiert, nachdem Tale läuft — die Metriken, die du scrapest, die Logs, die du verschickst, die Backups, die du nimmst, die Health-Probes, auf die du alarmierst. Diese Seite ist der Index für Operatoren, die täglich mit einer Produktions-Instanz leben: was jeder Dienst exponiert, wie man es in einen Prometheus- und Log-Aggregator-Stack verdrahtet und die Validierungs-Schritte, die beweisen, dass ein Deploy tatsächlich gesund ist.

Die Voreinstellungen sind vernünftig genug, dass eine frische Installation am Tag eins betriebsfähig ist. Die hier dokumentierte Arbeit ist das, was du tunst, sobald du Traffic hast, der den Schutz wert ist.

## Monitoring

Jeder Tale-Dienst exponiert einen Prometheus-Textformat-Endpunkt `/metrics` im internen Docker-Netzwerk. Die Endpunkte sind nützlich für die platforminternen Service-zu-Service-Health-Checks selbst dann, wenn nichts Externes scrapet; um sie für ein externes Prometheus durch den Proxy zu exponieren, setze ein Bearer-Token in `.env`:

```dotenv
METRICS_BEARER_TOKEN=your-secret-token-here
```

Die Metrics-Oberflächen antworten dann auf der öffentlichen URL hinter dem Proxy:

| Dienst         | Metrics-Endpunkt                          |
| -------------- | ----------------------------------------- |
| Crawler        | `https://yourdomain.com/metrics/crawler`  |
| RAG            | `https://yourdomain.com/metrics/rag`      |
| Platform (Bun) | `https://yourdomain.com/metrics/platform` |
| Convex         | `https://yourdomain.com/metrics/convex`   |

Das Convex-Backend exponiert über 260 eingebaute Metriken, die Query-Latenz, Mutation-Durchsatz, Scheduler-Queue-Tiefe und Per-Function-Aufruf-Zähler abdecken. Wenn das Bearer-Token ungesetzt ist, antwortet jeder `/metrics/*`-Endpunkt mit `401` — das ist absichtlich, weil die Metriken genug operative Details tragen, um geschützt zu gehören.

### Prometheus-Scrape-Konfiguration

```yaml
scrape_configs:
  - job_name: tale-crawler
    scheme: https
    metrics_path: /metrics/crawler
    authorization:
      credentials: your-secret-token-here
    static_configs:
      - targets: ['your-tale-host.com']

  # Für tale-rag, tale-platform, tale-convex wiederholen — nur metrics_path ändert sich.
```

Die vier `job_name`-Blöcke unterscheiden sich nur in den `metrics_path`- und `job_name`-Strings, also fügen die meisten Operatoren dieselbe Konfiguration viermal mit einer geänderten Zeile ein.

## Error-Tracking

Tales Error-Pipeline spricht das Sentry-DSN-Format. Selbst gehostetes Sentry, GlitchTip und Bugsink akzeptieren alle dieselbe DSN-Form, also funktioniert jedes davon als Drop-in-Ersatz. Setze die DSN in `.env`:

```dotenv
SENTRY_DSN=https://your-key@your-sentry-host/project-id
```

Mit ungesetztem `SENTRY_DSN` ist das Error-Tracking aus und Fehler tauchen nur in Docker-Logs auf. Die Variable `SENTRY_TRACES_SAMPLE_RATE` kontrolliert den Anteil der Transaktionen, der für Performance-Tracing geschickt wird; die Voreinstellung von `1.0` (jede Transaktion) ist für Low-Traffic-Instanzen OK, und du würdest sie auf einem belebten Produktions-Deployment senken.

## Logs

Alle Service-Logs gehen nach Docker-stdout. Die Compose-Datei begrenzt jeden Container auf 10 MB pro Log-Datei mit drei rotierten behaltenen Dateien, sodass ein sich danebenbenehmender Service die Festplatte nicht über Nacht füllen kann.

```bash
# Log jedes Dienstes streamen.
docker compose logs -f

# Einen Dienst streamen.
docker compose logs -f rag

# Letzte Zeilen ohne Streaming.
docker compose logs --tail=100 platform
```

Wenn der Stack unter `tale deploy` läuft, ist `tale logs <service>` dasselbe Bild gefiltert durch die aktive Blue-Green-Farbe — nützlich, wenn beide Farben während eines Deploys kurz existieren und du nur die neue willst.

## Datenbank-Backups

Der gebündelte `db`-Container hält jedes persistente Stück Zustand, das Tale schreibt — Convex-Tabellen, RAG-Embeddings, Crawler-URLs, Audit-Log, alles. Nimm einen Snapshot mit `pg_dump` innerhalb des Containers:

```bash
docker exec tale-db pg_dump -U tale tale > backup-$(date +%Y%m%d).sql
```

Die Wiederherstellung ist die Umkehrung:

```bash
docker exec -i tale-db psql -U tale tale < backup-20260101.sql
```

Für die Produktion plane den Dump per cron und verschicke die Datei vom Host. Das benannte `db-backup`-Volume, das auf `/var/lib/postgresql/backup` gemountet ist, ist der Staging-Bereich für das Off-Host-Versenden; die gebündelte Compose mountet es, schreibt aber nicht automatisch dorthin.

## Health-Checks

Jeder Dienst antwortet auf einen Health-Endpunkt, der auch das ist, was der Proxy und Dockers eigener Healthcheck abfragen:

| Endpunkt                       | Was er prüft                                                |
| ------------------------------ | ----------------------------------------------------------- |
| `GET /health`                  | Der Proxy läuft und lauscht.                                |
| `GET /api/health`              | Die Platform ist hoch und Convex ist von innen erreichbar.  |
| `http://localhost:8001/health` | RAG läuft und der Datenbank-Pool ist verbunden.             |
| `http://localhost:8002/health` | Der Crawler läuft und die Browser-Engine ist initialisiert. |

Der Platform-Endpunkt ist der nützlichste Einzel-Check während eines Deploys, weil er die volle Kette durchtrainiert — Bun antwortend, Convex erreichbar, die Bereitschafts-Datei vom Entrypoint nach Env-Sync geschrieben.

## Container-Health-Validierung

Zwei Skripte validieren einen frischen Build, bevor du ihn in die Produktion schiebst. Beide laufen in CI bei jedem `Pull Request` und beide sind sicher auf einem Entwicklungs-Host zu fahren.

```bash
bun run docker:test
```

Das baut jedes Image, startet jeden Container auf nicht-kollidierenden Ports (die Test-Compose-Datei nutzt den `13000+`-Bereich), validiert die Health-Endpunkte, übt die Inter-Service-Konnektivität durch und reißt ab. Das ist das nächste, was du an ein echtes Produktions-Deploy bekommst, das auf einen Laptop passt.

Für Image-Ebene-Validierung — OCI-Labels, keine Secrets in Layern, Größenbudgets, Nicht-Root-Nutzer, HEALTHCHECK-Instruktion:

```bash
bun run docker:test:image
```

Beide Skripte sind ausführlich in der [Contributing-Docker-Anleitung](/de/develop/contributing-docker) dokumentiert.

## Image-Größen-Monitoring

Jedes Container-Image hat ein Größenbudget, das von CI durchgesetzt wird. Die aktuellen Größen und Budgets:

| Dienst   | Aktuelle Größe | Budget |
| -------- | -------------- | ------ |
| Crawler  | ~1,85 GB       | 2,1 GB |
| RAG      | ~515 MB        | 600 MB |
| Platform | ~320 MB        | 400 MB |
| Convex   | ~485 MB        | 600 MB |
| DB       | ~1,06 GB       | 1,2 GB |
| Proxy    | ~88 MB         | 100 MB |

Eine Änderung, die ein Image über sein Budget schiebt, lässt `bun run docker:test:image` fehlschlagen. Die [Container-Architektur](/de/self-hosted/operate/container-architecture)-Seite deckt die Multi-Stage-Build-Strategien ab, die jedes Image innerhalb seines Budgets halten.

## Wo das einsetzt

Betrieb ist die tägliche Oberfläche für den Operator, der Tale in Produktion fährt — Metriken zum Scrapen, Logs zum Versenden, Health-Probes zum Überwachen, Image-Budgets zum Durchsetzen. Wenn auf einer lebendigen Instanz etwas schiefläuft, ist [Fehlersuche](/de/self-hosted/operate/observability/troubleshooting) die Symptom-zur-Behebung-Karte; für das Architektur-Modell hinter den Diensten, die diese Metriken ausgeben, ist [Container-Architektur](/de/self-hosted/operate/container-architecture) einen Klick entfernt.
