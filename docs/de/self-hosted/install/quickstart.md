---
title: Lokaler Schnellstart
description: Tale lokal mit Docker Desktop in etwa zehn Minuten starten — für Evaluierung, Demos und Beiträge.
---

Das hier ist der schnellste Weg, eine lokale Tale-Instanz auf deinem Laptop laufen zu lassen. Nutze diesen Schnellstart, um das Produkt zu evaluieren, eine Demo zu zeigen oder gegen die Plattform zu entwickeln. Für eine öffentlich erreichbare Instanz mit TLS und unterbrechungsfreien Upgrades folge stattdessen dem [Produktions-Deployment](/de/self-hosted/install/linux-server).

## Voraussetzungen

| Software       | Mindestversion | Bezugsquelle                                   |
| -------------- | -------------- | ---------------------------------------------- |
| Docker Desktop | 24.0+          | https://www.docker.com/products/docker-desktop |

### API-Schlüssel besorgen

Tale nutzt standardmäßig OpenRouter als KI-Gateway, das dir über einen einzigen API-Schlüssel Zugriff auf Hunderte von Modellen gibt.

Erstelle ein kostenloses Konto auf https://openrouter.ai, erzeuge im Kontomenü unter **Keys** einen neuen API-Schlüssel und kopiere ihn, um ihn während der Einrichtung einzufügen.

> **Tipp:** Jeder OpenAI-kompatible Anbieter funktioniert, auch eine lokale Ollama-Instanz. OpenRouter ist wegen der Modellvielfalt und einfachen Preisgestaltung der empfohlene Standard.

## Einrichtung

### Schritt 1: CLI installieren

**Linux / macOS:**

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex
```

> **Bestimmte Version festlegen:** Beide Installer berücksichtigen die Umgebungsvariable `VERSION`. Auf Linux/macOS: `VERSION=0.9.0 curl -fsSL …/install-cli.sh | bash`, auf Windows: `$env:VERSION = '0.9.0'; irm …/install-cli.ps1 | iex`. Verfügbare Tags listet die [GitHub-Releases-Seite](https://github.com/tale-project/tale/releases).

Oder lade die Binary direkt — ersetze `latest` durch einen Version-Tag (z. B. `v0.9.0`), um zu pinnen:

```bash
# Linux
curl -fsSL https://github.com/tale-project/tale/releases/latest/download/tale_linux \
  -o /usr/local/bin/tale
