---
title: Die tale-CLI installieren
description: Die tale-CLI auf macOS, Linux oder Windows installieren — und sie gegen deine self-hosted Instanz für Deploys und Upgrades konfigurieren.
---

Die `tale`-CLI ist der empfohlene Weg, Tale zu betreiben und zu bedienen. Der [Quickstart](/de/self-hosted/install/quickstart) nutzt sie bereits, um eine Instanz lokal mit `tale init` und `tale start` aufzustellen; diese Seite ist die andere Hälfte — die CLI auf einer Workstation installieren, damit sie eine _entfernte_ Instanz fahren kann: neue Versionen deployen, Migrationen ausführen und Diagnostiken einfangen, ohne dass du dir jede `docker compose`-Invokation merken musst.

Alles, was die CLI macht, lässt sich auch direkt mit `docker compose` und `ssh` machen, sodass ein Team, das schon tief in der eigenen Automatisierung steckt, bei Compose bleiben kann. Für alle anderen ist die CLI der kürzere Weg, und der Rest der self-hosted Docs setzt voraus, dass sie installiert ist.

## Bevor du beginnst

Du brauchst:

- Eine Workstation mit macOS, Linux oder Windows 10+.
- SSH-Zugriff auf den Host, auf dem deine Tale-Instanz läuft, mit einem Operator-User, der `docker compose` ausführen kann.
- Den Admin-Key aus [Erster Admin](/de/self-hosted/install/first-admin) griffbereit.

Der Installer lädt ein Release-Binary von GitHub. Unternehmensnetzwerke, die Raw-Content-Downloads blockieren, müssen `raw.githubusercontent.com` und `github.com` zulassen.

## Schritt 1 — install-cli.sh oder install-cli.ps1 ausführen

Auf macOS oder Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Auf Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Beide Installer erkennen das Betriebssystem, ziehen das passende Release-Binary aus dem neuesten GitHub-Release und legen es im `PATH` ab (`/usr/local/bin/tale` oder `%LOCALAPPDATA%\Programs\tale\tale.exe`). Um eine Version festzuhalten, setze die Environment-Variable `VERSION`, bevor du in den Installer pipest.

| OS      | Installer-Skript          |
| ------- | ------------------------- |
| macOS   | `scripts/install-cli.sh`  |
| Linux   | `scripts/install-cli.sh`  |
| Windows | `scripts/install-cli.ps1` |

## Schritt 2 — Verifizieren

```bash
tale --version
```

Die CLI gibt ihre Version aus. Wird der Befehl nicht gefunden, hat der Installer das Binary ausserhalb des `PATH` abgelegt — die Installer-Ausgabe benennt das Zielverzeichnis.

## Schritt 3 — Konfiguration prüfen

Es gibt kein `tale config set` — alles, was die CLI braucht, liegt im Projekt, das `tale init` angelegt hat. Führ jeden `tale`-Befehl aus diesem Verzeichnis heraus aus (die CLI läuft den Baum hoch, um `tale.json` zu finden), und prüf, dass es aufgelöst wird:

```bash
tale config show
```

Der Host, auf dem der Proxy antwortet, die TLS-Einstellungen und alle Secrets liegen im `.env` des Projekts. Um den Host zu ändern, bearbeite dort `HOST` oder übergib `--host` an `tale start` / `tale deploy`. Um einen entfernten Host zu betreiben, richte den Docker-Kontext deiner Shell (oder `DOCKER_HOST`) darauf aus — die CLI spricht denselben Docker-Endpunkt an wie jeder `docker`-Befehl.

Der einmalige Admin-Key, der bei der Anmeldung das erste **Owner**-Konto beansprucht, ist von der CLI-Konfiguration getrennt — erzeug ihn bei Bedarf mit `tale convex admin` (siehe [Erster Admin](/de/self-hosted/install/first-admin)).

## Schritt 4 — tale deploy ausführen

```bash
tale deploy
```

