---
title: Deine erste selbst gehostete Instanz starten
description: Installiere die CLI, starte Tale lokal, erstelle dein Inhaberkonto und prüfe die erste Chatantwort.
---
Starte Tale lokal mit der veröffentlichten CLI, richte deinen Arbeitsbereich ein und sende eine Nachricht. Dafür musst du weder das Repository klonen noch Bun installieren oder die Anwendung bauen. Die CLI lädt die Container-Images herunter und bereitet die Konfiguration vor.

## Den lokalen Rechner vorbereiten

Du brauchst:

- macOS, Linux oder Windows mit PowerShell sowie Docker mit Linux-Containern und Compose. Docker Desktop enthält Compose unter macOS und Windows. Fehlt Docker, bietet `tale dev` Hilfe bei der Installation an.
- Netzwerkzugriff auf GitHub für die CLI und auf Container-Registries für die Images. Beim ersten Start werden mehrere GB heruntergeladen; plane Platz für Images und deine Daten ein.
- Zugangsdaten für einen unterstützten Modellanbieter, damit du die erste Antwort testen kannst. Dein Konto kannst du schon vorher erstellen und die Anwendung erkunden.

Auf ARM64, auch auf Apple Silicon, benötigt der mitgelieferte Objektspeicher eine amd64-Emulation. Docker Desktop bringt sie mit; auf einem eigenständigen Linux-Docker-Host musst du sie separat einrichten. Prüfe vor dem Start auf ARM64 Linux die [Architekturanforderungen](/de/self-hosted/install/cli-install#bevor-du-beginnst).

Der HTTPS-Port ist standardmäßig `443`; der Sandbox-Dienst verwendet außerdem `127.0.0.1:8003`. Halte die Instanz privat, bis du ihr Inhaberkonto erstellt hast.

## CLI installieren

Wähle den Installer für dein Betriebssystem:

<Tabs>

<Tab title="macOS / Linux">

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

</Tab>

<Tab title="Windows (PowerShell)">

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

</Tab>

</Tabs>

Prüfe die Installation im selben Terminal mit `tale --version`. Fehlt der Befehl, folge den `PATH`-Hinweisen des Installers und öffne bereits laufende Terminals neu. Die [CLI-Installation](/de/self-hosted/install/cli-install) beschreibt feste Versionen und eigene Installationsverzeichnisse.

Prüfe mit `tale --help`, ob `doctor` verfügbar ist. Fehlt der Befehl, prüfe Docker und Compose mit `docker info` und `docker compose version`. Falls verfügbar, untersucht `tale doctor` zusätzlich die Container-Architektur und lokale Ports, ohne Software zu installieren oder Dateien zu ändern. Folge den angezeigten Hinweisen; ein erfolgreicher Check bestätigt weder Image-Downloads noch den Modellzugriff.

## Initialisieren und starten

Wähle einen Ort für dein Projekt und führe dort diese Befehle aus:

```bash
tale init my-project
cd my-project
tale dev
```

`tale init` erstellt das Projekt und eine private `.env` mit erzeugten Geheimnissen. Sichere diese Datei und ihre Verschlüsselungsschlüssel. Lass Docker in der Sandbox bei der entsprechenden Frage standardmäßig deaktiviert, solange deine Agenten Docker nicht benötigen: Das Aktivieren erlaubt verschachteltes Docker mit Privilegien.

`tale dev` startet die Container und zeigt die Adresse an, sobald die Anwendung bereit ist. Lass den Befehl während der ersten Image-Downloads und der Datenbankeinrichtung laufen. Öffne die angezeigte URL, normalerweise `https://localhost`. Das lokale Zertifikat ist selbstsigniert. Prüfe vor dem Bestätigen der Browserwarnung, ob die Adresse zu deiner eigenen Instanz gehört.

<Note>

Das erzeugte Verzeichnis `default/` enthält Katalogbeispiele und automatisch installierte Einträge. Für diesen ersten Start musst du es nicht bearbeiten. Seine `README.md` erklärt, welche Konfigurationsänderungen eine Organisation beeinflussen.

</Note>

## Inhaber erstellen und Antwort prüfen

1. Erstelle im Einrichtungsassistenten dein Konto und benenne die Organisation. Das erste Konto wird ihr **Inhaber**. [Erstes Inhaberkonto](/de/self-hosted/install/first-admin) beschreibt die Inhaberrolle und bereits vorhandene Konten.
2. Öffne nach der Einrichtung **Einstellungen > KI-Anbieter** und füge unterstützte Zugangsdaten hinzu. Auch die Abschlussseite der Einrichtung führt zu den Anbietereinstellungen. [KI-Anbieter](/de/platform/admin/providers) beschreibt die Felder und unterstützten Anmeldemethoden.
3. Öffne **Start**, wähle **Neuer Chat** und ein verfügbares Modell. Sende eine kurze Anfrage wie „Schreibe eine Checkliste mit drei Punkten für eine Besprechung.“ Warte, bis die Antwort vollständig ist.

Eine vollständige Antwort bestätigt, dass Konto, Anbieter und gewähltes Modell zusammen funktionieren. Ist die Modellliste leer oder schlägt die Anfrage fehl, folge der Fehlerhilfe im Anbieterleitfaden. [Deine erste Nachricht senden](/de/get-started/quickstart) zeigt, wie du fortfährst und die Unterhaltung wiederfindest. Sobald du Projektarbeit delegieren möchtest, [erstelle deinen ersten Agenten](/de/tutorials/editor/first-agent-end-to-end).

## Stoppen und später fortfahren

Drücke im Terminal mit `tale dev` die Tastenkombination `Ctrl-C`, um die Instanz im Vordergrund zu stoppen. Starte später im selben Projektverzeichnis erneut `tale dev`; die bisherigen Daten bleiben erhalten.

Prüfe `tale dev --help`, bevor du die folgenden Befehle für den Hintergrundbetrieb nutzt. Fehlt dort `--stop`, lass `tale dev` im Vordergrund laufen und stoppe es mit `Ctrl-C`.

```bash
tale dev --detach
tale dev --stop
```

Das Stoppen erhält Projekt, Geheimnisse und dauerhafte Daten. Verwende weiterhin dasselbe Projektverzeichnis; ein neues Projekt startet eine separate Instanz.

## Startprobleme beheben

| Symptom | Nächste Aktion |
| --- | --- |
| `tale` fehlt | Prüfe Installationsverzeichnis und `PATH`; öffne unter Windows ein neues Terminal. |
| Docker startet nicht | Öffne Docker Desktop oder starte den Daemon. Prüfe im selben Terminal `docker info` und versuche es dann erneut. |
| Compose fehlt | Prüfe `docker compose version`; installiere das Compose-Plugin oder aktualisiere Docker Desktop. |
| Ein Image-Download ist langsam oder scheitert | Prüfe die gemeldeten Registry- oder Netzwerkfehler und den freien Speicher. Starte nach der Korrektur `tale dev` im selben Verzeichnis erneut. |
| Der HTTPS-Port ist belegt | Prüfe, welcher Prozess Port `443` belegt. Gib bei der veröffentlichten CLI-Version v0.5.70 diesen Port frei, bevor du es erneut versuchst. |
| Port `8003` ist belegt | Stoppe die andere lokale Tale-Instanz oder den Dienst auf diesem Port. `--port` ändert nur HTTPS. |
| Ein Container startet ständig neu | Führe `tale status` aus, danach `tale logs backend-api --tail 100` oder `tale logs platform --tail 100`. Suche die Ursache in den Protokollen des gemeldeten Dienstes. |
| Statt der Einrichtung erscheint die Anmeldung | Es gibt bereits ein Konto. Melde dich damit an; setze die Daten nicht zurück, um die Einrichtung zu wiederholen. |
| Die App öffnet sich ohne Modellantwort | Prüfe Zugangsdaten und gewähltes Modell unter **Einstellungen > KI-Anbieter**. |

Versuche es erneut, sobald die gemeldete Ursache behoben ist. Behalte `.env` und die Datenvolumes. Bei anhaltenden Fehlern hilft die [Fehlerbehebung](/de/self-hosted/operate/observability/troubleshooting). Nenne bei einer Supportanfrage CLI-Version und relevanten Fehler; entferne Zugangsdaten aus Protokollen, bevor du sie teilst.

## Eine produktive Bereitstellung vorbereiten

`tale deploy` stellt die Projektkonfiguration auf dem gewählten Docker-Host bereit. Entwicklung und Bereitstellung verwenden getrennte Datenvolumes: Das lokale Konto, Chats und hochgeladene Dateien werden dabei nicht übertragen. Bereite DNS, TLS, Backups und Zugriffskontrollen vor, bevor du dein Team hinzufügst.

Lies [TLS und Domains](/de/self-hosted/configuration/tls-and-domains), [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) und [Absicherung](/de/self-hosted/operate/security/hardening). Falls du die Dienstdefinitionen selbst verwalten musst, nutze [Compose selbst betreiben](/de/self-hosted/install/own-compose).
