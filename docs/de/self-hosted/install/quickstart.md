---
title: Deine erste selbst gehostete Instanz starten
description: Installiere die CLI, starte ein lokales Tale-Projekt und prüfe eine erste Modellantwort.
---
Starte Tale lokal mit der CLI, erstelle das erste Inhaberkonto und teste einen Chat. Die CLI bereitet Projekt und Container vor. Konfiguration und dauerhafte Daten bleiben auf der Infrastruktur, die du kontrollierst.

## Den lokalen Rechner vorbereiten

Verwende einen Rechner mit Docker und Compose sowie ausreichend Speicher für Images und Daten. Fehlt Docker, kann die CLI bei Installation oder Start helfen. Der erste Image-Download braucht Netzwerkzugriff und kann bei langsamer Verbindung länger dauern.

Bevor ein Agent antworten kann, brauchst du Zugangsdaten für einen unterstützten Modellanbieter. Diese ergänzt du nach der Kontoeinrichtung. Halte die erste Instanz privat, während du ihr Inhaberkonto erstellst.

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

Führe `tale --version` bei Bedarf in einem neuen Terminal aus. Fehlt der Befehl, prüfe das vom Installer genannte Verzeichnis und ergänze `PATH`. Die [CLI-Installation](/de/self-hosted/install/cli-install) beschreibt feste Versionen und entfernten Docker-Zugriff.

## Initialisieren und starten

Erstelle ein neues Projektverzeichnis und starte die lokale Umgebung:

```bash
tale init my-project
cd my-project
tale dev
```

`tale init` schreibt die Projektkonfiguration und erzeugt Geheimnisse. Halte `.env` privat und bewahre sie mit dem Projekt auf. Prüfe die Frage zu Docker in der Sandbox vor dem Aktivieren: Verschachteltes Docker mit Privilegien verändert die Isolationsanforderungen an den Host.

`tale dev` startet die benötigten Docker-Dienste und wartet auf Bereitschaft. Öffne dann die von der CLI angezeigte URL. Die lokale Standardadresse verwendet ein selbstsigniertes Zertifikat. Prüfe vor dem Bestätigen der Browserwarnung, ob du deine eigene lokale Instanz geöffnet hast.

<Note>

Das erzeugte Verzeichnis `default/` enthält Katalogbeispiele und automatisch installierte Einträge. Eine Änderung an einem Beispiel ändert nicht zwingend eine bestehende Organisation. Lies die dortige `README.md`, bevor du dich auf das Nachladen von Konfiguration verlässt.

</Note>

Lass `tale dev` während der Nutzung laufen. `Ctrl-C` beendet den Vordergrundlauf; `tale dev --detach` startet im Hintergrund. Das Stoppen von Containern löscht keine dauerhaften Daten.

## Inhaber erstellen und Antwort prüfen

Schließe auf einer leeren Instanz die Einrichtung von Konto und Organisation ab. Prüfe die Rolle **Inhaber** unter **Einstellungen > Mitglieder** anhand von [Erstes Inhaberkonto](/de/self-hosted/install/first-admin).

Verbinde während der Einrichtung oder unter **Einstellungen > KI-Anbieter** einen Modellanbieter. Folge danach [Deinen ersten Agenten erstellen](/de/tutorials/editor/first-agent-end-to-end). Gespeicherte Zugangsdaten allein reichen nicht: Sende eine Nachricht und prüfe die fertige Antwort, um Anbieter, Modell und Ausführung zu testen.

## Startprobleme beheben

| Symptom | Nächste Aktion |
| --- | --- |
| `tale` fehlt | Prüfe Installationsverzeichnis und `PATH` des Terminals. |
| Docker startet nicht | Öffne Docker Desktop oder starte den Daemon und versuche es erneut. |
| Ein Image-Download ist langsam oder scheitert | Lies Image-Namen und Netzwerkfehler; prüfe Registry-Zugriff und freien Speicher. |
| Der HTTPS-Port ist belegt | Prüfe den Prozess oder verwende `tale dev --port 8443`. Das ändert nur den HTTPS-Port. |
| Ein Container startet ständig neu | Lies `tale status` und `tale logs <service>` und behebe zuerst die gemeldete Ursache. |
| Die App öffnet sich ohne Modellantwort | Prüfe Zugangsdaten und Modell, dann Backend- und Sandbox-Protokolle. |

Der Sandbox-Spawner verwendet `127.0.0.1:8003`. Ein anderer HTTPS-Port allein trennt deshalb keine zwei lokalen Projekte.

## Eine produktive Bereitstellung vorbereiten

`tale deploy` stellt die Projektkonfiguration auf dem gewählten Docker-Host bereit. Bereite DNS, TLS, Backups und Zugriffskontrollen vor, bevor du dein Team einlädst. Die Wiederverwendung des Projektverzeichnisses überträgt nicht automatisch Datenbanken oder Dateien auf einen anderen Host.

Lies [TLS und Domains](/de/self-hosted/configuration/tls-and-domains), [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) und [Absicherung](/de/self-hosted/operate/security/hardening). Für eine selbst verwaltete Bereitstellung nutze [Compose selbst betreiben](/de/self-hosted/install/own-compose).
