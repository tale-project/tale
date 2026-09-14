---
title: Tale-Images bauen und pflegen
description: Wähle das passende Dockerfile, baue ein lokales Image, prüfe sein Verhalten und veröffentliche geprüfte Images in deiner Registry.
---

Baue ein Image, wenn du Container-Abhängigkeiten, Startverhalten oder den enthaltenen Anwendungscode änderst. Du brauchst einen Quellcode-Checkout nach [Entwicklungsumgebung einrichten](/de/develop/contributor-setup), einen laufenden Docker-Daemon und Zugriff auf die im Dockerfile verwendeten Image- und Paketregistries.

Ein erfolgreicher Build belegt, dass sich das Image erzeugen lässt. Starte es in einem getrennten Entwicklungsstack und prüfe das geänderte Verhalten, bevor du es bereitstellst.

## Die Images unterscheiden

Die Dockerfiles verwenden das Repository-Stammverzeichnis als Build-Kontext. Exakte Basisversionen und Build-Argumente stehen im jeweiligen Dockerfile. Die Tabelle erklärt die Aufgaben der Images.

| Image | Dockerfile-Verzeichnis | Inhalt und Aufgabe |
| --- | --- | --- |
| `tale-platform` | `services/platform/` | Debian-basiertes Anwendungsimage mit gebautem Webclient und nativem Backend. Build-Stufen nutzen Bun und Node; API und Worker verwenden dasselbe Image. |
| `tale-db` | `services/db/` | PostgreSQL mit den mitgelieferten Such- und Vektorerweiterungen auf ParadeDB-Basis. Anwendungs- und Wissensdatenbank nutzen es gemeinsam. |
| `tale-proxy` | `services/proxy/` | Caddy-Konfiguration und Proxy-Start. |
| `tale-sandbox` | `services/sandbox/` | Sandbox-Verwaltung mit Bun und Docker-CLI. |
| `tale-sandbox-runtime` | `services/sandbox-runtime/` | Python-basierte Ausführungsumgebung mit Coding-Harnesses, Node, Bun, Browsern und Dokumentwerkzeugen. |
| `tale-sandbox-egress` | `services/sandbox-egress/` | Alpine-basierter ausgehender Proxy mit DNS-Unterstützung. |
| `tale-sandbox-buildkitd` | `services/sandbox-buildkitd/` | BuildKit mit Netzwerk- und Startkonfiguration der Sandbox. |
| `tale-sandbox-llm-gateway` | `services/sandbox-llm-gateway/` | Modell-Gateway auf Bifrost-Basis. |

Objektspeicher und Sidecar für Videoverarbeitung verwenden direkt bereitgestellte Upstream-Images. Dafür gibt es kein Tale-Dockerfile. Sandbox-Runtime und BuildKit werden bei Bedarf gestartet. Ein Build der Compose-Dienste baut diese Images daher nicht automatisch mit.

## Lokal bauen

Führe diesen isolierten Proxy-Build im Repository-Stammverzeichnis aus:

```bash
docker build -f services/proxy/Dockerfile -t tale-proxy:docs-review .
```

Der lokale Tag `docs-review` unterscheidet das Ergebnis von einem veröffentlichten Release. Erst nach erfolgreichem Build kannst du es testen oder für die Weitergabe markieren.

Dienste mit einer `build:`-Definition in der Repository-Compose-Datei baust du so:

```bash
docker compose build platform
```

Ohne Dienstnamen wählt `docker compose build` alle Dienste mit einer Build-Definition. Dauer und Voraussetzungen hängen von Cache, Netzwerk, Zielplattform und Image ab. Ein Browser- oder Anwendungsimage braucht andere Schritte als der Proxy.

Die Repository-Compose-Datei setzt `PULL_POLICY` standardmäßig auf `build`. Erzeugte Produktionsdateien laden normalerweise Release-Images. Unter [Compose-Dateien](/de/develop/compose-files) findest du den vorgesehenen Entwicklungsstart, der auch zusätzliche Dienste und Images vorbereitet.

## Den passenden Änderungsort wählen

Wähle die kleinste Änderung, die deinen Bedarf erfüllt:

