---
title: Die tale-CLI installieren
description: Die tale-CLI auf macOS, Linux oder Windows installieren — und sie gegen deine self-hosted Instanz für Deploys und Upgrades konfigurieren.
---

Die `tale`-CLI ist der empfohlene Weg, Tale zu betreiben und zu bedienen. Der [Quickstart](/de/self-hosted/install/quickstart) nutzt sie bereits, um eine Instanz lokal mit `tale init` und `tale dev` aufzustellen; diese Seite ist die andere Hälfte — die CLI auf einer Workstation installieren, damit sie eine _entfernte_ Instanz fahren kann: neue Versionen deployen, Migrationen ausführen und Diagnostiken einfangen, ohne dass du dir jede `docker compose`-Invokation merken musst.

Alles, was die CLI macht, lässt sich auch direkt mit `docker compose` und `ssh` machen, sodass ein Team, das schon tief in der eigenen Automatisierung steckt, bei Compose bleiben kann. Für alle anderen ist die CLI der kürzere Weg, und der Rest der self-hosted Docs setzt voraus, dass sie installiert ist.

## Bevor du beginnst

Du brauchst:

- Eine Workstation mit macOS, Linux oder Windows 10+.
- SSH-Zugriff auf den Host, auf dem deine Tale-Instanz läuft, mit einem Operator-User, der `docker compose` ausführen kann.

Der Installer lädt ein Release-Binary von GitHub. Unternehmensnetzwerke, die Raw-Content-Downloads blockieren, müssen `raw.githubusercontent.com` und `github.com` zulassen.

## Schritt 1 — install-cli.sh oder install-cli.ps1 ausführen

Auf macOS oder Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Auf Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Beide Installer erkennen Betriebssystem und CPU-Architektur, ziehen das passende Release-Binary aus dem neuesten GitHub-Release und legen es im `PATH` ab (`/usr/local/bin/tale` oder `%LOCALAPPDATA%\Programs\tale\tale.exe`) — ist das Installationsverzeichnis nicht beschreibbar, fragt der Installer nach `sudo`. Release-Binaries gibt es für macOS auf Apple Silicon und Intel sowie für Linux auf x86_64 und arm64; Windows-on-ARM-Maschinen führen das x64-Binary über die eingebaute Emulation aus. Auf einer Architektur ohne Release-Binary bricht der Installer mit einer klaren Meldung ab und verweist auf den Build aus dem Quellcode. Um eine Version festzuhalten, setze die Environment-Variable `VERSION`, bevor du in den Installer pipest; das Installationsverzeichnis wählst du mit `INSTALL_DIR` selbst.

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

Der Host, auf dem der Proxy antwortet, die TLS-Einstellungen und alle Secrets liegen im `.env` des Projekts. Um den Host zu ändern, bearbeite dort `HOST` oder übergib `--host` an `tale dev` / `tale deploy`. Um einen entfernten Host zu betreiben, richte den Docker-Kontext deiner Shell (oder `DOCKER_HOST`) darauf aus — die CLI spricht denselben Docker-Endpunkt an wie jeder `docker`-Befehl.

## Schritt 4 — tale deploy ausführen

```bash
tale deploy
```

`tale deploy` liefert immer die Version der CLI selbst aus: Es zieht die Images dieser Version, restartet die betroffenen Container in der richtigen Reihenfolge und führt Schema-Migrationen aus — auf eine andere Version wechselst du vorher mit `tale update`. Es ist der unterstützte Ersatz für das längere `docker compose pull && docker compose up -d`-Tänzchen. Bevorzugst du Compose direkt, lebt derselbe Effekt in [Upgrades](/de/self-hosted/operate/upgrades).

## Befehlsreferenz

Die CLI gruppiert ihre Befehle danach, was du gerade tust — genau wie `tale --help`. Jeder Befehl und seine Argumente sind unten aufgeführt. So liest du die Notation:

- Ein positionales Argument in `[eckigen Klammern]` ist **optional**, eines in `<spitzen Klammern>` ist **erforderlich**.
- Jedes Flag ist **optional** — weglassen ergibt das Standardverhalten.
- Ein Flag der Form `--flag <wert>` **erfordert einen Wert**, wenn du es nutzt (z. B. `--port 8443`); ein blosses Flag wie `--detach` ist ein boolescher Schalter.
- **Standardwerte** stehen in Klammern hinter der Beschreibung. Kein Standard bedeutet, das Flag ist aus oder der Wert wird aus `.env` / Kontext aufgelöst.

Führe `tale <befehl> --help` für die massgebliche Liste deiner installierten Version aus.

**Globale Flags** funktionieren bei jedem Befehl:

- `--verbose` — ausführliche Ausgabe: Debug-Logs und der rohe Subprozess-Stream (nur die Langform; ein `-v` gibt es nicht).
- `-q, --quiet` — nur Warnungen und Fehler.
- `-y, --yes` — bei allen Rückfragen «ja» annehmen (nicht-interaktiv).
- `--no-color` — ANSI-Farben deaktivieren (berücksichtigt auch `NO_COLOR` / `FORCE_COLOR`).
- `--json` — maschinenlesbares JSON auf stdout, menschliche Meldungen auf stderr; unterstützt von `status` und `config show`.
- `--ci` — erzwingt nicht-interaktive, rein anhängende Ausgabe (keine Cursor-Steuerung).

Befehle beenden mit `0` bei Erfolg, `2` bei einem Nutzungsfehler, `3` bei einer nicht erfüllten Voraussetzung (kein Projekt, Docker läuft nicht, Port belegt), `4` bei einem Abbruch durch dich (Ctrl-C oder eine erforderliche Rückfrage ohne Terminal) und `5` beim Fehler einer externen Abhängigkeit — so können Skripte anhand der Ursache verzweigen.

### Einrichtung

`tale init [directory]` — ein Projekt anlegen: erzeugt die Beispiel-Configs, `AGENTS.md` + einen `CLAUDE.md`-Verweis sowie eine lokale Standard-`.env` (localhost, selbstsigniertes Zertifikat, generierte Secrets). Docker braucht es nicht; Produktiv-Domain und TLS werden später bei `tale deploy` gewählt. Im Terminal fragt es nach einem Projektnamen, wenn `directory` fehlt, bestätigt vor dem Überschreiben eines bestehenden Projekts und fragt einmal, ob Agents in Sandboxes `docker` ausführen dürfen (Standard: nein — die Freigabe startet einen privilegierten inneren Docker); nicht-interaktive Läufe überspringen alle Rückfragen. `directory` ist optional (Standard: das aktuelle Verzeichnis).

- `-f, --force` — eine vorhandene `tale.json` überschreiben statt abzubrechen.
- `--no-env` — das Projekt anlegen, aber die `.env`-Generierung überspringen.

`tale dev` — alle Dienste lokal mit selbstsigniertem Zertifikat starten.

- `-d, --detach` — im Hintergrund laufen statt Logs zu streamen.
- `-p, --port <port>` — auszugebender HTTPS-Port (Standard `443`).
- `--host <hostname>` — Host-Alias für den Proxy (Standard `localhost`).
- `-y, --yes` — nicht-interaktiv: Abfragen automatisch akzeptieren (z. B. Docker installieren oder starten).

`tale deploy` — Blue-Green-Deployment ohne Ausfallzeit der aktuellen CLI-Version. Beim ersten Deploy fragt es nach deiner Produktiv-Domain und der Let's-Encrypt-E-Mail (oder übergib `--host`).

- `--stop` — auch die stop-gebundene Schicht (`db`, `proxy`) aktualisieren — sie wird neu erstellt, also nimm eine kurze Ausfallzeit in Kauf; ohne das Flag bleiben laufende `db`/`proxy` unangetastet.
- `-s, --services <list>` — nur diese kommagetrennten Dienste aktualisieren (Standard: alle rotierbaren Dienste).
- `--host <hostname>` — Host-Alias für den Proxy (Standard: der `HOST`-Wert aus `.env`).
- `--override` — Container-Config aus dem Host-Workspace überschreiben (verschlüsselte `*.secrets.json` und `.history/` bleiben stets erhalten).
- `--override-all` — den Builtin-Katalog serverseitig in jede Organisation zurücksetzen; impliziert `--stop`.
- `-q, --quiet` — Container-Logs während des Deployments unterdrücken.
- `-y, --yes` — destruktive Bestätigungsabfragen automatisch akzeptieren (z. B. `--override-all`).
- `--skip-backup` — den automatischen Pre-Deploy-Snapshot überspringen.
- `--dry-run` — Vorschau ohne Änderungen.

### Betrieb

`tale status` — den aktuellen Deployment-Status anzeigen. Keine Argumente.

`tale logs <service>` — Logs eines Dienstes streamen (`service` ist einer der laufenden Dienste; auf einem reinen Dev-Stack ohne Deployment fällt der Befehl auf den Dev-Container zurück).

- `-f, --follow` — der Log-Ausgabe folgen, während sie geschrieben wird.
- `-n, --tail <lines>` — nur die letzten N Zeilen anzeigen.
- `--since <duration>` — Logs seit einer relativen Zeit anzeigen (z. B. `1h`, `30m`).
- `-c, --color <color>` — eine bestimmte Deployment-Farbe ansprechen (`blue` oder `green`).
- `--raw` — die rohe, ungefilterte Log-Ausgabe streamen (keine Klassifizierung).

`tale backup` — Snapshot aller Daten-Volumes in das Projekt-Backups-Volume. Keine Argumente.

`tale restore [snapshot-id]` — einen Snapshot wiederherstellen; ohne ID werden die verfügbaren Snapshots aufgelistet.

- `--stop` — laufende Projekt-Container vor dem Wiederherstellen stoppen.
- `-y, --yes` — die Bestätigungsabfrage überspringen.