`tale deploy` zieht die neuesten Images für die konfigurierte `TALE_VERSION`, restartet die betroffenen Container in der richtigen Reihenfolge und führt Schema-Migrationen aus. Es ist der unterstützte Ersatz für das längere `docker compose pull && docker compose up -d`-Tänzchen. Bevorzugst du Compose direkt, lebt derselbe Effekt in [Upgrades](/de/self-hosted/operate/upgrades).

## Befehlsreferenz

Die CLI gruppiert ihre Befehle danach, was du gerade tust — genau wie `tale --help`. Jeder Befehl und seine Argumente sind unten aufgeführt. So liest du die Notation:

- Ein positionales Argument in `[eckigen Klammern]` ist **optional**, eines in `<spitzen Klammern>` ist **erforderlich**.
- Jedes Flag ist **optional** — weglassen ergibt das Standardverhalten.
- Ein Flag der Form `--flag <wert>` **erfordert einen Wert**, wenn du es nutzt (z. B. `--port 8443`); ein blosses Flag wie `--detach` ist ein boolescher Schalter.
- **Standardwerte** stehen in Klammern hinter der Beschreibung. Kein Standard bedeutet, das Flag ist aus oder der Wert wird aus `.env` / Kontext aufgelöst.

Führe `tale <befehl> --help` für die massgebliche Liste deiner installierten Version aus.

### Einrichtung

`tale init [directory]` — ein Projekt anlegen: erzeugt die Beispiel-Configs, `AGENTS.md` + `CLAUDE.md` sowie eine lokale Standard-`.env` (localhost, selbstsigniertes Zertifikat, generierte Secrets). Keine Rückfragen und kein Docker — Produktiv-Domain und TLS werden später bei `tale deploy` gewählt. `directory` ist optional (Standard: das aktuelle Verzeichnis).

- `-f, --force` — eine vorhandene `tale.json` überschreiben statt abzubrechen.
- `--no-env` — das Projekt anlegen, aber die `.env`-Generierung überspringen.

`tale start` — alle Dienste lokal mit selbstsigniertem Zertifikat starten.

- `-d, --detach` — im Hintergrund laufen statt Logs zu streamen.
- `-p, --port <port>` — auszugebender HTTPS-Port (Standard `443`).
- `--host <hostname>` — Host-Alias für den Proxy (Standard `tale.local`).
- `-y, --yes` — nicht-interaktiv: Abfragen automatisch akzeptieren (z. B. Docker installieren oder starten).

`tale deploy` — Blue-Green-Deployment ohne Ausfallzeit der aktuellen CLI-Version. Beim ersten Deploy fragt es nach deiner Produktiv-Domain und der Let's-Encrypt-E-Mail (oder übergib `--host`).

- `-a, --all` — auch die zustandsbehafteten Infrastruktur-Dienste aktualisieren, nicht nur die rotierbaren.
- `-s, --services <list>` — nur diese kommagetrennten Dienste aktualisieren (Standard: alle rotierbaren Dienste).
- `--host <hostname>` — Host-Alias für den Proxy (Standard: der `HOST`-Wert aus `.env`).
- `--override` — Container-Config aus dem Host-Workspace überschreiben (verschlüsselte `*.secrets.json` und `.history/` bleiben stets erhalten).
- `--override-all` — den Builtin-Katalog serverseitig in jede Organisation zurücksetzen; impliziert `--all`.
- `-q, --quiet` — Container-Logs während des Deployments unterdrücken.
- `-y, --yes` — destruktive Bestätigungsabfragen automatisch akzeptieren (z. B. `--override-all`).
- `--skip-backup` — den automatischen Pre-Deploy-Snapshot überspringen.
- `--dry-run` — Vorschau ohne Änderungen.

### Betrieb

`tale status` — den aktuellen Deployment-Status anzeigen. Keine Argumente.

`tale logs <service>` — Logs eines Dienstes streamen (`service` ist einer der laufenden Dienste).

- `-f, --follow` — der Log-Ausgabe folgen, während sie geschrieben wird.
- `-n, --tail <lines>` — nur die letzten N Zeilen anzeigen.
- `--since <duration>` — Logs seit einer relativen Zeit anzeigen (z. B. `1h`, `30m`).
- `-c, --color <color>` — eine bestimmte Deployment-Farbe ansprechen (`blue` oder `green`).

