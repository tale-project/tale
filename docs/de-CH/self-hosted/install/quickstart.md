---
title: Lokaler Schnellstart
description: Tale lokal mit Docker Desktop in etwa zehn Minuten starten — für Evaluierung, Demos und Beiträge.
---

Der lokale Schnellstart ist der schnellste Weg, eine laufende Tale-Instanz auf deinen Laptop zu bringen. Die `tale`-CLI erledigt die Installation — ein Befehl gerüstet das Projekt, ein Befehl startet den Stack, dann ein Browser auf `https://localhost`. Nutze ihn, um das Produkt zu evaluieren, einem Team eine Demo zu zeigen oder am Quelltext zu schrauben. Für eine öffentliche Instanz mit echtem TLS und Upgrades ohne Ausfallzeit folge stattdessen [Produktions-Deployment](/de-CH/self-hosted/install/linux-server).

Diese Anleitung nimmt einen Entwickler-Laptop mit installiertem Docker Desktop an. Alles unten nutzt dieselbe CLI, die auch in Produktion läuft — die einzigen Unterschiede sind der TLS-Modus (selbstsigniert als Voreinstellung) und dass alle Ports lokal aus Entwicklungsbequemlichkeit exponiert sind.

## Bevor du beginnst

- **Docker Desktop 24.0 oder neuer** — installiert und laufend. Die Linux-, macOS- und Windows-Builds funktionieren alle.
- **Ein API-Schlüssel von OpenRouter** — kostenlos auf [openrouter.ai](https://openrouter.ai) erstellbar. OpenRouter gibt dir über einen einzigen Schlüssel Zugriff auf hunderte Modelle. Jeder OpenAI-kompatible Endpunkt funktioniert, einschliesslich eines lokalen Ollama-Servers; OpenRouter ist die empfohlene Voreinstellung, weil sie am meisten abdeckt.

Hol den Schlüssel aus dem Bereich **Keys** im OpenRouter-Dashboard, sobald du ein Konto hast, und halte ihn bereit — `tale init` fragt während der Einrichtung danach.

## Schritt 1 — Die CLI installieren

Die `tale`-CLI ist eine Binärdatei, die den vollen Lebenszyklus fährt: init, start, upgrade, deploy, logs, rollback. Das Installationsskript schreibt unter Linux und macOS nach `/usr/local/bin/tale`:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

Unter Windows läuft es über PowerShell:

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Beide Installer respektieren eine `VERSION`-Umgebungsvariable, um eine bestimmte Version anzuheften:

```bash
VERSION=0.9.0 curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

```powershell
$env:VERSION = '0.9.0'
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

Verfügbare Tags stehen auf der Seite [GitHub Releases](https://github.com/tale-project/tale/releases). Wenn du das Installationsskript überspringen willst, ist die Binärdatei auch als direkter Download an jedem Release-Tag verfügbar.

## Schritt 2 — Ein Projekt erstellen

Wähle ein Verzeichnis und fahre `tale init`:

```bash
tale init my-project
cd my-project
```

Die CLI fragt nach Domain (Voreinstellung `localhost`), OpenRouter-Schlüssel und TLS-Modus (Voreinstellung `selfsigned`). Sie schreibt eine `.env`-Datei mit automatisch erzeugten Secrets — `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`, `INSTANCE_SECRET` und einen `SOPS_AGE_KEY` für den SOPS-verschlüsselten Anbieter-Secret-Modus. Das Projektverzeichnis ist die Wahrheitsquelle für diese Instanz: `.env` hält die Secrets, `TALE_CONFIG_DIR` hält die Anbieter-, Aufbewahrungs- und Agent-JSON-Dateien.

`tale init` legt auch Konfigurationsdateien für KI-Editoren ab (Claude Code, Cursor, GitHub Copilot, Windsurf) und entpackt den Platform-Quelltext nach `.tale/reference/`, sodass du das Projekt in einem KI-unterstützten Editor öffnen und Agents, Workflows und Integrationen in natürlicher Sprache erstellen kannst. Das vollständige Muster steht unter [KI-unterstützte Entwicklung](/de-CH/develop/ai-assisted-development).

## Schritt 3 — Tale starten

```bash
tale start
```

Health-Check-Meldungen strömen, während die Dienste hochfahren — das ist erwartet. Warte auf die Zeile `Tale Dev v0.x.x  Ready.`, bevor du den Browser öffnest; der `platform`-Container braucht bei einem Kaltstart bis zu drei Minuten, weil der Entrypoint wartet, bis die Env-Synchronisation fertig ist und `bunx convex deploy` die Funktionsmenge geschoben hat, bevor er gesund signalisiert.

Um im Hintergrund zu fahren, übergib `--detach`:

```bash
tale start --detach
```

## Schritt 4 — Die App öffnen

Öffne `https://localhost` (oder welche Domain du auch immer bei `tale init` konfiguriert hast). Der erste Besuch führt dich auf eine Registrierungsseite — der erste registrierte Nutzer wird Inhaber der Instanz.

Das selbstsignierte Zertifikat löst beim ersten Besuch eine Browser-Warnung aus. Klick durch (Chrome: **Erweitert → Weiter**; Firefox: **Erweitert → Risiko akzeptieren**); die Warnung ist für `TLS_MODE=selfsigned` erwartet. Für eine öffentliche Instanz wähle bei `tale init` `letsencrypt` oder folge [Produktions-Deployment](/de-CH/self-hosted/install/linux-server).

## Tagesrhythmus

`tale start` und `docker compose down` sind das Start/Stopp-Paar, das du am häufigsten nutzt.

```bash
tale start                       # Alle Dienste im Vordergrund starten
tale start --detach              # Im Hintergrund starten
docker compose -p tale-dev down  # Container stoppen, Volumes (und Daten) behalten
```

Die Option `-p tale-dev` ist nötig, weil `tale start` diesen Compose-Projektnamen verwendet und nicht eine Standard-`docker-compose.yml`. **Hänge nie `-v` an den `down`-Befehl** — er löscht jedes benannte Volume, also die Datenbank, jede hochgeladene Datei und den Crawler-Zustand. Es gibt keine Wiederherstellung.

### Upgrade

```bash
tale upgrade                       # Das neueste Release ziehen und Projektdateien synchronisieren
tale upgrade --version 0.9.0       # Migrieren oder zurück auf eine bestimmte Version
tale start                         # Mit der neuen Version neu starten
```

Lies die [Release-Notes](https://github.com/tale-project/tale/releases) vor dem Upgrade; Breaking-Changes und Migrationshinweise werden gemäss [Release-Notes-Format](/de-CH/self-hosted/operate/release-notes/format) explizit ausgewiesen.

### Convex-Daten inspizieren

Das gebündelte Convex-Backend liefert ein Dashboard zum Inspizieren von Sammlungen, Funktionslogs und Hintergrundjobs. Erzeuge einen Admin-Schlüssel und öffne dann das Dashboard:

```bash
tale convex admin
```

Öffne `/convex-dashboard` im Browser und füge den Schlüssel ein. Das Dashboard gibt direkten Lese- und Schreibzugriff auf alles in Convex, also halte den Schlüssel lokal.

## Aus dem Quelltext bauen

Wenn du beitragen oder die Plattform anpassen möchtest, fahre aus einem Checkout statt aus vorgefertigten Images. Das Repository klonen, die Beispiel-Env kopieren und die Platzhalter-Secrets ersetzen:

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Die `.env.example` liefert Platzhalter-Secrets aus, die ersetzt werden müssen, bevor der Stack startet. Generiere frische Werte:

| Variable                | Generieren mit                        |
| ----------------------- | ------------------------------------- |
| `BETTER_AUTH_SECRET`    | `openssl rand -base64 32`             |
| `ENCRYPTION_SECRET_HEX` | `openssl rand -hex 32`                |
| `DB_PASSWORD`           | Beliebiges Passwort für die lokale DB |

Dann bauen und starten:

```bash
docker compose up --build
```

Für einen schnelleren Edit-Reload-Zyklus leg das Entwicklungs-Override auf, das deinen lokalen Quelltext in die Container bindet:

```bash
docker compose -f compose.yml -f compose.dev.yml up --build
```

Nach Änderungen an einer `Dockerfile` oder einer Abhängigkeit fahre `bun run docker:test`, um den Build zu rauchprüfen. Die [Contributing-Docker-Anleitung](/de-CH/develop/contributing-docker) deckt die Image-Validierungs- und Schwachstellenscan-Skripte ab.

## Wo das einsetzt

Was du jetzt hast, ist eine laufende Tale-Instanz auf `localhost` mit Beispiel-Agents, Beispielwissen und einem konfigurierten KI-Anbieter. Das reicht, um das Produkt zu evaluieren, es einem Team zu demonstrieren oder gegen die Plattform zu entwickeln. Es reicht nicht, um es jemandem ausserhalb deines Laptops zugänglich zu machen — der Schnellstart nutzt selbstsigniertes TLS, fährt jeden Dienst auf einem Container und überspringt die Blue-Green-Topologie, die Upgrades ohne Wartungsfenster übersteht.

Wenn du bereit bist, Tale Nutzern vorzulegen, läuft [Produktions-Deployment](/de-CH/self-hosted/install/linux-server) dieselbe Installation mit echter Domain, echtem TLS und dem Blue-Green-Roll. Für den Rest der Operator-Oberfläche — Observability, Aufbewahrung, Sicherheitshinweise — ist [Betrieb](/de-CH/self-hosted/operate/observability/operations) der Index.
