---
title: Compose-Dateien für Beiträge
description: Einen Entwicklungsablauf wählen und verstehen, wie die Compose-Erweiterungen des Repositorys zusammenwirken.
---
Nutze die Compose-Dateien des Repositorys, um Tale aus dem Quellcode zu entwickeln oder zu testen. Im üblichen lokalen Ablauf [laufen App und Backend direkt auf dem Rechner, ihre Abhängigkeiten in Docker](/develop/contributor-setup). Wähle den folgenden Containerablauf, wenn deine Änderung die Entwicklungsimages prüfen soll.

Paketierte selbst gehostete Installationen verwenden den von der CLI erzeugten Stack aus dem [Schnellstart](/self-hosted/install/quickstart). Die Erweiterungsdateien im Quellbaum enthalten Entwicklungsports und Verzeichniseinbindungen. Prüfe sie, bevor du einen Host öffentlich erreichbar machst.

## Die Containerentwicklung starten

Führe die Befehle im Repository-Stamm mit der festgelegten Bun-Version und verfügbarem Docker Compose aus:

```bash
bun install
bun run docker:dev
bun run docker:dev:logs
```

`docker:dev` bereitet Image und Netzwerk der Sandbox vor, erzeugt eine Umgebungserweiterung und startet Basis-, Entwicklungs- und Docs-Konfiguration zusammen. Nutze diesen Einstieg statt nur seinen letzten Compose-Befehl zu kopieren: Die Vorbereitung gehört zum Ablauf. Die generierte Erweiterung reicht die meisten Hostvariablen an den Plattformcontainer weiter. Prüfe deshalb die Umgebung, aus der du sie startest.

Mit `Ctrl-C` beendest du die laufende Protokollanzeige. `bun run docker:dev:down` stoppt diesen Stack. Behalte Datenvolumes und die bestehende Umgebung, wenn du dieselbe Instanz später fortsetzen möchtest. Ein zweiter Worktree braucht eigene Ports, Containernamen und Speicher, um unabhängig zu laufen.

## Eine Erweiterungsdatei wählen

| Datei | Zweck |
| --- | --- |
| `compose.yml` | Basisdienste aus dem Quellcode und ihre Abhängigkeiten. |
| `compose.dev.yml` | Quellcodeeinbindungen und Entwicklungsbefehle. |
| `compose.docs.yml` | Dokumentationsseite und Proxyzuordnung. |
| `compose.web.yml` | Marketingseite und Proxyzuordnung. |
| `compose.test.yml` | Containertests der Plattform. |
| `compose.docs.test.yml` | Containertests der Dokumentation. |
| `compose.web.test.yml` | Containertests der Marketingseite. |
| `compose.test.mock.yml` | Integrationskonfiguration mit simulierten Diensten. |

Lies vor dem direkten Aufruf einer Testerweiterung das zugehörige Skript. Es kann Images, Ports und Testdaten vorbereiten. Die passenden Prüfungen beschreibt [An Docker arbeiten](/develop/contributing-docker).

## Die Zusammenführung prüfen

Compose wendet Dateien von links nach rechts an. Spätere Dateien überschreiben oder ergänzen frühere Einträge nach den Zusammenführungsregeln von Compose. So prüfst du die Dienstnamen, ohne die aufgelöste Umgebung samt Geheimnissen auszugeben:

```bash
docker compose -f compose.yml -f compose.dev.yml -f compose.docs.yml config --services
```

Der Befehl prüft die statischen Dateien. `docker:dev` ergänzt seine erzeugte Umgebungsdatei. Ein vollständiges `docker compose config` kann aufgelöste Zugangsdaten ausgeben. Halte diese Ausgabe aus öffentlichen Protokollen und Fehlerberichten heraus.

## Die wichtigsten Dienste verstehen

Der Quellcode-Stack trennt `backend-api` und `backend-worker`. Die API verarbeitet Anwendungsanfragen und Anmeldung; der Worker führt Aufgaben, Modellaufrufe und Wissensverarbeitung aus. `platform` stellt die Webanwendung bereit. `proxy` verteilt Anfragen; `db`, `knowledge-db` und `object-store` speichern Anwendungsdaten, Wissen und Dateien.

`sandbox`, `sandbox-egress` und `sandbox-llm-gateway` ermöglichen isolierte Ausführung samt Netzwerk- und Modellzugriff. Der Quellcode-Stack enthält außerdem den Hilfsdienst zur Videoverarbeitung. Die Produktivtopologie kann abweichen: Der generierte Einzelhost-Stack kombiniert Anwendungs- und Wissensdatenbank. Zuständigkeiten erklärt [Containerarchitektur](/self-hosted/operate/container-architecture), die Konfiguration die [Umgebungsreferenz](/self-hosted/configuration/environment-reference).

## Den ersten Fehler eingrenzen

Lies bei einer fehlgeschlagenen Vorbereitung den ersten Fehler des Startskripts, bevor du Compose wiederholst. Prüfe bei Imagefehlern Docker und den Imagebau, bei fehlendem Sandbox-Netz die Netzwerkerstellung und bei Konflikten mit einem zweiten Checkout belegte Ports oder vorhandene Container. Sieh dir `docker compose ps` und die Protokolle des betroffenen Dienstes an. Entferne keine Volumes, um einen Startfehler zu beheben: Damit geht der Zustand verloren, den du zur Reproduktion brauchst.
