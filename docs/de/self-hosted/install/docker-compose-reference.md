---
title: Docker-Compose-Referenz
description: Welche Compose-Datei mit Tale ausgeliefert wird, wofür jede gut ist, und wie die Schichtung funktioniert, wenn du Dev-, Docs- oder Test-Kombinationen hochfährst.
---

Tale liefert eine Handvoll Docker-Compose-Dateien aus. Die Basis ist `compose.yml`; der Rest sind Overlays, die Services für spezifische Szenarien hinzufügen oder ersetzen — Entwicklung, Docs, Test. Diese Seite benennt jede Datei, sagt, wann du sie wählst, und gibt die Schichtungs-Regel, der alles andere folgt.

Die Form ist absichtlich konservativ. Die Basis-Datei ist ein Build-from-Source-Stack für lokale Entwicklung und Smoke-Tests — **nicht** Produktion; jedes Overlay ist per `-f` opt-in und fügt nur hinzu, was es muss. Eine produktive Instanz wird von der [`tale`-CLI](/de/self-hosted/install/cli-install) (`tale deploy`) generiert und gerollt, die ihr eigenes sicheres compose inline schreibt — nur `80`/`443` exponiert — und diese Dateien nie verwendet. Merk dir die Basis und ein einzelnes Overlay, nicht das ganze Raster.

## Ein durchgespieltes compose-up

Die Basis-Datei baut jedes Image aus dem Quellcode und läuft mit diesem eingefrorenen Build. Sie exponiert Ports, die nie öffentlich sein dürfen (`5432`, `8003`), und bootet mit unsicheren Dev-Secret-Defaults, ist also für lokale Smoke-Tests, nicht für eine öffentliche Instanz:

```bash
docker compose up -d
```

Ein Entwickler, der gleichzeitig an Platform und Docs hackt, schichtet zwei Overlays für Live-Quellen und Hot-Reload:

```bash
docker compose -f compose.yml -f compose.dev.yml -f compose.docs.yml up -d
```

Die linkeste Datei ist die Basis; jede nachfolgende Datei merged ihre Schlüssel obendrauf. Konflikte (gleicher Service, gleicher Schlüssel) lösen mit Last-File-wins auf. Der gemergte Graph ist, was Docker hochfährt.

## Die Compose-Dateien

| Datei                   | Anwendungsfall                                       | Bemerkenswerte Overrides                                                |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `compose.yml`           | Lokale Dev-Basis (Build aus dem Quellcode)           | Die Basis — jeder Service, Healthchecks, Restart-Policy                 |
| `compose.dev.yml`       | Lokale Entwicklung mit Hot-Reload                    | Bind-mountet Host-Quellen für Hot-Reload; liefert unsichere Dev-Secrets |
| `compose.docs.yml`      | Fügt den Docs-Site-Service hinzu                     | Fährt `tale-docs` hoch und routet `/docs` durch den Proxy               |
| `compose.web.yml`       | Fügt den Marketing-Site-Service hinzu                | Fährt `tale-web` hoch und routet `/` (Root) durch den Proxy             |
| `compose.test.yml`      | Lässt die Platform-Test-Suite gegen den Stack laufen | Ersetzt das Platform-Image durch die test-geformte Variante             |
| `compose.web.test.yml`  | Lässt Web-Tests laufen                               | Wie `web.yml`, aber die test-geformte Variante                          |
| `compose.docs.test.yml` | Lässt Docs-Tests laufen                              | Wie `docs.yml`, aber die test-geformte Variante                         |
| `compose.test.mock.yml` | Mock-gestützte Connectorstests                       | Tauscht Provider gegen Mock-Implementierungen                           |

## Services und ihre Rollen

Der Basis-Graph fährt elf Container hoch:

- `tale-proxy` — Caddy. TLS, Reverse-Proxy, 301s.
- `tale-platform` — der Web-Tier: eine Vite- + TanStack-Router-SPA plus der Bun-Server, der sie ausliefert, Branding und der Config-SSE-Watch.
- `tale-backend-api` — das Application-Backend in der `api`-Rolle (`TALE_ROLE=api`). Jede Anwendungstür: die App-API, Auth, der SSE-Hinweis-Stream und die Maschinentüren.
- `tale-backend-worker` — dasselbe Image in der `worker`-Rolle. Der Job-Runner hinter Schedules und Agent-Turns sowie die In-Process-Dokument-Ingestion, das Web-Crawling, die RAG-Indexierung und die Dokumentgenerierung, die früher separate Services waren.
- `tale-db` — operatives Postgres (ParadeDB). Der `tale_app`-Anwendungsspeicher, auf Port 5432.
- `tale-knowledge-db` — Postgres des Wissens-Korpus (ParadeDB). Die `tale_knowledge`-Datenbank mit Dokument-Chunks, Embeddings und gecrawlten Seiten, auf Port 5433, damit sie nie mit `tale-db` auf 5432 kollidiert. (Ein `tale deploy`-Produktions-Stack faltet dies stattdessen in `tale-db` — siehe [Architektur-Übersicht](/de/self-hosted/overview).)
- `tale-object-store` — MinIO, das S3-kompatible Blob-Backend für Uploads, Anhänge und generierte Medien (rein intern).
- `tale-sandbox-llm-gateway` — das LLM-Gateway für Harness-Turns.
- `tale-sandbox-egress` und `tale-sandbox` — die Sandbox-Ebene. Run-Code-Container hinter einem Egress-Proxy (standardmäßig offen; sperrbar mit `SANDBOX_EGRESS_ALLOWLIST`), zugleich die Headless-Browser-Laufzeit, die das Backend für Web-Render und Dokumentgenerierung aufruft.
- `tale-bgutil-provider` — ein Drittanbieter-Sidecar, der YouTube-PO-Tokens für die Video-Link-Ingestion liefert.

Es gibt keinen separaten Python-Service im Graph — die Wissens-Arbeit (RAG, Crawling, Dokumentgenerierung) läuft jetzt im Backend-Worker. [Container-Architektur](/de/self-hosted/operate/container-architecture) vertieft, was was besitzt.

## Overrides

Operator-Anpassungen gehören in ein zusätzliches Overlay, nicht in Edits an den ausgelieferten Dateien. Erstell eine `compose.local.yml` mit den Overrides, die du brauchst:

```yaml
services:
  platform:
    environment:
      - LOG_LEVEL=debug
```

Fahr den Stack mit dem lokalen Overlay zuletzt geschichtet hoch:

```bash
docker compose -f compose.yml -f compose.local.yml up -d
```

Dieses Muster hält `git pull` sauber — keine Merge-Konflikte auf den ausgelieferten Dateien. Dasselbe Muster funktioniert für jedes benutzerdefinierte Volume-Mount, jeden benutzerdefinierten Port oder jedes Environment-Override.

## Wo das hineinpasst

Die Compose-Referenz ist das Raster des Betreibers für den Source-Tree. Für das Innere jedes Containers deckt die Seite [Container-Architektur](/de/self-hosted/operate/container-architecture) Verantwortlichkeiten ab; für die Variablen, die die Container beim Boot lesen, ist die [Environment-Referenz](/de/self-hosted/configuration/environment-reference) die Quelle der Wahrheit.
