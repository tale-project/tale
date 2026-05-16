---
title: Container-Architektur
description: Wie Tales Docker-Images strukturiert, gebaut und vernetzt sind.
---

Tale läuft als sechs Docker-Container, verwaltet von Docker Compose, jeder mit einer einzigen Zuständigkeit und einem einzigen Port auf dem internen Bridge-Netzwerk. Diese Seite ist das mentale Modell des Operators dafür, was wo läuft und wie die Dienste reden: welche Volumes geteilt sind, welche Ports exponiert sind, wo die Blue-Green-Topologie sich während eines Deploys auf sich selbst faltet. Greif zu ihr, wenn etwas nicht landet, wo du es erwartest — ein unerreichbarer Metrics-Endpunkt, ein versehentlich exponierter Port, ein Blue-Green-Wechsel, der nicht sauber ausgeblutet ist.

Die sechs Container sind stabil über jeden Installationspfad. Quickstart, Produktions-Deployment und CI ziehen alle dieselbe Menge hoch; nur Port-Mappings, TLS-Modus und Host-Bindungen unterscheiden sich.

## Wie die Dienste reden

```mermaid
graph TB
    subgraph External
        Browser["Browser / API-Client"]
    end

    subgraph Docker["Docker-Netzwerk"]
        Proxy["proxy (Caddy)"]
        Platform["platform (TanStack Start)"]
        Convex["convex (Backend + Dashboard)"]
        RAG["rag (FastAPI)"]
        Crawler["crawler (Crawl4AI + Playwright)"]
        DB["db (ParadeDB / Postgres 16)"]
    end

    Browser -->|HTTPS :443| Proxy
    Proxy -->|HTTP :3000| Platform
    Proxy -->|WS/HTTP :3210/:3211| Convex
    Proxy -->|HTTP :6791| Convex
    Platform -->|HTTP :3210<br/>(convex env set + deploy)| Convex
    Convex -->|TCP :5432| DB
    Convex -->|HTTP :8001| RAG
    Convex -->|HTTP :8002| Crawler
    RAG -->|TCP :5432| DB
    Crawler -->|TCP :5432| DB
```

Der Proxy ist der einzige Container, der auf einem öffentlichen Port lauscht. Alles andere bleibt auf der internen Docker-Bridge; die Platform berührt Postgres nie direkt, weil Convex jedes Lesen und Schreiben besitzt, das in der Datenbank landet. RAG und der Crawler reden mit der Datenbank für ihre eigenen Per-Service-Tabellen (`tale_knowledge`-Schemas), lesen oder schreiben aber nie die Convex-Tabellen.

## Image-Details

| Dienst   | Basis-Image                                                           | Komprimierte Grösse | Build-Strategie                                                       |
| -------- | --------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------- |
| Platform | `ghcr.io/get-convex/convex-backend` (für `generate_key`-glibc-Binary) | ~320 MB             | 5-Stufen: deps → builder → pruner → runner → squash                   |
| Convex   | `ghcr.io/get-convex/convex-backend`                                   | ~485 MB             | 2-Stufen: dashboard → runner (Dashboard COPY-iert aus Upstream-Image) |
| Crawler  | `python:3.11-slim`                                                    | ~650 MB             | 3-Stufen: builder → runtime → squash. Nur Chromium-headless_shell.    |
| RAG      | `python:3.11-slim`                                                    | ~515 MB             | 3-Stufen: builder → runtime → squash. Nur libpq5.                     |
| DB       | `paradedb/paradedb:0.22.5-pg16`                                       | ~1,06 GB            | 3-Stufen: cleanup → runtime → squash.                                 |
| Proxy    | `caddy:2.11-alpine`                                                   | ~88 MB              | Eine Stufe.                                                           |

Das Aufspalten von Convex aus dem Platform-Image senkte die Platform-Schicht von rund 2,58 GB komprimiert auf rund 320 MB; der neue convex-Service ist rund 485 MB. Die Netto-Image-Disk ist ähnlich, aber die Platform-Schicht baut für reine App-Änderungen viel schneller — die meisten `Pull Requests` berühren nur die SPA oder den Bun-Server, und das Platform-Image ist das, das die CI bei jedem Merge neu baut.

## Port-Mapping

### Entwicklungs-Ports (`compose.yml`)

| Dienst   | Host-Port | Container-Port   | Protokoll            |
| -------- | --------- | ---------------- | -------------------- |
| DB       | 5432      | 5432             | TCP (PostgreSQL)     |
| Crawler  | 8002      | 8002             | HTTP                 |
| RAG      | 8001      | 8001             | HTTP                 |
| Convex   | —         | 3210, 3211, 6791 | WS/HTTP (über Proxy) |
| Platform | —         | 3000             | HTTP (über Proxy)    |
| Proxy    | 80, 443   | 80, 443          | HTTP/HTTPS           |