chmod +x /usr/local/bin/tale
```

### Schritt 2: Projekt anlegen

```bash
tale init my-project
cd my-project
```

Die CLI fragt nach deiner Domain, dem API-Schlüssel und dem TLS-Modus. Sicherheits-Secrets (`BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`) werden automatisch erzeugt.

> **Tipp:** `tale init` legt zusätzlich Konfigurationsdateien für KI-Editoren (Claude Code, Cursor, GitHub Copilot, Windsurf) ab und extrahiert den Plattform-Quellcode nach `.tale/reference/`. Öffne dein Projekt in einem dieser Editoren, um Agents, Workflows und Integrationen in natürlicher Sprache zu erstellen und zu bearbeiten. Siehe [AI-assisted development](/de/develop/ai-assisted-development).

### Schritt 3: Tale starten

```bash
tale start
```

Warte auf `Tale Dev v0.x.x  Ready.` Health-Check-Meldungen während des Starts sind normal — warte auf die `Ready`-Zeile, bevor du den Browser öffnest.

### Schritt 4: App öffnen

Gehe in deinem Browser auf https://localhost (oder deine konfigurierte Domain). Beim ersten Aufruf landest du auf einer Sign-up-Seite, um dein Admin-Konto zu erstellen.

> **Warnung wegen selbstsigniertem Zertifikat.** Der TLS-Modus `selfsigned` erzeugt ein lokales Zertifikat, daher zeigt der Browser beim ersten Aufruf eine „Ihre Verbindung ist nicht privat“-Warnung. Klick dich durch (Chrome: **Erweitert → Weiter**, Firefox: **Erweitert → Risiko akzeptieren**). Für ein öffentliches Deployment wähle bei `tale init` `letsencrypt` oder folge dem [Produktions-Deployment](/de/self-hosted/install/linux-server)-Leitfaden.

## Täglicher Ablauf

### Starten und Stoppen

```bash
tale start              # Alle Dienste starten
tale start --detach     # Im Hintergrund starten
```

Um die Dienste zu stoppen, ohne Daten zu verlieren:

```bash
# Stoppt die Container, behält aber die Volumes (deine Daten).
# Niemals -v hinzufügen: das löscht Datenbank, Uploads und Crawler-Status — keine Wiederherstellung möglich.
docker compose -p tale-dev down
```

Das Flag `-p tale-dev` ist erforderlich, weil `tale start` ein Compose-Projekt namens `tale-dev` anlegt, statt eine Standard-`docker-compose.yml` zu verwenden.

### Upgrade

```bash
tale upgrade                       # Auf das neueste Release aktualisieren und Projektdateien synchronisieren
tale upgrade --version 0.9.0       # Auf eine bestimmte Version migrieren oder downgraden
tale start                         # Mit der neuen Version neu starten
```

Breaking Changes stehen in den [Release Notes](https://github.com/tale-project/tale/releases).

### Backend-Daten ansehen

```bash
tale convex admin       # Admin-Schlüssel für das Convex-Dashboard erzeugen
```

Öffne `/convex-dashboard` im Browser und füge den Schlüssel ein, um die Datenbank zu inspizieren, Function-Logs zu sehen und Hintergrundjobs zu verwalten.

## Alternative: aus Quellcode bauen

Wenn du zu Tale beitragen oder den Plattform-Code anpassen willst, kannst du statt der vorgebauten Images aus dem Quellcode starten.

```bash
git clone https://github.com/tale-project/tale.git
cd tale
cp .env.example .env
```

Bearbeite `.env` und ersetze die Beispielwerte:

| Variable                | Wie du sie setzt                                 |
| ----------------------- | ------------------------------------------------ |
| `BETTER_AUTH_SECRET`    | `openssl rand -base64 32`                        |
| `ENCRYPTION_SECRET_HEX` | `openssl rand -hex 32`                           |
| `DB_PASSWORD`           | Ein beliebiges Passwort für die lokale Datenbank |

> **Wichtig:** Die Datei `.env.example` enthält Platzhalter-Secrets, die vor dem Start ersetzt werden müssen.

Dann bauen und starten:

```bash
docker compose up --build
```

Für einen schnelleren Edit-Reload-Zyklus nutze den Development-Override, der deine lokalen Quellverzeichnisse in die Container mountet:

```bash
docker compose -f compose.yml -f compose.dev.yml up --build
```

Nach Änderungen an Dockerfiles oder Abhängigkeiten kannst du mit `bun run docker:test` einen Smoke-Test fahren. Der [Contributing-Docker-Guide](/de/develop/contributing-docker) beschreibt Image-Validierung und Vulnerability-Scan-Skripte.

## Wo das eingesetzt wird

Was du jetzt hast, ist eine Tale-Instanz, die unter `localhost` erreichbar ist, mit Beispiel-Agents, Beispiel-Wissen und einem funktionierenden KI-Anbieter. Das reicht, um das Produkt zu evaluieren, eine Demo zu fahren oder gegen die Plattform zu entwickeln — aber nicht, um es dem restlichen Team verfügbar zu machen, denn der Quickstart richtet selbstsigniertes TLS ein und betreibt alles in einem Container pro Dienst.

Wenn du bereit bist, Tale vor Nutzer zu stellen, führt [Produktions-Deployment](/de/self-hosted/install/linux-server) durch denselben Aufbau mit echter Domain, echtem TLS-Zertifikat und der Blue-Green-Topologie, die Upgrades ohne Wartungsfenster übersteht. Für die restliche Betriebsfläche — Observability, Backups, Aufbewahrung, Advisories — ist [Operations](/de/self-hosted/operate/observability/operations) der Einstieg.
