---
title: Erste Schritte
description: Installiere Tale und öffne die App — eine freundliche Anleitung für deine ersten 10 Minuten.
---

Das hier ist der schnellste Weg, von Null zu einer laufenden Tale-Instanz zu kommen. Du musst kein Entwickler sein — wenn du einen Befehl im Terminal ausführen kannst, kommst du mit. Für selbst gehostete Produktions-Setups siehe stattdessen [Produktions-Deployment](/de/self-hosted/install/linux-server).

## Voraussetzungen

| Software       | Mindestversion | Bezugsquelle                                   |
| -------------- | -------------- | ---------------------------------------------- |
| Docker Desktop | 24.0+          | https://www.docker.com/products/docker-desktop |

### API-Schlüssel besorgen

Tale nutzt standardmäßig OpenRouter als KI-Gateway, das dir über einen einzigen API-Schlüssel Zugriff auf Hunderte von Modellen gibt.

1. Gehe auf https://openrouter.ai und erstelle ein kostenloses Konto.
2. Navigiere in deinem Kontomenü zu Keys und erstelle einen neuen API-Schlüssel.
3. Kopiere den Schlüssel. Du brauchst ihn während der Einrichtung.

> **Tipp:** Du kannst jeden OpenAI-kompatiblen Anbieter nutzen, auch eine lokale Ollama-Instanz. OpenRouter ist wegen der Modellvielfalt und einfachen Preisgestaltung der empfohlene Standard.

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

Oder lade die Binary direkt von [GitHub Releases](https://github.com/tale-project/tale/releases):

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

> **Tipp:** Die CLI erzeugt außerdem Konfigurationsdateien für KI-Editoren (Claude Code, Cursor, GitHub Copilot, Windsurf) und extrahiert den vollständigen Plattform-Quellcode nach `.tale/reference/`. Öffne dein Projekt in einem dieser Editoren, um Agents, Workflows und Integrationen in natürlicher Sprache zu erstellen und zu bearbeiten. Siehe [AI-assisted development](/de/develop/ai-assisted-development).

### Schritt 3: Tale starten

```bash
tale start
```

Warte auf die Ready-Meldung:

```text
Tale Dev v0.x.x  Ready.
```

> **Hinweis:** Die Versionsnummer variiert. Während die Dienste starten, siehst du einen Strom von Health-Check-Meldungen. Das ist normal. Warte auf die "Ready"-Meldung, bevor du den Browser öffnest.

### Schritt 4: App öffnen

Gehe in deinem Browser auf https://localhost (oder deine konfigurierte Domain). Beim ersten Öffnen wirst du zu einer Sign-up-Seite geleitet, wo du dein Admin-Konto erstellst.

## Täglicher Ablauf

### Starten und Stoppen

```bash
tale start              # Alle Dienste starten
tale start --detach     # Im Hintergrund starten
```

Um alle Dienste zu stoppen, aber die Daten zu behalten:

```bash
docker compose -p tale-dev down
```

Das Flag `-p tale-dev` ist erforderlich, weil `tale start` ein Compose-Projekt namens `tale-dev` anlegt, statt eine Standard-`docker-compose.yml` zu verwenden.

> **Wichtig:** Führe niemals `docker compose -p tale-dev down -v` aus. Das Flag `-v` löscht alle Docker-Volumes, was Datenbank, hochgeladene Dokumente, Crawler-Status und sämtliche Plattformdaten unwiderruflich vernichtet.

### Upgrade

```bash
tale upgrade            # CLI upgraden und Projektdateien synchronisieren
```

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

Bearbeite `.env` und fülle die erforderlichen Werte aus:

| Variable                | Wie du sie setzt                                 |
| ----------------------- | ------------------------------------------------ |
| `BETTER_AUTH_SECRET`    | Erzeugen mit: `openssl rand -base64 32`          |
| `ENCRYPTION_SECRET_HEX` | Erzeugen mit: `openssl rand -hex 32`             |
| `DB_PASSWORD`           | Ein beliebiges Passwort für die lokale Datenbank |

> **Wichtig:** Die Datei `.env.example` enthält Beispiel-Secrets, die vor dem Start ersetzt werden müssen.

Dann bauen und starten:

```bash
docker compose up --build
```

Die Build-Zeiten variieren je nach Dienst (alle 5 Dienste bauen parallel in ca. 3 Minuten auf einem modernen System). Folgende Builds sind dank Docker-Layer-Caching deutlich schneller.

### Lokale Entwicklung mit Hot-Reload

Für einen schnelleren Edit-Reload-Zyklus während der Entwicklung nutze den Development-Override:

```bash
docker compose -f compose.yml -f compose.dev.yml up --build
```

Dadurch werden deine lokalen Quellverzeichnisse in die Container gemountet, sodass Änderungen sofort sichtbar sind, ohne dass Images neu gebaut werden.

### Container-Tests ausführen

Nachdem du Dockerfiles oder Abhängigkeiten geändert hast, prüfe deine Änderungen:

```bash
# Smoke Test: bauen, starten, Health Check, abbauen
bun run docker:test

# Image-Validierung: OCI-Labels, Secrets, Größen-Budgets
bun run docker:test:image

# Vulnerability Scan (benötigt Trivy)
bun run docker:test:vulnerability
```

Weitere Details siehe [Contributing Docker guide](/de/develop/contributing-docker).
