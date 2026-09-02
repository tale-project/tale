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

Der Basis-Graph fährt zehn Container hoch:

- `tale-proxy` — Caddy. TLS, Reverse-Proxy, 301s. Er veröffentlicht ausserdem den Bucket-Pfad des Blob-Stores, damit präsignierte URLs im Browser funktionieren.
- `tale-platform` — die TanStack-Start-App. Die User-zugewandte UI, die statischen Assets und die öffentliche `/status`-Seite.
- `backend-api` — das Anwendungs-Backend: ein Node-Prozess, der jede Tür unter `/api/` bedient, plus `/events`, `/dav` und die Maschinen-API. Die Wissens-Suche läuft in diesem Prozess.
- `backend-worker` — dasselbe Image in der Worker-Rolle, das die pg-boss-Job-Warteschlange abarbeitet: Dokument-Ingestion und Embedding, Web-Crawling, Automation-Runs, Retention-Sweeps. Er bedient kein HTTP. Beide Backend-Services nehmen `--scale`, und deshalb hat keiner einen festen Container-Namen.
- `tale-db` — operatives Postgres (ParadeDB). Die `tale_app`-Datenbank: Anwendungs-State, Sessions und die Job-Warteschlange.
- `tale-object-store` — der Blob-Store (MinIO). Jedes hochgeladene Dokument, jeder Chat-Anhang, jede Audiodatei und jedes generierte Medium. Nur intern erreichbar.
- `tale-knowledge-db` — Postgres des Wissens-Korpus (ParadeDB). Die `tale_knowledge`-Datenbank mit Dokument-Chunks, Embeddings und gecrawlten Seiten, auf Port 5433, damit sie nie mit `tale-db` auf 5432 kollidiert.
- `tale-sandbox-llm-gateway` — das LLM-Gateway für Harness-Züge (gepinntes externes Image).
- `tale-sandbox-egress` und `tale-sandbox` — die Sandbox-Ebene. Run-Code-Container hinter einem Egress-Proxy (standardmäßig offen; sperrbar mit `SANDBOX_EGRESS_ALLOWLIST`), zugleich die Headless-Browser-Laufzeit, die das Backend für Web-Render und Dokumentgenerierung aufruft.

Dazu kommt ein `bgutil-provider`-Sidecar für die YouTube-Ingestion; er ist best-effort, und der Stack funktioniert ohne ihn. Ein Single-Host-`tale deploy`-Stack lässt `tale-knowledge-db` weg und faltet den Korpus in `tale-db` unter dem Netzwerk-Alias `knowledge-db`.

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

## Wo das hineinpasst

Die Compose-Referenz ist das Raster des Betreibers für den Source-Tree. Für das Innere jedes Containers deckt die Seite [Container-Architektur](/de/self-hosted/operate/container-architecture) Verantwortlichkeiten ab; für die Variablen, die die Container beim Boot lesen, ist die [Environment-Referenz](/de/self-hosted/configuration/environment-reference) die Quelle der Wahrheit.
