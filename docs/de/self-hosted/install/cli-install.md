---
title: Die tale-CLI installieren
description: Die tale-CLI auf macOS, Linux oder Windows installieren — und sie gegen deine self-hosted Instanz für Deploys und Upgrades konfigurieren.
---

Die `tale`-CLI ist das Werkzeug des Betreibers, um eine self-hosted Instanz von einer Workstation aus zu fahren. Sie umwickelt die häufigsten Operationen — eine neue Version deployen, Migrationen ausführen, Diagnostiken einfangen —, damit du dir nicht jede `docker compose`-Invokation merken musst. Dieser Spaziergang installiert sie auf den drei unterstützten Plattformen und richtet sie auf deine Instanz.

Die CLI ist optional. Alles, was sie macht, lässt sich direkt mit `docker compose` und `ssh` machen; die CLI ist eine Bequemlichkeit für Teams, die eine einzige Befehls-Oberfläche bevorzugen. Steckt das Team schon tief in der eigenen Automatisierung, überspring diese Seite und bleib bei Compose.

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

## Schritt 3 — Den Admin-Key konfigurieren

```bash
tale config set host tale.example.com
tale config set admin-key <key-aus-erster-admin>
```

Die CLI speichert die Konfiguration unter `~/.config/tale/config.yml`. Der Admin-Key authentifiziert die Aufrufe der CLI an den Platform-Container; den Platform-Container neu zu starten rotiert den Key, also frisch ihn dann auf.

## Schritt 4 — tale deploy ausführen

```bash
tale deploy
```

`tale deploy` zieht die neuesten Images für die konfigurierte `TALE_VERSION`, restartet die betroffenen Container in der richtigen Reihenfolge und führt Schema-Migrationen aus. Es ist der unterstützte Ersatz für das längere `docker compose pull && docker compose up -d`-Tänzchen. Bevorzugst du Compose direkt, lebt derselbe Effekt in [Upgrades](/de/self-hosted/operate/upgrades).

## Fehlersuche

- **`tale --version` druckt, aber `tale deploy` bricht mit „host not configured" ab.** Lauf zuerst `tale config set host …`; die CLI übernimmt den Host nicht aus `.env`.
- **`tale deploy` bricht mit „auth failed" ab.** Der Admin-Key ist rotiert, seit du ihn konfiguriert hast. Lauf erneut `./scripts/get-admin-key.sh` auf dem Host und `tale config set admin-key …` auf der Workstation.
- **Installer scheitert auf macOS mit einer Gatekeeper-Warnung.** Das Binary ist signiert, aber auf Apple Silicon noch nicht notarisiert; der Installer druckt den `xattr`-Befehl, um das Quarantäne-Flag zu löschen.
- **`tale` nach der Installation auf Linux nicht gefunden.** Der Installer legt das Binary in `/usr/local/bin` ab; verifizier, dass das Verzeichnis im `PATH` des Users ist (`echo $PATH`).

## Wo das eingesetzt wird

Sobald die CLI verdrahtet ist, schrumpft die tägliche Oberfläche des Betreibers auf eine Handvoll Subbefehle. Welche Seiten du als Nächstes liest, hängt davon ab, wozu du gekommen bist — [Upgrades](/de/self-hosted/operate/upgrades) für Versionsbumps, [Backups und Restore](/de/self-hosted/operate/backups-and-restore) für Snapshot-Übungen, [Container-Architektur](/de/self-hosted/operate/container-architecture) dafür, was die CLI beim Deploy restartet.