`tale backup` — Snapshot aller Daten-Volumes in das Projekt-Backups-Volume. Keine Argumente.

`tale restore [snapshot-id]` — einen Snapshot wiederherstellen; ohne ID werden die verfügbaren Snapshots aufgelistet.

- `--stop` — laufende Projekt-Container vor dem Wiederherstellen stoppen.
- `-y, --yes` — die Bestätigungsabfrage überspringen.

`tale rollback` — auf die vorherige Patch-Version zurückrollen (nur Patch-Ebene). Keine Argumente.

### Wartung

`tale upgrade` (Alias `tale update`) — die CLI auf die neueste Version aktualisieren und Projektdateien synchronisieren.

- `-v, --version <version>` — genau diese Version installieren (z. B. `0.9.0`) statt der neuesten; erlaubt Downgrades.
- `-f, --force` — Neudownload erzwingen und lokal geänderte Dateien überschreiben.
- `--dry-run` — anzeigen, was sich ändern würde, ohne etwas zu ändern.

`tale cleanup` — inaktive (nicht-aktuelle) Container entfernen. Keine Argumente.

`tale reset` — alle Blue-Green-Container entfernen.

- `-f, --force` — die Bestätigungsabfrage überspringen.
- `-a, --all` — auch die zustandsbehafteten Infrastruktur-Container entfernen.
- `--dry-run` — den Reset vorab anzeigen, ohne Änderungen.

`tale config` — CLI-Konfiguration verwalten. Mit dem Unterbefehl `show` die aufgelöste Konfiguration ausgeben.

### Erweitert

`tale auth reset-owner` — die Zugangsdaten des Owner-Kontos zurücksetzen.

- `-e, --email <email>` — eine neue Owner-E-Mail-Adresse setzen.
- `-p, --password <password>` — ein neues Owner-Passwort setzen.

`tale convex admin` — einen Admin-Key für das Convex-Dashboard erzeugen. Keine Argumente.

## Fehlersuche

- **`tale deploy` trifft die falsche Maschine.** Die CLI nutzt den Docker-Kontext / `DOCKER_HOST` deiner Shell. Wechsle mit `docker context use …` (oder setz `DOCKER_HOST`), sodass er auf den gewünschten Host zeigt, und lauf erneut.
- **`tale deploy` nutzt den falschen Host-Alias.** Der Host, auf dem der Proxy antwortet, kommt aus `HOST` im `.env` des Projekts, nicht aus einem separaten CLI-Speicher. Bearbeite `.env` oder übergib `--host`, um ihn für einen Lauf zu überschreiben.
- **Der Anmelde-Bildschirm weist den Admin-Key ab.** Der Bootstrap-Key rotiert jedes Mal, wenn der Platform-Container neu startet. Erzeug mit `tale convex admin` einen frischen und nutz ihn sofort.
- **Installer scheitert auf macOS mit einer Gatekeeper-Warnung.** Das Binary ist signiert, aber auf Apple Silicon noch nicht notarisiert; der Installer druckt den `xattr`-Befehl, um das Quarantäne-Flag zu löschen.
- **`tale` nach der Installation auf Linux nicht gefunden.** Der Installer legt das Binary in `/usr/local/bin` ab; verifizier, dass das Verzeichnis im `PATH` des Users ist (`echo $PATH`).

## Wo das eingesetzt wird

Sobald die CLI verdrahtet ist, schrumpft die tägliche Oberfläche des Betreibers auf eine Handvoll Subbefehle. Welche Seiten du als Nächstes liest, hängt davon ab, wozu du gekommen bist — [Upgrades](/de/self-hosted/operate/upgrades) für Versionsbumps, [Backups und Restore](/de/self-hosted/operate/backups-and-restore) für Snapshot-Übungen, [Container-Architektur](/de/self-hosted/operate/container-architecture) dafür, was die CLI beim Deploy restartet.
