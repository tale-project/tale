---
title: Self-hosted Quickstart
description: Bring eine funktionierende Tale-Instanz mit der tale-CLI in drei Befehlen auf deine Maschine — installieren, tale init, tale start, dann anmelden.
---

Das ist der schnellste Weg zu einem laufenden Tale: installier die `tale`-CLI, dann zwei Befehle. Das Ergebnis ist deine eigene Org, die auf deiner eigenen Maschine läuft und im Browser erreichbar ist. Gedacht ist das für einen Laptop oder einen einzelnen Host, auf dem du Tale ausprobieren willst; wenn du es im Ernst betreiben willst, deckt der [Linux-Server](/de/self-hosted/install/linux-server)-Spaziergang eine gehärtete Produktions-Installation ab.

Du brauchst zwei Dinge:

- **[Docker Desktop](https://www.docker.com/products/docker-desktop)** (v24+) am Laufen, oder Docker Engine plus das Compose-Plugin unter Linux.
- Einen **[OpenRouter-API-Key](https://openrouter.ai)**, damit Agents ein Modell zum Reden haben. Du kannst später jeden Provider einsetzen.

## Schritt 1 — Die CLI installieren

Unter macOS oder Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Unter Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Der Installer erkennt dein OS, legt das `tale`-Binary auf deinen `PATH` und ist der einzige Schritt, der dein System anfasst. Prüf, dass es gelandet ist:

```bash
tale --version
```

## Schritt 2 — Ein Projekt erstellen

```bash
tale init my-project
cd my-project
```

`tale init` legt ein Projektverzeichnis an und führt dich durch das Wesentliche: Es fragt nach deinem OpenRouter-API-Key, generiert jedes Security-Secret für dich und schreibt die `.env`, sodass es nichts von Hand zu editieren gibt. Es legt außerdem Beispiel-Agents, -Workflows und -Integrationen unter `default/` ab und generiert Editor-Konfiguration für Claude Code, Cursor, Copilot und Windsurf, damit ein KI-Editor Konfigurationen mit voller Schema-Kenntnis bauen kann.

## Schritt 3 — Tale starten

```bash
tale start
```

Der erste Lauf zieht die Images und baut den Container-Graph — rechne mit fünf bis zehn Minuten auf einer frischen Maschine. Sobald die Plattform bereit meldet (`Tale Platform is running`), öffnet `tale start` automatisch deinen Browser. Kann es das nicht, gibt es die URL zum Besuchen aus.

> Dein Browser zeigt eine Zertifikatswarnung für das lokale selbstsignierte Zertifikat. Das ist erwartet — akzeptier sie, um fortzufahren.

Deine Konfiguration unter `default/` wird in die laufende Instanz gemountet, sodass Edits an Agents, Workflows und Integrationen live nachladen. Stopp den Stack mit `Ctrl-C` (oder `tale start --detach`, um ihn im Hintergrund laufen zu lassen).

## Schritt 4 — Dein Konto erstellen

Klick auf dem Anmelde-Bildschirm **Sign up** und füll deinen Namen, deine E-Mail und ein Passwort aus. Das erste Konto auf einer brandneuen Instanz beansprucht die Rolle **Owner** und erstellt deine **Organisation**. Du landest im Dashboard.

> Fragt der Sign-up-Bildschirm nach einem einmaligen Admin-Key, ist [Erster Admin](/de/self-hosted/install/first-admin) der kurze Spaziergang, der ihn ausgibt und erklärt, wie du die Anmeldung schließt, sobald dein Team drin ist.

## Schritt 5 — Ein Modell hinzufügen und einen Agent veröffentlichen

Du hast jetzt eine leere Org. Zwei Schritte bringen dich zu etwas Nützlichem:

1. Öffne **Einstellungen > Provider** und prüf, dass dein OpenRouter-Key verbunden ist (die CLI hat ihn beim `tale init` hinzugefügt).
2. Veröffentliche deinen ersten Agent — [Agent erstellen](/de/platform/agents/create) bringt ihn von einer Rolle und ein paar Instruktionen zu einem funktionierenden Spezialisten.

Von hier sind die [Platform](/de/platform)-Docs die kanonische Referenz für jedes Feature, und sie sind identisch zu Cloud.

## Lieber pures Docker Compose?

Die CLI umhüllt `docker compose`, damit du das nicht musst. Willst du den Stack lieber aus einem Klon des Repositories fahren und Compose selbst verwalten — für Transparenz, Air-gapped-Builds oder deine eigene Automation — klon das Repo, kopier `.env.example` nach `.env`, setz `HOST` und `SITE_URL`, generier die Secrets und `docker compose up -d`. Der [Linux-Server](/de/self-hosted/install/linux-server)-Spaziergang und die [Docker-Compose-Referenz](/de/self-hosted/install/docker-compose-reference) decken diesen Weg von Anfang bis Ende ab.

## Fehlersuche

- **`tale` nach der Installation nicht gefunden.** Der Installer benennt das Zielverzeichnis in seiner Ausgabe; stell sicher, dass dieses Verzeichnis auf deinem `PATH` liegt (unter Linux ist es meist `/usr/local/bin`).
- **`tale start` beendet mit einem Port-Konflikt.** Ein anderer Dienst bindet auf dem Host bereits 443. Gib ihn frei, oder starte auf einem anderen Port mit `tale start --port 8443`.
- **Docker läuft nicht.** `tale start` braucht den Docker-Daemon oben. Starte Docker Desktop (oder `sudo systemctl start docker` unter Linux) und versuch es erneut.
- **Ein Container crash-loopt beim ersten Boot.** Fast immer ein fehlendes Secret — lauf `tale start` erneut, was das Environment-Setup erneut ausführt, oder inspizier die Logs mit `tale logs platform`.

## Wo das eingesetzt wird

Du hast jetzt eine funktionierende Tale-Instanz auf deiner Maschine. Um es im Ernst zu betreiben, deckt der [Linux-Server](/de/self-hosted/install/linux-server)-Spaziergang TLS, Firewall, einen Non-root-User und die operativen Haken ab, die du vor echtem Verkehr willst; [CLI installieren](/de/self-hosted/install/cli-install) richtet die CLI ein, um eine entfernte Instanz von deiner Workstation aus zu deployen und zu upgraden.
