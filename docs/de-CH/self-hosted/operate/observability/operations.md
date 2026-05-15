---
title: Operations
description: Monitoring, Error-Tracking, Logs, DB-Backups, Health-Checks und Container-Validierung.
---

Operations ist alles, was du tust, _nachdem_ Tale läuft: beobachten, sichern, beweisen, dass es gesund ist, und reagieren, wenn etwas schief geht. Die Seiten in diesem Bereich sind um diese Schleife organisiert — beobachten (Metriken, Logs), sichern (Backups, Aufbewahrung), verifizieren (Health-Checks, Container-Validierung) und reagieren (Advisories, Release-Notes).

Die Voreinstellungen unten sind sinnvoll, sodass eine frische Installation am ersten Tag betreibbar ist. Die hier dokumentierte Arbeit ist das, was du anpasst, sobald du Traffic hast, der Schutz verdient.

## Monitoring

Alle Tale-Dienste bieten einen Prometheus-`/metrics`-Endpoint im internen Docker-Netzwerk. Für Zugriff von aussen setzt du ein Bearer-Token in deiner `.env`:

```dotenv
METRICS_BEARER_TOKEN=your-secret-token-here
```

Die Metriken sind dann hier erreichbar:

| Dienst         | Metriken-Endpoint                         |
| -------------- | ----------------------------------------- |
| Crawler        | `https://yourdomain.com/metrics/crawler`  |
| RAG            | `https://yourdomain.com/metrics/rag`      |
| Platform (Bun) | `https://yourdomain.com/metrics/platform` |
| Convex         | `https://yourdomain.com/metrics/convex`   |

> **Hinweis:** Das Convex-Backend liefert über 260 eingebaute Metriken zu Query-Latenz, Mutation-Durchsatz und Scheduler-Performance.

Wenn das Token leer ist, liefern alle `/metrics/*`-Endpoints `401`.

### Prometheus-Scrape-Config

```yaml
scrape_configs:
  - job_name: tale-crawler
    scheme: https
    metrics_path: /metrics/crawler
    authorization:
      credentials: your-secret-token-here
    static_configs:
      - targets: ['your-tale-host.com']

  # Für tale-rag, tale-platform, tale-convex wiederholen,
  # metrics_path entsprechend anpassen.
```

## Error-Tracking

Tale unterstützt Sentry und kompatible Alternativen wie GlitchTip für Error-Tracking. Setze dein DSN in `.env`:

```dotenv
SENTRY_DSN=https://your-key@your-sentry-host/project-id
```

Ist `SENTRY_DSN` nicht gesetzt, ist Error-Tracking deaktiviert und Fehler erscheinen nur in den Docker-Logs.

## Logs ansehen

Alle Dienst-Logs gehen nach Docker-stdout mit automatischer Rotation bei 10 MB pro Datei, 3 Dateien pro Dienst werden gehalten.

```bash
# Alle Dienst-Logs streamen
docker compose logs -f

# Logs eines bestimmten Dienstes streamen
docker compose logs -f rag

# Jüngste Logs ohne Streaming ansehen
docker compose logs --tail=100 platform
```

## Datenbank-Backups

Einen DB-Snapshot erzeugen:

```bash
docker exec tale-db pg_dump -U tale tale > backup-$(date +%Y%m%d).sql
```

Aus einem Backup wiederherstellen:

```bash
docker exec -i tale-db psql -U tale tale < backup-20260101.sql
```

## Health-Checks

Jeder Dienst hat einen Health-Check-Endpoint:

| Endpoint                       | Was geprüft wird                                 |
| ------------------------------ | ------------------------------------------------ |
| `GET /health`                  | Proxy läuft und lauscht.                         |
| `GET /api/health`              | Platform ist oben und Convex-Backend erreichbar. |
| `http://localhost:8001/health` | RAG-Dienst läuft und DB-Pool ist verbunden.      |
| `http://localhost:8002/health` | Crawler-Dienst und Browser-Engine sind bereit.   |

## Container-Health-Validierung

Um nach einem Deployment oder einer Konfigurationsänderung sicherzugehen, dass alle Container gesund sind, den Smoke-Test laufen lassen:

```bash
bun run docker:test
```

Er baut alle Images, startet sie auf nicht-konflikthaften Ports, prüft Health-Endpoints und Inter-Service-Konnektivität und baut wieder ab. Es ist derselbe Test, der in CI bei jedem Pull Anfrage läuft.

Für Image-Validierung (OCI-Labels, keine Secrets, Size-Budgets):

```bash
bun run docker:test:image
```

## Image-Grössen-Monitoring

Jedes Container-Image hat ein Size-Budget, das CI erzwingt. Aktuelle Grössen und Budgets:

| Dienst   | Aktuelle Grösse | Budget |
| -------- | --------------- | ------ |
| Crawler  | ~1.85 GB        | 2.1 GB |
| RAG      | ~515 MB         | 600 MB |
| Platform | ~2.58 GB        | 2.9 GB |
| DB       | ~1.06 GB        | 1.2 GB |
| Proxy    | ~88 MB          | 100 MB |

Überschreitet ein Image nach einer Änderung sein Budget, schlägt `bun run docker:test:image` fehl. Siehe die Seite [Container-Architektur](/de/self-hosted/operate/container-architecture) für Multi-Stage-Strategien, die Images klein halten.