| Bedarf | Einstiegspunkt |
| --- | --- |
| Routing, TLS oder öffentliche Header | `services/proxy/Caddyfile` und Proxy-Konfiguration. Prüfe danach Rückleitungen und Streaming. |
| Oberfläche, Backend oder Extraktion | Anwendungscode unter `services/platform/`, anschließend Image-Build und passende Tests. |
| Pakete oder Browser in Agentensitzungen | `services/sandbox-runtime/Dockerfile`. Prüfe das geänderte Image in einer neuen Sitzung. |
| Ausgehende Sandbox-Verbindungen | Zuerst vorhandene Umgebungsoptionen; nur bei Bedarf Proxy-Vorlagen und Startcode. |
| BuildKit-Verhalten | `services/sandbox-buildkitd/` einschließlich der Netzwerkannahmen. |

Entrypoints, Zustandsprüfungen und interne Pfade gehören zum Implementierungsvertrag. Ein Fork muss Änderungen daran über Upgrades hinweg pflegen und testen. Reine Konfigurationsänderungen benötigen möglicherweise kein neues Image; siehe [Compose selbst betreiben](/de/self-hosted/install/own-compose).

## In deiner Registry veröffentlichen

Lege nach dem Test deinen Registry-Namensraum und einen unveränderlichen Tag fest. Dieses Beispiel veröffentlicht nur das zuvor gebaute Proxy-Image, keinen vollständigen Deployment-Satz. Du brauchst eine Registry-Anmeldung mit Schreibberechtigung.

```bash
export REGISTRY=registry.internal.example.com/tale
export IMAGE_TAG=reviewed-build-1
docker tag tale-proxy:docs-review "$REGISTRY/tale-proxy:$IMAGE_TAG"
docker push "$REGISTRY/tale-proxy:$IMAGE_TAG"
```

Notiere Digest, Quell-Commit und Build-Plattform. Stelle alle am Ziel benötigten Images bereit, auch Sandbox-Images und Upstream-Abhängigkeiten. Eine Offline-Umgebung braucht zusätzlich einen Plan für Pakete, Browser-Downloads und Modellzugriff. Ein einzelnes übertragenes Image macht das Gesamtsystem nicht unabhängig.

Die CLI liest den Tale-Image-Namensraum aus `GHCR_REGISTRY`. Die ausgewählte Version bestimmt weiterhin den Tag. Veröffentliche deshalb die Namen und Versionstags, die das Deployment erwartet. Unabhängig festgelegte Images und Quell-Commits beschreibt die [Referenz für verwaltete Deployments](/de/self-hosted/install/cli-install#managed-deployments).

## Mit Upstream aktuell bleiben

Versioniere deine Quelländerungen und prüfe Upstream-Änderungen vor dem nächsten Build. Halte Basisversionen oder Digests beim Build fest. Aktualisiere diese Referenzen bewusst: Ein unveränderter Pin lädt durch einen erneuten Build nicht automatisch eine neuere Version.

Prüfe vor der Bereitstellung Startrolle, Zustandsprüfungen, öffentliche Routen und die geänderte Funktion. Bei Sandbox-Änderungen gehören eine neue Sitzung und deren Netzwerkaufrufe dazu. Bringe allgemein nützliche Korrekturen möglichst upstream ein, damit dein Fork weniger eigenen Code pflegen muss.

## Build- und Startfehler eingrenzen

| Symptom | Nächste Prüfung |
| --- | --- |
| Eine Quelle für `COPY` fehlt | Nutze das Repository-Stammverzeichnis als vorgesehenen Kontext und prüfe `.dockerignore` sowie den Quellpfad. |
| Paket- oder Image-Download scheitert | Prüfe Registry-Zugriff, Anmeldung und den ersten fehlgeschlagenen Build-Schritt. |
| Das gebaute Image beendet sich beim Start | Lies die Container-Protokolle und prüfe Umgebung, Mounts und Rolle. |
| Eine Sandbox nutzt weiterhin alte Pakete | Prüfe das eingestellte Runtime-Image und starte eine neue Sitzung. Ein neuer Image-Tag ersetzt keinen laufenden Container. |

Die [Container-Architektur](/de/self-hosted/operate/container-architecture) erklärt Abhängigkeiten; [Upgrades](/de/self-hosted/operate/upgrades) beschreibt Bereitstellung und Wiederherstellung.
