---
title: Self-hosted Quickstart
description: Bring eine funktionierende Tale-Instanz auf deine Maschine — installier die tale-CLI, dann zwei Befehle, und der Setup-Wizard macht dich zum Owner.
---

Das ist der schnellste Weg zu einem laufenden Tale: installier die `tale`-CLI, dann zwei Befehle. Das Ergebnis ist deine eigene Org, die auf deiner eigenen Maschine läuft und im Browser erreichbar ist. Gedacht ist das für einen Laptop oder einen einzelnen Host, auf dem du Tale ausprobieren willst; wenn du es im Ernst betreiben willst, deckt der [Linux-Server](/de/self-hosted/install/linux-server)-Spaziergang eine gehärtete Produktions-Installation ab.

Du brauchst nichts zum Starten und eine Sache, bevor ein Agent antworten kann:

- **Docker** — aber die CLI stellt es für dich bereit: Fehlt Docker, bietet `tale dev` an, es zu installieren oder zu starten, bevor irgendetwas anderes passiert. Läuft bei dir bereits [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+) oder Docker Engine plus Compose-Plugin unter Linux, nutzt die CLI das.
- Einen **[OpenRouter-API-Key](https://openrouter.ai)** (oder einen beliebigen OpenAI-kompatiblen Provider), damit Agents ein Modell zum Reden haben. Für `tale init` brauchst du ihn nicht — du fügst ihn in der App hinzu, im Setup-Wizard oder unter **Einstellungen > KI-Anbieter**, und du kannst später jeden Provider einsetzen.

## Schritt 1 — Die CLI installieren

Unter macOS oder Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Unter Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Der Installer erkennt dein OS, legt das `tale`-Binary auf deinen `PATH` und ist der einzige Schritt, der dein System anfasst — er fragt nach `sudo`, wenn das Installationsverzeichnis (Standard `/usr/local/bin`) nicht beschreibbar ist. Prüf, dass es gelandet ist:

```bash
tale --version
```

## Schritt 2 — Ein Projekt erstellen

```bash
tale init my-project
cd my-project
```

`tale init` legt ein Projektverzeichnis an, generiert jedes Security-Secret und schreibt die `.env`, sodass es nichts von Hand zu editieren gibt. Die Defaults sind localhost und ein selbstsigniertes Zertifikat; die Produktions-Domäne wählst du später, bei `tale deploy`. Die eine Frage, die es stellt, ist, ob Agents in ihren Sandboxes `docker` / `docker compose` ausführen dürfen — der Default ist Nein, denn die Freigabe startet einen privilegierten inneren Docker; auf einer Einzelnutzer-Maschine kannst du zustimmen, als Multi-Tenant-Betreiber installierst du stattdessen Sysbox. Nach einem API-Key fragt es nicht; den sammelt die App ein, sobald du dich anmeldest. Es legt außerdem Beispiel-Agents, -Workflows, -Integrationen, -Provider, -Skills und -Branding unter `default/` ab und schreibt `AGENTS.md` (plus einen `CLAUDE.md`-Verweis), damit ein KI-Editor Konfigurationen mit voller Schema-Kenntnis bauen kann. Das meiste davon ist ein Katalog, keine aktive Konfiguration: Auf einer neuen Organisation sind nur Einträge mit `autoInstall` aktiv — den Unterschied erklärt die generierte `default/README.md`.

## Schritt 3 — Tale starten

```bash
tale dev
```

Fehlt Docker, bietet `tale dev` zuerst an, es zu installieren oder zu starten. Der erste Lauf zieht dann mehrere Gigabyte an Images und baut den Container-Graph — die CLI zeigt den Pull-Fortschritt pro Image an und wartet weiter; in einem langsamen Netz kann das Dutzende Minuten dauern. Sobald der Stack bereit meldet (`Tale is running — open https://localhost`), öffnet `tale dev` automatisch deinen Browser. Kann es das nicht, gibt es die URL zum Besuchen aus.

> Dein Browser zeigt eine Zertifikatswarnung für das lokale selbstsignierte Zertifikat. Das ist erwartet — akzeptier sie, um fortzufahren.

Deine Konfiguration unter `default/` wird in die laufende Instanz gemountet, sodass Edits an Agents, Workflows und Integrationen live nachladen. Stopp den Stack mit `Ctrl-C` (oder `tale dev --detach`, um ihn im Hintergrund laufen zu lassen).

## Schritt 4 — Den Setup-Wizard durchlaufen

Auf einer leeren Instanz gibt es keine Sign-up-Seite zu suchen: Der erste Besuch landet im einmaligen Setup-Wizard, der dein Konto anlegt, dich anmeldet, dich zum **Owner** macht und deine **Organisation** benennt. Du landest im Dashboard — ohne Admin-Key, und danach gibt es nichts abzuriegeln, denn alle nach dir kommen per Einladung dazu.

> [Erster Admin](/de/self-hosted/install/first-admin) behandelt den Wizard im Detail, wie Teammitglieder dazukommen und den Convex-Dashboard-Admin-Key — ein Backend-Inspektionswerkzeug, das mit der Anmeldung nichts zu tun hat.

## Schritt 5 — Ein Modell hinzufügen und einen Agent veröffentlichen

Du hast jetzt eine leere Org. Zwei Schritte bringen dich zu etwas Nützlichem:

1. Füg deinen OpenRouter-Key hinzu. Der Setup-Wizard fragt direkt nach der Erstellung des Owner-Kontos danach; hast du ihn übersprungen, öffne **Einstellungen > KI-Anbieter** und füg ihn dort ein. Ein Häkchen auf der Provider-Zeile bedeutet, dass der Key funktioniert.
2. Veröffentliche deinen ersten Agent — [Agent erstellen](/de/platform/agents/create) bringt ihn von einer Rolle und ein paar Instruktionen zu einem funktionierenden Spezialisten.

Von hier sind die [Platform](/de/platform)-Docs die kanonische Referenz für jedes Feature, und sie sind identisch zu Cloud.

## Lieber pures Docker Compose?

Die CLI umhüllt `docker compose`, damit du das nicht musst. Willst du den Stack lieber aus einem Klon des Repositories fahren und Compose selbst verwalten — für Transparenz, Air-gapped-Builds oder deine eigene Automation — klon das Repo, kopier `.env.example` nach `.env`, setz `HOST` und `SITE_URL`, generier die Secrets und `docker compose up -d`. Der [Linux-Server](/de/self-hosted/install/linux-server)-Spaziergang und die [Docker-Compose-Referenz](/de/self-hosted/install/docker-compose-reference) decken diesen Weg von Anfang bis Ende ab.

## Fehlersuche

- **`tale` nach der Installation nicht gefunden.** Der Installer benennt das Zielverzeichnis in seiner Ausgabe; stell sicher, dass dieses Verzeichnis auf deinem `PATH` liegt (unter Linux ist es meist `/usr/local/bin`).
- **`tale dev` beendet mit einem Port-Konflikt.** Lies aus dem Compose-Fehler ab, welcher Port belegt ist. Ist es 443, bindet ein anderer Dienst HTTPS auf dem Host — gib ihn frei oder leg Tale mit `tale dev --port 8443` auf einen anderen Port (das Flag betrifft nur den HTTPS-Port). Der Sandbox-Spawner bindet immer `127.0.0.1:8003` und lässt sich nicht verlegen; deshalb können zwei Tale-Dev-Projekte nicht gleichzeitig auf einer Maschine laufen.
- **Docker läuft nicht.** `tale dev` bietet an, es zu starten (oder zu installieren) — nimm die Rückfrage an, oder starte Docker Desktop selbst (`sudo systemctl start docker` unter Linux) und versuch es erneut.
- **Ein Container crash-loopt beim ersten Boot.** Fast immer ein fehlendes Secret — lauf `tale dev` erneut, was das Environment-Setup erneut ausführt, oder inspizier die Logs mit `tale logs platform`.

## Wo das eingesetzt wird

Du hast jetzt eine funktionierende Tale-Instanz auf deiner Maschine. Um es im Ernst zu betreiben, deckt der [Linux-Server](/de/self-hosted/install/linux-server)-Spaziergang TLS, Firewall, einen Non-root-User und die operativen Haken ab, die du vor echtem Verkehr willst; [CLI installieren](/de/self-hosted/install/cli-install) richtet die CLI ein, um eine entfernte Instanz von deiner Workstation aus zu deployen und zu upgraden.
