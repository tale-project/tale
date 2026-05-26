---
title: Zu Docker-Images beitragen
description: Wie du die Docker-Images von Tale für Forks, vendored Builds oder Air-gapped-Distributionen baust und erweiterst.
---

Jeder Container, den Tale ausliefert, hat sein Dockerfile im öffentlichen Quell-Repo. Forks, Air-gapped-Distributionen und einmalige Patches starten alle aus denselben Dateien; diese Seite ist der Operator-Durchgang durch das Selber-Bauen der Images, wo die Anpassungs-Nähte leben und wie du einen Fork mit Upstream synchron hältst, ohne bei den langweiligen Teilen abzudriften.

Die Container-Architektur lebt in [Container-Architektur](/de/self-hosted/operate/container-architecture); diese Seite ist das, was du liest, wenn die veröffentlichten Images nicht passen und du deine eigenen bauen musst.

## Was die Images sind

Acht Images, ein Dockerfile je, alle unter `services/<name>/`:

| Image                 | Quell-Pfad                 | Basis                |
| --------------------- | -------------------------- | -------------------- |
| `tale-proxy`          | `services/proxy/`          | Caddy                |
| `tale-platform`       | `services/platform/`       | Bun + Debian slim    |
| `tale-convex`         | `services/convex/`         | Convex local-backend |
| `tale-db`             | `services/db/`             | ParadeDB (Postgres)  |
| `tale-rag`            | `services/rag/`            | Python + FastAPI     |
| `tale-crawler`        | `services/crawler/`        | Crawl4AI             |
| `tale-sandbox`        | `services/sandbox/`        | Bun + Docker-CLI     |
| `tale-sandbox-egress` | `services/sandbox-egress/` | Alpine + tinyproxy   |

Die zwei Compose-Dateien im Repo-Root (`compose.yml` für Development, die CLI-generierte Produktions-Compose) referenzieren diese über `ghcr.io/tale-project/tale/<image>:<tag>`. Ein lokaler Build ersetzt den Registry-Pull mit einem `build:`-Block in Compose.

## Lokal bauen

Ein erster Build jedes Images dauert etwa 15 Minuten auf einem aktuellen Laptop; nachfolgende Builds treffen den Layer-Cache von Docker und sind in unter einer Minute fertig für das Image, das du geändert hast.

```bash
# Bau jedes Image in compose.yml
docker compose build

# Bau ein Image
docker compose build platform
```

Setze `PULL_POLICY=build` in deiner Umgebung (oder in `.env`), um Compose zu zwingen zu bauen, statt das veröffentlichte Image zu ziehen. Die ausgelieferte `compose.yml` defaultet auf `build`, also baut ein lokales Clone ohne Overrides bereits; Produktions-Compose-Dateien, die `tale deploy` generiert, defaulten auf `always` und ziehen aus der Registry.

## Die Anpassungs-Nähte

Die unterstützten Erweiterungs-Punkte für Forks sind auf der Dockerfile-Ebene. Der Entrypoint des Images und die Konfigurationsdateien darin sind stabil — patche sie, bau das Image, und der Rest des Systems muss es nicht wissen.

- **Caddyfile** — `services/proxy/Caddyfile` steuert Routing und TLS-Terminierung. Custom Header, Custom Subdomains und Custom Rate-Limits landen hier.
- **Plattform-Plop-Templates** — `services/platform/Dockerfile` läuft einen Build-Schritt, der die Messages, das Schema und die statischen Assets einbäckt. Ein Fork, der Custom-UI-Strings oder zusätzliche Routes ausliefert, baut das Plattform-Image.
- **RAG-Dokument-Extraktoren** — `services/rag/app/routers/documents.py` ist, wo neue Datei-Formate registrieren; ein Fork, der einen Extraktor für ein proprietäres Datei-Format braucht, patcht hier.
- **Sandbox-Egress-Allowlist** — `services/sandbox-egress/tinyproxy.conf` ist, was die Runtime-Allowlist kompiliert. Der Runtime-Pfad läuft durch den [Run-Code-Richtlinien](/de/platform/admin/governance/run-code-policy)-Bildschirm; der Build-Zeit-Default lebt hier.

Was keine unterstützte Naht ist: der Runtime-Code des Plattform-Containers (`services/platform/app/`) — diese Dateien sind Anwendungscode, keine Konfiguration. Patches dort sind ein echter Fork und tragen die Upgrade-Steuer.

## Taggen und in eigene Registry pushen

Für Air-gapped- oder vendored Distributionen ist der Pfad „bauen, taggen, in deine Registry pushen, die `image:`-Zeilen in Compose ändern".

```bash
# Bauen, taggen, pushen
export REGISTRY=registry.internal.example.com/tale
docker compose build
docker tag ghcr.io/tale-project/tale/tale-platform:latest \
  $REGISTRY/tale-platform:vendored-1.0
docker push $REGISTRY/tale-platform:vendored-1.0
```

Der Deploy des CLI generiert eine Compose-Datei mit dem Registry-Pfad; entweder patche die generierte Datei nach der Generierung, oder überspring das CLI und läufe `docker compose` direkt gegen eine Compose-Datei, die du selbst pflegst.

## Mit Upstream synchron bleiben

Der günstige Pfad ist ein Fork auf GitHub, der periodisch von `tale-project/tale@main` mergt. Konflikte landen in den Dateien, die du gepatched hast; der Rest geht sauber durch. Die zwei Anti-Patterns:

- **Anwendungscode patchen, statt ihn zurückzubeitragen.** Ist die Änderung breit nützlich, upstream einen PR — jede Release-Steuer geht runter.
- **Auf ein altes Base-Image pinnen.** Die Caddy-, Bun- und Postgres-Basen nehmen Sicherheits-Patches beim Rebuild auf; die Basis für „Stabilität" zu pinnen heisst Ärger borgen.

## Wo das hingehört

Diese Seite ist die contributor-seitige Naht der Operator-Story. Die Architektur-Übersicht lebt in [Container-Architektur](/de/self-hosted/operate/container-architecture); der Upgrade-Workflow, der die veröffentlichten Images läuft, ist in [Upgrades](/de/self-hosted/operate/upgrades). Ist dein Fork nicht-trivial, ist das Gespräch, das es wert ist anzufangen, bevor du Code schreibst, das auf dem Discord oder den GitHub Discussions des Projekts — viele Forks enden als Features, die darauf warten, Upstream zu landen.
