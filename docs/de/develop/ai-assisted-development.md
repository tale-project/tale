---
title: KI-gestützte Entwicklung
description: Mit KI-Editoren Agents, Workflows und Integrationen mit voller Plattform-Kenntnis erstellen und bearbeiten.
---

Wenn du `tale init` ausführst, erzeugt die CLI Konfigurationsdateien, mit denen KI-gestützte Code-Editoren Tales Projektstruktur, Schemas und Plattform-Quellcode kennen. Du kannst so Agents, Workflows und Integrationen in natürlicher Sprache erstellen und bearbeiten.

## Was erzeugt wird

| Datei                             | Zweck                                         | Editor         |
| --------------------------------- | --------------------------------------------- | -------------- |
| `CLAUDE.md`                       | Projekt-Regeln und Kontext                    | Claude Code    |
| `.cursor/rules/tale.mdc`          | Projekt-Regeln mit glob-basiertem Frontmatter | Cursor         |
| `.github/copilot-instructions.md` | Projekt-Regeln                                | GitHub Copilot |
| `.windsurfrules`                  | Projekt-Regeln                                | Windsurf       |
| `.tale/reference/`                | vollständiger Plattform-Quellcode (read-only) | alle oben      |

Die Regel-Dateien enthalten denselben Kerninhalt: Projektstruktur, Konfigurations-Konventionen und Anweisungen, vor Änderungen `.tale/reference/` zu konsultieren. Das Reference-Verzeichnis enthält den kompletten Backend-Quellcode — Datenbankschemas, Validatoren, Agent-Tools, Workflow-Schritttypen und Integrationen-Connectors. Damit hat die KI alles, was sie braucht, um korrekte Konfigurationen zu erzeugen.

## Benutzung

1. Erstelle ein Projekt mit `tale init my-project` (oder führe `tale upgrade` in einem bestehenden Projekt aus, um die Dateien neu zu erzeugen).
2. Öffne das Projektverzeichnis in deinem KI-Editor.
3. Der Editor liest seine Regel-Datei automatisch ein und bekommt vollständigen Plattform-Kontext.
4. Bitte die KI, Konfigurationen anzulegen oder zu ändern. Zum Beispiel:
   - "Erstelle einen Agent, der dem Sales-Team Produktdetails und Kundenhistorie nachschlägt."
   - "Füge einen Workflow hinzu, der jeden Morgen nach überfälligen Rechnungen sucht und eine Zusammenfassung an Slack sendet."
   - "Erstelle eine REST-API-Integration für unseren internen Service auf api.example.com mit OAuth2-Authentifizierung."
   - "Gib dem CRM-Assistenten-Agent zusätzlich Zugriff auf das `Document-Search`-Tool."
5. Die KI liest den Reference-Quellcode, versteht gültige Schemas und Beziehungen und erzeugt korrekte JSON-Konfigurationsdateien.
6. Änderungen an `agents/`, `workflows/`, `integrations/` und `branding/` werden von der Plattform live nachgeladen.

## Unterstützte Editoren

Tale erzeugt Konfigurationsdateien für Claude Code, Cursor, GitHub Copilot und Windsurf. Jeder Editor, der eines dieser Formate liest, funktioniert. Für andere Tools kann die `CLAUDE.md` im Projekt-Root als allgemeine Referenz dienen.

## Regeln aktuell halten

Regel-Dateien und das Reference-Verzeichnis sind in die CLI-Binary gebündelt. Führe `tale upgrade` aus, um die neueste CLI zu laden und alle Projektdateien neu zu erzeugen:

```bash
tale upgrade
```

Bearbeite diese Dateien nicht manuell, da sie beim Upgrade überschrieben werden.

## Wo das einsetzt

KI-gestützte Entwicklung ist der datei-basierte Autoren-Pfad für Agents, Automatisierungen, Integrationen und Branding. Sie existiert, weil die JSON-Form hinter jedem UI-Bildschirm auch die Form ist, die ein KI-Editor aus einer natürlichsprachigen Beschreibung erzeugen kann — und für eine Flotte von Agents ist das schneller als jeden einzeln in der UI zu bauen. Für den kanonischen UI-Bau-Flow ist [Agent erstellen](/de/platform/agents/create) der Einstiegspunkt; für das Konnektor-Schema speziell ist [Integration bauen](/de/develop/integrations) die nächste Seite.
