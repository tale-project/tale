---
title: Docker-Compose-Referenz
description: Welche Compose-Datei mit Tale ausgeliefert wird, wofür jede gut ist, und wie die Schichtung funktioniert, wenn du Dev-, Docs- oder Test-Kombinationen hochfährst.
---

Tale liefert eine Handvoll Docker-Compose-Dateien aus. Die Basis ist `compose.yml`; der Rest sind Overlays, die Services für spezifische Szenarien hinzufügen oder ersetzen — Entwicklung, Docs, Test. Diese Seite benennt jede Datei, sagt, wann du sie wählst, und gibt die Schichtungs-Regel, der alles andere folgt.

Die Form ist absichtlich konservativ. Die Basis-Datei allein läuft in Produktion; jedes Overlay ist per `-f` opt-in und fügt nur hinzu, was es muss. Merk dir die Basis und ein einzelnes Overlay, nicht das ganze Raster.

## Ein durchgespieltes compose-up

Eine produktive Single-Host-Instanz läuft allein aus der Basis:

```bash
docker compose up -d
```

Ein Entwickler, der gleichzeitig an Platform und Docs hackt, schichtet zwei Overlays:

```bash
docker compose -f compose.yml -f compose.dev.yml -f compose.docs.yml up -d
```

Die linkeste Datei ist die Basis; jede nachfolgende Datei merged ihre Schlüssel obendrauf. Konflikte (gleicher Service, gleicher Schlüssel) lösen mit Last-File-wins auf. Der gemergte Graph ist, was Docker hochfährt.

## Die Compose-Dateien

| Datei                   | Anwendungsfall                                       | Bemerkenswerte Overrides                                                  |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `compose.yml`           | Produktion auf einem einzelnen Host                  | Die Basis — jeder Service, Healthchecks, Restart-Policy                   |
| `compose.dev.yml`       | Lokale Entwicklung mit Hot-Reload                    | Mountet Quellen in Container, tauscht auf Dev-Images, gibt Dev-Ports frei |
| `compose.docs.yml`      | Fügt den Docs-Site-Service hinzu                     | Fährt `tale-docs` hoch und routet `/docs` durch den Proxy                 |
| `compose.web.yml`       | Fügt den Marketing-Site-Service hinzu                | Fährt `tale-web` hoch und routet `/` (Root) durch den Proxy               |
| `compose.test.yml`      | Lässt die Platform-Test-Suite gegen den Stack laufen | Ersetzt das Platform-Image durch die test-geformte Variante               |
| `compose.web.test.yml`  | Lässt Web-Tests laufen                               | Wie `web.yml`, aber die test-geformte Variante                            |
| `compose.docs.test.yml` | Lässt Docs-Tests laufen                              | Wie `docs.yml`, aber die test-geformte Variante                           |
| `compose.test.mock.yml` | Mock-gestützte Connectorstests                       | Tauscht Provider gegen Mock-Implementierungen                             |

## Services und ihre Rollen

Der Basis-Graph fährt acht Container hoch:

- `tale-proxy` — Caddy. TLS, Reverse-Proxy, 301s.
- `tale-platform` — die TanStack-Start-App. Die User-zugewandte UI und API.
- `tale-convex` — das Convex-Backend. WebSocket, Queries, Mutationen, Actions — und die In-Process-RAG-Suche, Dokument-Ingestion, das Web-Crawling und die Dokumentgenerierung, die früher separate Services waren.
- `tale-db` — operatives Postgres (ParadeDB). Der persistente Speicher des Convex-Backends.
- `tale-knowledge-db` — Postgres des Wissens-Korpus (ParadeDB). Die `tale_knowledge`-Datenbank mit Dokument-Chunks, Embeddings und gecrawlten Seiten, auf Port 5433, damit sie nie mit `tale-db` auf 5432 kollidiert.
- `tale-sandbox-llm-gateway` — das LLM-Gateway für Sandbox-Agents (gepinntes externes Image).
- `tale-sandbox-egress` und `tale-sandbox` — die Sandbox-Ebene. Run-Code-Container hinter einem Egress-Proxy (standardmäßig offen; sperrbar mit `SANDBOX_EGRESS_ALLOWLIST`), zugleich die Headless-Browser-Laufzeit, die das Convex-Backend für Web-Render und Dokumentgenerierung aufruft.

Der Stack ist jetzt vollständig TypeScript — es gibt keinen Python-Service im Graph. [Container-Architektur](/de/self-hosted/operate/container-architecture) vertieft, was was besitzt.

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

## Profile

Ein Service in der Basis-Datei nutzt ein Docker-Compose-Profil. Profile lassen einen Service im Graph existieren, aber nicht starten, ausser sein Profil ist aktiviert. Das im Einsatz befindliche Profil ist `controller` — der Opt-in-Sidecar `tale-controller`, der den Convex-Container auf eine signierte Anfrage neu startet, damit eine Datenresidenz-Änderung greift, ohne der Plattform Docker-Socket-Zugriff zu geben. Aktivier es mit:

```bash
docker compose --profile controller up -d
```

## Wo das hineinpasst

Die Compose-Referenz ist das Raster des Betreibers für den Source-Tree. Für das Innere jedes Containers deckt die Seite [Container-Architektur](/de/self-hosted/operate/container-architecture) Verantwortlichkeiten ab; für die Variablen, die die Container beim Boot lesen, ist die [Environment-Referenz](/de/self-hosted/configuration/environment-reference) die Quelle der Wahrheit.