### Test-Ports (`compose.test.yml`)

| Dienst   | Host-Port           | Container-Port   |
| -------- | ------------------- | ---------------- |
| DB       | 15432               | 5432             |
| Crawler  | 18002               | 8002             |
| RAG      | 18001               | 8001             |
| Convex   | 13210, 13211, 16791 | 3210, 3211, 6791 |
| Platform | 13000               | 3000             |
| Proxy    | 10080, 10443        | 80, 443          |

Die Entwicklungs-Compose-Datei exponiert die vier Backend-Ports auf dem Host (5432, 8001, 8002) für direkten Zugriff vom Entwickler-Laptop; die von `tale deploy` erzeugte Produktions-Compose tut das nicht — jeder Backend-Port bleibt auf der internen Bridge.

## Volume-Mapping

| Volume          | Gemountet in               | Pfad                                 | Zweck                                                                                                                                              |
| --------------- | -------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db-data`       | DB                         | `/var/lib/postgresql/data`           | PostgreSQL-Datenverzeichnis.                                                                                                                       |
| `db-backup`     | DB                         | `/var/lib/postgresql/backup`         | Datenbank-Backups.                                                                                                                                 |
| `rag-data`      | RAG                        | `/app/data`                          | Temp-Dateien, Dokumenten-Verarbeitung.                                                                                                             |
| `crawler-data`  | Crawler                    | `/app/data`                          | Website-Register, URL-Datenbanken.                                                                                                                 |
| `convex-data`   | Convex                     | `/app/data`                          | Convex-DB (SQLite/pg-local), Suchindizes, Dateien, geseedete JSON für Agents, Workflows, Integrationen und Anbieter.                               |
| `convex-data`   | Platform                   | `/app/data` _(read-only)_            | Config-SSE-Watcher und Branding-Image-Auslieferung.                                                                                                |
| `convex-data`   | Crawler, RAG               | `/app/platform-config` _(read-only)_ | Geteilte Anbieter-Konfiguration.                                                                                                                   |
| `caddy-data`    | Proxy, Convex              | `/data`, `/caddy-data`               | TLS-Zertifikate.                                                                                                                                   |
| `caddy-config`  | Proxy                      | `/config`                            | Caddy-Konfiguration.                                                                                                                               |
| `platform-data` | — _(Altlast, ungemountet)_ | —                                    | Nach dem Convex-Split-Upgrade aus Rollback-Sicherheit erhalten. Manuell mit `docker volume rm ...` entfernen, nachdem der Split verifiziert wurde. |

Fahre `docker compose down -v` nie. Das `-v`-Flag löscht jedes benannte Volume, also die Datenbank, jede hochgeladene Datei, den Crawler-Zustand, die TLS-Zertifikate. Es gibt keine Wiederherstellung.

## Build-Argumente

| Argument            | Voreinstellung | Genutzt von | Beschreibung                                      |
| ------------------- | -------------- | ----------- | ------------------------------------------------- |
| `VERSION`           | `dev`          | Alle        | Image-Versions-Tag, von CI aus dem git-Tag.       |
| `INSTALL_CJK_FONTS` | `false`        | Crawler     | CJK-Schrift-Unterstützung installieren (~100 MB). |

## Multi-Stage-Build-Strategie

Jeder Dienst endet mit einer `FROM scratch`-Squash-Stufe. Diese finale Stufe flacht Docker-Layer ab, damit Datei-Löschungen in früheren Cleanup-Stufen Festplattenplatz zurückgewinnen statt nur maskierende Layer hinzufügen; ohne den Squash würde ein `rm -rf` in Stufe vier die gelöschten Bytes im finalen Image trotzdem kosten.

### Platform (5 Stufen, post-Split)

1. `bun-bin` — extrahiert die Bun-Binärdatei.
2. `workspace-deps` — installiert jede npm-Abhängigkeit einschliesslich devDependencies.
3. `builder` — fährt `vite build`, um das SPA-Bundle zu produzieren.
4. `pruner` — installiert Production-only-Deps neu, entfernt Test- und Dev-Pakete.
5. `runner` — finale Laufzeit auf dem `convex-backend`-Basis-Image (behalten für die `generate_key`-glibc-Binary zum Signieren von Convex-Admin-Tokens). Nur Vite-SPA plus Bun-Server — kein Convex-Backend-Prozess.

Eine `squash`-Stufe auf `FROM scratch` dann `COPY --from=runner` produziert das ausgelieferte Image. Der Container läuft kurz als Root, fällt im Entrypoint über `gosu` auf den `app`-Nutzer ab.

### Convex (2 Stufen, neu in Phase 2)

1. `convex-dashboard` — `FROM ghcr.io/get-convex/convex-dashboard`, um den Next.js-Standalone-Build zu kopieren.
2. `runner` — `FROM ghcr.io/get-convex/convex-backend`. Enthält den Local-Backend-Daemon, das Dashboard, die eingebauten Seed-Assets (Agents, Workflows, Integrationen, Anbieter, Branding) und den Entrypoint. Entfernt LLVM und Clang für rund 155 MB Einsparung.

### Crawler (3 Stufen)

1. `builder` — installiert Python-Abhängigkeiten über `uv`, lädt Chromium-`headless_shell` herunter, fährt tiefes Cleanup (entfernt die volle Chrome-Binary, FFmpeg, pip, `__pycache__`, `.so`-Debug-Symbole, Test-Verzeichnisse).
2. `runtime` — sauberes `python:3.11-slim` mit nur den Laufzeit-System-Bibliotheken (Chromium-Deps, tini, curl). Entfernt LLVM und das Adwaita-Icon-Set.
3. `squash` — `FROM scratch` plus `COPY --from=runtime`. Erzeugt vorab Volume-Mountpoints für `/app/data` und `/app/platform-config`.

### RAG (3 Stufen)

1. `builder` — installiert Python-Deps mit `build-essential` und `libpq-dev` zum Kompilieren nativer Pakete, entfernt dann pip und setuptools.
2. `runtime` — sauberes `python:3.11-slim` mit nur `libpq5` und curl. Erzeugt vorab Volume-Mountpoints.
3. `squash` — `FROM scratch` plus `COPY --from=runtime`.

### DB (3 Stufen)

1. `cleanup` — entfernt Debug-Symbole (rund 888 MB), LLVM-Shared-Bibliotheken (rund 127 MB), PostGIS-Erweiterungsdateien, Locales und Docs aus dem ParadeDB-Basis-Image.
2. `runtime` — `FROM scratch` plus `COPY --from=cleanup`. Frische Schicht nur mit den bereinigten Dateien.
3. `squash` — re-deklariert `PGDATA`, `PATH` und die anderen ENV-Variablen, die bei `FROM scratch` verlorengingen.

## Health-Checks

| Dienst   | Endpunkt                                              | Protokoll    | Startphase |
| -------- | ----------------------------------------------------- | ------------ | ---------- |
| DB       | `pg_isready -U tale -d tale`                          | CLI          | 60s        |
| Crawler  | `GET /health` auf :8002                               | HTTP         | 40s        |
| RAG      | `GET /health` auf :8001                               | HTTP         | 40s        |
| Convex   | `GET :3210/version` + `[ -f /tmp/convex-ready ]`      | HTTP + Datei | 60s        |
| Platform | `GET :3000/api/health` + `[ -f /tmp/platform-ready ]` | HTTP + Datei | 180s       |
| Proxy    | `GET /health` auf :2020 (intern)                      | HTTP         | 10s        |

Die `/tmp/<service>-ready`-Marker werden vom Entrypoint jedes Dienstes berührt, nachdem seine einmalige Initialisierungs-Arbeit fertig ist — Convex, nachdem das Backend hoch ist und der eingebaute Seed gelandet ist; die Platform, nachdem die Env-Synchronisation und `convex deploy` erfolgreich waren. Die Marker-Datei ist das, was den Proxy davon abhält, Traffic zu einem Container zu routen, der Verbindungen akzeptiert, aber tatsächlich noch nicht bereit ist, Anfragen zu bedienen.

## Container-Tests

Tale enthält drei Container-Testskripte, die in CI bei jedem `Pull Request` laufen und die du auf einem Entwicklungs-Host vor dem Push fahren kannst:

| Skript                                  | Befehl                              | Was es testet                                                                          |
| --------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| `tests/container-smoke-test.sh`         | `bun run docker:test`               | Baut, startet, Health-Checks, HTTP-Endpunkte, Inter-Service-Konnektivität.             |
| `tests/container-image-test.sh`         | `bun run docker:test:image`         | OCI-Labels, Nicht-Root-Nutzer, keine Secrets, HEALTHCHECK-Instruktion, Grössenbudgets. |
| `tests/container-vulnerability-scan.sh` | `bun run docker:test:vulnerability` | Trivy-Schwachstellenscan (HIGH + CRITICAL).                                            |

Die [Contributing-Docker-Anleitung](/de-CH/develop/contributing-docker) deckt jedes Skript im Detail ab.

## Wo das einsetzt

Die Container-Architektur ist das mentale Modell dafür, was wo läuft und wie die Dienste reden. Greif zu ihr, wenn etwas nicht landet, wo du es erwartest — ein unerreichbarer Metrics-Endpunkt, ein versehentlich exponierter Port, ein Blue-Green-Wechsel, der nicht sauber ausgeblutet ist. Für die Per-Service-Observability-Oberflächen ist [Betrieb](/de-CH/self-hosted/operate/observability/operations) die nächste Seite; für Umgebungs-Variable-Knöpfe ist die [Umgebungsreferenz](/de-CH/self-hosted/configuration/environment-reference) erschöpfend.