`tale rollback` — auf die vorherige Patch-Version zurückrollen (nur Patch-Ebene). Fragt vorher nach Bestätigung.

- `-y, --yes` — die Bestätigungsabfrage überspringen (im nicht-interaktiven Betrieb erforderlich).

### Wartung

`tale update` — diese Tale-Instanz auf eine neue Version bewegen: zuerst das CLI-Binary aktualisieren, dann die Projektdateien synchronisieren; danach `tale deploy` ausführen, um die Container zu rollen. Die CLI gleicht sich bei jedem Befehl ohnehin an die Instanz-Version an, also brauchst du das nur, um die Version bewusst zu wechseln.

- `-v, --version <version>` — auf genau diese Version aktualisieren (z. B. `0.9.0`) statt der neuesten; erlaubt Downgrades.
- `-f, --force` — Re-Sync erzwingen und lokal geänderte Projektdateien überschreiben.
- `--dry-run` — anzeigen, was sich ändern würde, ohne etwas zu ändern.

`tale migrate` — die mitgelieferten Defaults für jede Organisation auf dem laufenden Deployment neu provisionieren — derselbe idempotente Schritt, den jeder Deploy ausführt, nur auf Zuruf. Schema-Migrationen sind kein Command: Das Backend wendet sie beim Start an, ein deployter Container ist also immer auf seinem eigenen Schema.

- `--dry-run` — zeigen, was laufen würde, ohne es auszuführen.

`tale cleanup` — inaktive (nicht-aktuelle) Container entfernen. Keine Argumente.

`tale reset` — alle Blue-Green-Container entfernen.

- `-f, --force` — die Bestätigungsabfrage überspringen.
- `-a, --all` — auch die zustandsbehafteten Infrastruktur-Container entfernen.
- `--dry-run` — den Reset vorab anzeigen, ohne Änderungen.

`tale uninstall` — das `tale`-CLI-Binary von diesem System entfernen. Fragt nach, bevor etwas gelöscht wird, und _bietet an_, zusätzlich die benutzereigene Konfiguration (`~/.tale-daemon`) zu entfernen und die Docker-Ressourcen und Dateien eines Projekts abzubauen. Ohne `--purge` bleiben ein Projekt und seine Container unangetastet — führ darin `tale reset --all` aus, um sie zu entfernen.

- `-f, --force` — die Bestätigungsabfrage überspringen (entfernt nur das Binary; die optionalen Aufräumschritte brauchen weiterhin `--purge`).
- `--purge` — zusätzlich `~/.tale-daemon` entfernen und, für ein vom aktuellen Verzeichnis aus gefundenes Projekt, dessen Docker-Ressourcen abbauen und seine Dateien löschen. Nicht umkehrbar.
- `--dry-run` — anzeigen, was entfernt würde, ohne etwas zu entfernen.

`tale config` — CLI-Konfiguration verwalten. Mit dem Unterbefehl `show` die aufgelöste Konfiguration ausgeben.

### Erweitert

`tale auth reset-owner` — die Zugangsdaten des Owner-Kontos zurücksetzen.

- `-e, --email <email>` — eine neue Owner-E-Mail-Adresse setzen.
- `-p, --password <password>` — ein neues Owner-Passwort setzen.

## Fehlersuche

- **`tale deploy` trifft die falsche Maschine.** Die CLI nutzt den Docker-Kontext / `DOCKER_HOST` deiner Shell. Wechsle mit `docker context use …` (oder setz `DOCKER_HOST`), sodass er auf den gewünschten Host zeigt, und lauf erneut.
- **`tale deploy` nutzt den falschen Host-Alias.** Der Host, auf dem der Proxy antwortet, kommt aus `HOST` im `.env` des Projekts, nicht aus einem separaten CLI-Speicher. Bearbeite `.env` oder übergib `--host`, um ihn für einen Lauf zu überschreiben.
- **Installer scheitert auf macOS, weil das Binary nicht ausführbar ist.** Verweigert das frisch installierte Binary den Start (z. B. weil Gatekeeper es beendet), bricht der Installer mit Hinweisen zur Behebung ab, statt Erfolg zu melden — folg ihnen und lauf den Installer erneut.
- **`tale` nach der Installation auf Linux nicht gefunden.** Der Installer legt das Binary in `/usr/local/bin` ab; verifizier, dass das Verzeichnis im `PATH` des Users ist (`echo $PATH`).

## Wo das eingesetzt wird

Sobald die CLI verdrahtet ist, schrumpft die tägliche Oberfläche des Betreibers auf eine Handvoll Subbefehle. Welche Seiten du als Nächstes liest, hängt davon ab, wozu du gekommen bist — [Upgrades](/de/self-hosted/operate/upgrades) für Versionsbumps, [Backups und Restore](/de/self-hosted/operate/backups-and-restore) für Snapshot-Übungen, [Container-Architektur](/de/self-hosted/operate/container-architecture) dafür, was die CLI beim Deploy restartet.
