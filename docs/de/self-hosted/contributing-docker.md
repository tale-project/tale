---
title: Zu Docker-Images beitragen
description: Wie du die Docker-Images von Tale für Forks, vendored Builds oder Air-gapped-Distributionen baust und erweiterst.
---

Jeder Container, den Tale ausliefert, hat sein Dockerfile im öffentlichen Quell-Repo. Forks, Air-gapped-Distributionen und einmalige Patches starten alle aus denselben Dateien; diese Seite ist der Operator-Durchgang durch das Selber-Bauen der Images, wo die Anpassungs-Nähte leben und wie du einen Fork mit Upstream synchron hältst, ohne bei den langweiligen Teilen abzudriften.

Die Container-Architektur lebt in [Container-Architektur](/de/self-hosted/operate/container-architecture); diese Seite ist das, was du liest, wenn die veröffentlichten Images nicht passen und du deine eigenen bauen musst.

## Was die Images sind

Der Stack ist vollständig TypeScript — kein Python-Image. Jedes Image hat ein Dockerfile unter `services/<name>/`:

| Image                    | Quell-Pfad                    | Basis                        |
| ------------------------ | ----------------------------- | ---------------------------- |
| `tale-proxy`             | `services/proxy/`             | Caddy                        |
| `tale-platform`          | `services/platform/`          | Debian slim + Bun + Node     |
| `tale-db`                | `services/db/`                | ParadeDB (Postgres)          |
| `tale-sandbox`           | `services/sandbox/`           | Bun + Docker-CLI             |
| `tale-sandbox-egress`    | `services/sandbox-egress/`    | Alpine + tinyproxy           |
| `tale-sandbox-runtime`   | `services/sandbox-runtime/`   | Bun + Chromium + Playwright  |
| `tale-sandbox-buildkitd` | `services/sandbox-buildkitd/` | Debian + BuildKit + redsocks |

Beide Datenbank-Container — `db` und `knowledge-db` — bauen aus demselben `tale-db`-ParadeDB-Image; der Unterschied ist die Datenbank, die jeder bedient. Dasselbe Image bedient auch beide Backend-Rollen: `backend-api` und `backend-worker` sind `tale-platform`, gestartet mit einem anderen `TALE_ROLE` — deshalb können sie gegenüber der Web-Schicht nie in einen Versions-Skew laufen. Zwei Container haben kein eigenes Dockerfile: Der Blob-Store ist ein Upstream-MinIO-Image, das Compose direkt referenziert, und `tale-sandbox-llm-gateway` ist ein dünnes Re-Tag des gepinnten Upstream-Gateways `maximhq/bifrost`, das zur Laufzeit nichts ändert. Die Compose-Dateien im Repo-Root (`compose.yml` für Development, die CLI-generierte Produktions-Compose) referenzieren diese über `ghcr.io/tale-project/tale/<image>:<tag>`. Ein lokaler Build ersetzt den Registry-Pull mit einem `build:`-Block in Compose.

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
- **Sandbox-Runtime-Image** — `services/sandbox-runtime/Dockerfile` ist die Ausführungsumgebung für **Code-ausführen**, Web-Render und Dokumentgenerierung; es trägt bereits Chromium und Playwright. Ein Fork, der ein zusätzliches System-Paket oder einen anderen Browser-Build braucht, patcht hier.
- **Sandbox-Egress-Proxy** — `services/sandbox-egress/tinyproxy.conf.template` ist die Proxy-Konfiguration, die der Entrypoint beim Start rendert: standardmäßig offenes Egress, oder ein Default-Deny-Hostname-Filter, wenn `SANDBOX_EGRESS_ALLOWLIST` gesetzt ist. Ein Fork, der anderes Proxy-Verhalten braucht, patcht hier.

Was keine unterstützte Naht ist: der Anwendungscode des Backends (`services/platform/backend/`), inklusive der Dokument-Extraktion und der RAG- und Crawler-Logik, die dort im Prozess laufen, und der Runtime-Code der Web-Schicht (`services/platform/app/`). Diese Dateien sind Anwendungscode, keine Konfiguration — einen Dokumentformat-Extraktor hinzuzufügen oder das Retrieval-Verhalten zu ändern ist ein echter Fork und trägt die Upgrade-Steuer.

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
