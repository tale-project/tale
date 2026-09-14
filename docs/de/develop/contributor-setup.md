---
title: Tale aus dem Quellcode starten
description: Richte deine lokale Entwicklungsumgebung ein, starte Backend und App und prüfe deine Änderung.
---
Starte Tale aus dem Quellcode, wenn du das Produkt ändern oder einen Beitrag testen möchtest. App und Backend laufen auf deinem Rechner; Datenbanken und Sandbox-Dienste laufen in Docker. Für eine fertige Installation folge dem [Schnellstart für selbst gehostete Instanzen](/de/self-hosted/install/quickstart).

## Rechner vorbereiten

Arbeite in einem lokalen Checkout des [Tale-Repositorys](https://github.com/tale-project/tale). Führe die folgenden Befehle im Stammverzeichnis aus.

| Voraussetzung | Aufgabe | Prüfung |
| --- | --- | --- |
| Bun-Version aus der `package.json` im Repository-Stamm | Workspaces, Abhängigkeiten, Vite und Entwicklungsskripte | `bun --version` |
| Node.js ab 22.21.1 innerhalb von 22.x | Anwendungsbackend; das Container-Image verwendet 22.21.1 | `node --version` |
| Docker mit Compose | Anwendungs- und Wissensdatenbank, Objektspeicher und Sandbox-Dienste | `docker info` und `docker compose version` |
| Freie lokale Ports | App auf 3000 und Backend auf 3005 | `bun run setup:check` |

Das Repository legt die Paketmanager-Version fest. Nutze sie beim Nachstellen eines Fehlers oder bei einer Lockfile-Änderung; die Startprüfung kontrolliert nur eine Mindestversion.

Die Vorabprüfung kontrolliert Bun und die beiden Ports. Prüfe Node und Docker separat; ein grünes Ergebnis bestätigt diese Voraussetzungen nicht. Beim ersten Start brauchst du außerdem Netzwerkzugriff für Abhängigkeiten und Container-Images. Für echte AI-Antworten brauchst du einen Modellanbieter, für die Anmeldung und das Erkunden der App noch nicht.

## Installieren und starten

Installiere die Abhängigkeiten, prüfe die lokalen Ports und starte die Entwicklungsumgebung:

```bash
bun install
bun run setup:check
bun run dev
```

Das Entwicklungsskript im Stammverzeichnis ergänzt fehlende Geheimnisse in der von Git ignorierten `.env` und behält vorhandene Werte bei. Schütze diese Datei und bewahre sie zwischen Neustarts auf: Backend und Sandbox brauchen dieselben Geheimnisse.

Der Orchestrator startet die Docker-Dienste und das Node-Backend, wartet auf API und Authentifizierung und startet danach Vite. Das Backend führt beim Start die Datenbankmigrationen aus. Warte auf `READY`, bevor du `http://localhost:3000` öffnest; Downloads und die erstmalige Einrichtung können den ersten Start verlängern.

<Check>

Öffne die App und melde dich an. Das Dashboard bestätigt die Verbindung zwischen Browser und Backend. Sende mit einem eingerichteten Anbieter eine Nachricht, um auch einen Modellaufruf zu prüfen.

</Check>

Beende die Vordergrundprozesse mit `Ctrl-C`. Die Docker-Datenvolumes bleiben erhalten; das Beenden löscht die Instanz nicht.

## Am lokalen Workspace anmelden

Die lokale Entwicklungsumgebung legt `dev@tale.test` mit dem Passwort `TaleDev!Passw0rd` und der Organisation **Dev Workspace** an. Ein vorhandenes Konto bleibt unverändert. Diese Einrichtung ist auf Loopback-Adressen in `SITE_URL` beschränkt.

Setze `TALE_DEV_SEED_USER=0`, um stattdessen die Ersteinrichtung zu testen. Für eine andere lokale Identität übergib `TALE_DEV_SEED_USER_EMAIL` und `TALE_DEV_SEED_USER_PASSWORD` als Umgebungsvariablen. Neue Werte setzen das Passwort eines bestehenden Kontos nicht zurück.

## Passende Startweise wählen

Verwende für die normale Produktentwicklung `bun run dev`. Der Befehl startet Backend und App gemeinsam und stellt ihre gemeinsame Konfiguration bereit.

Laufen die benötigten Dienste bereits mit passenden Ports und Zugangsdaten, überspringe nur ihren Docker-Start:

```bash
TALE_DEV_SKIP_DOCKER=1 bun run dev
```

Dabei startet weiterhin ein lokales Backend. Postgres, Objektspeicher und Sandbox bleiben erforderlich. Nutze [Compose-Dateien für die Entwicklung](/de/develop/compose-files), wenn du den vollständigen Container-Build prüfen musst.

Für reine Frontend-Arbeit mit einem vorhandenen Backend starte Vite direkt aus `services/platform` und gib dessen Adresse an:

```bash
cd services/platform
TALE_BACKEND_URL=http://localhost:3005 bunx --bun vite --host 127.0.0.1 --port 3000
```

Dieser Befehl startet keine Dienste, legt keine Konten an und führt keine Migrationen aus. Das Backend muss den verwendeten Browser-Ursprung bereits erlauben.

## Startprobleme eingrenzen

| Symptom | Nächste Prüfung |
| --- | --- |
| `node` fehlt oder kennt eine Option nicht | Installiere die oben genannte Node-Version und prüfe den Aufruf in deiner Shell. |
| Docker stellt keine Verbindung her | Starte Docker und prüfe `docker info` in derselben Shell. |
| Port 3000 oder 3005 ist belegt | Ermittle den Prozess, bevor du ihn beendest; er kann zu einem anderen Checkout gehören. |
| Das Backend scheitert vor dem Vite-Start | Lies den ersten Backend-Fehler und prüfe Datenbankverbindung und Zugangsdaten. |
| Anmeldung funktioniert, Modellaufrufe scheitern | Prüfe Anbieterzugangsdaten, Modellwahl und Sandbox-Dienste. |
| Änderungen erscheinen in der falschen App | Prüfe die URL und den Checkout des laufenden Prozesses. |

Unter macOS oder Linux findest du die lauschenden Prozesse mit:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3005 -sTCP:LISTEN
```

Beende einen bekannten Entwicklungsprozess in seinem ursprünglichen Terminal. Ein belegter Port allein ist kein Grund, einen Prozess zu beenden.

## Lokale Daten bewusst behalten oder zurücksetzen

Datenbanken und hochgeladene Dateien liegen außerhalb des Quellcode-Checkouts. Ein zweiter Git-Worktree trennt Docker-Dienstnamen, Ports, Volumes und `.env`-Zugangsdaten nicht automatisch. Gib parallelen Instanzen jeweils eigene Dienste und eine eigene Konfiguration.

Ein Zurücksetzen löscht Entwicklungsdaten und kann einen anderen Checkout mit demselben Compose-Projekt treffen. Prüfe Container und Volumes des Projekts, sichere benötigte Daten und stoppe die Umgebung, bevor du Zustand entfernst. Konfigurationsverzeichnisse unter `TALE_CONFIG_DIR` bleiben davon unabhängig; eine gelöschte Datenbank setzt diese Dateien nicht zurück.

## Einen Beitrag prüfen

Lies vor Änderungen `AGENTS.md` und `.agents/repo.md` im Repository. Führe während der Arbeit passende Prüfungen aus und danach die gemeinsame Prüfung im Stammverzeichnis:

```bash
bun run check
```

Sie umfasst Formatierung, Lint, Typen und automatisierte Tests. Die Python-Formatierung verwendet zusätzlich `uvx`; installiere dieses Werkzeug vor dem vollständigen Durchlauf. Prüfe Browser-Verhalten auch im Browser. Für Datenbankänderungen verlangt der Repository-Vertrag den Integrationstest mit echtem Postgres.

Aktualisiere betroffene Dokumentation und alle ausgelieferten Sprachen gemeinsam mit deiner Änderung. Für Container-Arbeit lies [Docker-Images bauen](/de/develop/contributing-docker); für externe Integrationen beginne mit [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script).
