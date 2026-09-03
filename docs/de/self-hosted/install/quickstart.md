---
title: Selbst gehosteter Quickstart
description: Bring eine funktionierende Tale-Instanz auf deine Maschine — installier die tale-CLI, dann zwei Befehle, und der Setup-Wizard macht dich zum Inhaber.
---

Das ist der schnellste Weg zu einem laufenden Tale: installiere die `tale`-CLI, dann zwei Befehle. Das Ergebnis ist deine eigene Org auf deiner eigenen Maschine, erreichbar im Browser. Gedacht ist das für einen Laptop oder einen einzelnen Host, auf dem du Tale ausprobieren willst; sobald du es ernsthaft betreiben willst, deckt die [Linux-Server-Strecke](/de/self-hosted/install/linux-server) eine gehärtete Produktions-Installation ab.

## Bevor du beginnst

Du brauchst nichts zum Starten und eine Sache, bevor ein Agent antworten kann:

- **Docker** — aber die CLI stellt es für dich bereit: Fehlt Docker, bietet `tale dev` an, es zu installieren oder zu starten, bevor irgendetwas anderes passiert. Läuft bei dir bereits [Docker Desktop](https://www.docker.com/products/docker-desktop) (v24+) oder Docker Engine plus Compose-Plugin unter Linux, nutzt die CLI das.
- Einen **[OpenRouter-API-Schlüssel](https://openrouter.ai)** (oder einen beliebigen OpenAI-kompatiblen Anbieter), damit Agents ein Modell zum Reden haben. Für `tale init` brauchst du ihn nicht — du fügst ihn nach der Registrierung in der App hinzu, im Setup-Assistenten oder unter **Einstellungen > KI-Anbieter**, und du kannst später jeden Anbieter einwechseln.

## Von null bis angemeldet

<Steps>

<Step title="Installiere die CLI">

Der Installer erkennt dein OS, legt das `tale`-Binary auf deinen `PATH` und ist der einzige Schritt, der dein System anfasst — er fragt nach `sudo`, wenn das Installationsverzeichnis (Standard `/usr/local/bin`) nicht beschreibbar ist.

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

<Check>

Gibt `tale --version` eine Versionsnummer aus, ist das Binary auf deinem `PATH` gelandet.

</Check>

</Step>

<Step title="Erstelle ein Projekt">

```bash
tale init my-project
cd my-project
```

`tale init` legt ein Projektverzeichnis an, generiert jedes Security-Secret und schreibt die `.env`, sodass es nichts von Hand zu editieren gibt. Die Defaults sind localhost und ein selbstsigniertes Zertifikat; die Produktions-Domäne wählst du später, bei `tale deploy`. Die eine Frage, die es stellt, ist, ob Agents in ihren Sandboxes `docker` / `docker compose` ausführen dürfen — der Default ist Nein, denn die Freigabe startet einen privilegierten inneren Docker; auf einer Einzelnutzer-Maschine kannst du zustimmen, als Multi-Tenant-Betreiber installierst du stattdessen Sysbox. Nach einem API-Schlüssel fragt es nicht; den sammelt die App ein, sobald du dich anmeldest. Es legt außerdem Beispiel-Agents, -Workflows, -Connectors, -Provider, -Skills und -Branding unter `default/` ab und schreibt `AGENTS.md` (plus einen `CLAUDE.md`-Verweis), damit ein KI-Editor Konfigurationen mit voller Schema-Kenntnis bauen kann. Das meiste davon ist ein Katalog, keine aktive Konfiguration: Auf einer neuen Organisation sind nur Einträge mit `autoInstall` aktiv — den Unterschied erklärt die generierte `default/README.md`.

</Step>

<Step title="Starte Tale">

```bash
tale dev
```

Fehlt Docker, bietet `tale dev` zuerst an, es zu installieren oder zu starten. Der erste Lauf zieht dann mehrere Gigabyte an Images und baut den Container-Graph — die CLI zeigt den Pull-Fortschritt pro Image an und wartet weiter; in einem langsamen Netz kann das Dutzende Minuten dauern. Sobald der Stack bereit meldet (`Tale is running — open https://localhost`), öffnet `tale dev` automatisch deinen Browser. Kann es das nicht, gibt es die URL zum Besuchen aus.

<Note>

Dein Browser zeigt eine Zertifikatswarnung für das lokale selbstsignierte Zertifikat. Das ist erwartet — akzeptier sie, um fortzufahren.

</Note>

Deine Konfiguration unter `default/` wird in die laufende Instanz gemountet, sodass Änderungen an Agents, Workflows und Connectors live nachladen. Stopp den Stack mit `Ctrl-C` (oder `tale dev --detach`, um ihn im Hintergrund laufen zu lassen).

</Step>

<Step title="Erstelle dein Konto">

Auf einer leeren Instanz gibt es keine Sign-up-Seite zu suchen: Der erste Besuch landet im einmaligen Setup-Wizard, der dein Konto anlegt, dich anmeldet, dich zum **Inhaber** macht und deine **Organisation** benennt. Du landest im Dashboard — ohne Admin-Key, und danach gibt es nichts abzuriegeln, denn alle nach dir kommen per Einladung dazu.

<Note>

[Erster Admin](/de/self-hosted/install/first-admin) behandelt den Wizard im Detail und wie Teammitglieder dazukommen.

</Note>

</Step>

<Step title="Verbinde ein Modell und veröffentliche einen Agent">

Du hast jetzt eine leere Org. Zwei Handgriffe bringen dich zu etwas Nützlichem: Füg deinen OpenRouter-Schlüssel hinzu — der Setup-Assistent fragt direkt nach der Erstellung des Inhaber-Kontos danach, und **Einstellungen > KI-Anbieter** nimmt ihn jederzeit später an — und veröffentliche dann deinen ersten Agent mit [Einen Agent erstellen](/de/platform/agents/create). Eine Bestätigung auf der Anbieterzeile heißt, dass der Schlüssel funktioniert.

<Check>

Ein neuer Chat, der eine Nachricht beantwortet, ist der Beweis von Anfang bis Ende: Anbieter, Modell und Agent funktionieren. Von hier aus sind die [Plattform](/de/platform)-Docs die kanonische Referenz für jedes Feature, identisch zu Cloud.

</Check>

</Step>

</Steps>

## Lieber pures Docker Compose?

Die CLI umhüllt `docker compose`, damit du das nicht musst. Willst du den Stack lieber aus einem Klon des Repositorys fahren und Compose selbst verwalten — für Transparenz, Air-gapped-Builds oder deine eigene Automation — klon das Repo, kopier `.env.example` nach `.env`, setz `HOST` und `SITE_URL`, generier die Secrets und starte `docker compose up -d`. Die [Linux-Server-Strecke](/de/self-hosted/install/linux-server) und die [Docker-Compose-Referenz](/de/self-hosted/install/docker-compose-reference) decken diesen Weg von Anfang bis Ende ab.

## Fehlersuche

- **`tale` nach der Installation nicht gefunden.** Der Installer benennt das Zielverzeichnis in seiner Ausgabe; stell sicher, dass dieses Verzeichnis auf deinem `PATH` liegt (unter Linux ist es meist `/usr/local/bin`).
- **`tale dev` beendet mit einem Port-Konflikt.** Lies aus dem Compose-Fehler ab, welcher Port belegt ist. Ist es 443, bindet ein anderer Dienst HTTPS auf dem Host — gib ihn frei oder leg Tale mit `tale dev --port 8443` auf einen anderen Port (das Flag betrifft nur den HTTPS-Port). Der Sandbox-Spawner bindet immer `127.0.0.1:8003` und lässt sich nicht verlegen; deshalb können zwei Tale-Dev-Projekte nicht gleichzeitig auf einer Maschine laufen.
- **Docker läuft nicht.** `tale dev` bietet an, es zu starten (oder zu installieren) — nimm die Rückfrage an, oder starte Docker Desktop selbst (`sudo systemctl start docker` unter Linux) und versuch es erneut.
- **Ein Container crash-loopt beim ersten Boot.** Fast immer ein fehlendes Secret — lauf `tale dev` erneut, was das Environment-Setup erneut ausführt, oder inspizier die Logs mit `tale logs platform`.

## Wo das eingesetzt wird

Du hast jetzt eine funktionierende Tale-Instanz auf deiner Maschine. Um sie ernsthaft zu betreiben, deckt die [Linux-Server-Strecke](/de/self-hosted/install/linux-server) TLS, Firewall, einen Non-root-Benutzer und die operativen Haken ab, die du vor echtem Traffic willst; [Die tale-CLI installieren](/de/self-hosted/install/cli-install) richtet die CLI so ein, dass du eine entfernte Instanz von deiner Workstation aus deployst und aktualisierst.
