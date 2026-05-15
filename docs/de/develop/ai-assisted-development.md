---
title: KI-gestützte Entwicklung
description: Mit KI-Editoren Agents, Workflows und Integrationen mit voller Plattform-Kenntnis erstellen.
---

Die CLI-Befehle `tale init` und `tale upgrade` erzeugen Editor-Konfigurationsdateien, die KI-Editoren — Claude Code, Cursor, GitHub Copilot, Windsurf — über Tales Projektstruktur, Schemas und Plattform-Quellcode informieren. Mit diesen Dateien an Ort und Stelle kannst du einen Agent, einen Workflow oder eine Integration in natürlicher Sprache beschreiben, und der Editor produziert eine Konfiguration, die zum Schema passt. Diese Seite richtet sich an Source-Contributors und Entwickler mit dateibasiertem Authoring-Workflow; Nutzer, die über die Plattform-UI bearbeiten, brauchen nichts davon.

Das Ergebnis eines einzelnen `tale init`-Laufs ist ein Projektverzeichnis, das jeder der genannten Editoren mit vollem Kontext öffnen kann: die Schemas, die Validatoren, die Connector-Tool-Oberfläche und die Beispiel-Bibliothek liegen alle unter `.tale/reference/`.

## Was `tale init` generiert

Ein per Scaffolding aufgesetztes Projekt liefert eine Editor-Regel-Datei pro unterstütztem Editor und ein read-only Referenzverzeichnis, das der Editor durchsuchen kann:

| Datei                             | Zweck                                        | Editor         |
| --------------------------------- | -------------------------------------------- | -------------- |
| `CLAUDE.md`                       | Projektregeln und Kontext                    | Claude Code    |
| `.cursor/rules/tale.mdc`          | Projektregeln mit Glob-basiertem Frontmatter | Cursor         |
| `.github/copilot-instructions.md` | Projektregeln                                | GitHub Copilot |
| `.windsurfrules`                  | Projektregeln                                | Windsurf       |
| `.tale/reference/`                | Voller Plattform-Quellcode (read-only)       | alle obigen    |

Die vier Regel-Dateien tragen denselben Kerninhalt — Projektstruktur, Konfigurations-Konventionen, eine Anweisung, `.tale/reference/` zu konsultieren, bevor etwas generiert wird — im bevorzugten Format jedes Editors. Das Referenzverzeichnis enthält die Backend-Implementierung: Datenbankschemas, Validatoren, Agent-Tool-Definitionen, Workflow-Schritttypen und Connector-Verträge. Das ist alles, was der Editor braucht, um eine korrekte Konfiguration zu produzieren, ohne zu raten.

## So nutzt du es

Der Workflow ist über jeden Editor hinweg derselbe:

1. Erstelle oder aktualisiere das Projekt: `tale init <project-name>` für einen frischen Baum, `tale upgrade`, um die Regel-Dateien in einem bestehenden zu regenerieren.
2. Öffne das Projekt im KI-Editor deiner Wahl. Der Editor liest die Regel-Datei automatisch.
3. Beschreibe in einfacher Sprache, was du willst. Der Editor liest die Schemas aus `.tale/reference/` und schreibt die passenden Konfigurationsdateien.
4. Speichern. Die Tale-Plattform lädt `agents/`, `workflows/`, `integrations/` und `branding/` live nach — es gibt keinen separaten Deploy-Schritt.

Ein paar Prompts, die in der Praxis funktionieren:

```text
Erstelle einen Agent, der dem Sales-Team hilft, Produktdetails und Kundenhistorie nachzuschlagen.
```

```text
Füge einen Workflow hinzu, der jeden Morgen läuft, überfällige Rechnungen prüft und eine Zusammenfassung an Slack postet.
```

```text
Erstelle eine REST-API-Integration für unseren internen Dienst auf api.example.com mit OAuth2-Authentifizierung.
```

```text
Aktualisiere den CRM-Assistant-Agent so, dass er auch Zugriff auf das Dokumentsuch-Tool hat.
```

Der Editor generiert das JSON, du prüfst es, die Plattform wendet es an.

## Regeln und Referenz aktuell halten

Die Regel-Dateien und das Referenzverzeichnis sind ins CLI-Binary gebündelt, also produziert eine veraltete CLI veraltete Regeln. Führe `tale upgrade` regelmäßig aus:

```bash
tale upgrade
```

Das Upgrade schreibt jede generierte Datei neu. Bearbeite sie nicht von Hand — lokale Änderungen werden beim nächsten Upgrade überschrieben. Muss eine Regel projektweit geändert werden (eine eigene Konvention, ein Hausstil), reiche die Änderung gegen die CLI selbst ein, statt die generierte Datei zu patchen.

## Wo das einsetzt

KI-gestützte Entwicklung ist der dateibasierte Authoring-Pfad für Agents, Automatisierungen, Integrationen und Branding. Er existiert, weil die JSON-Form, die jede UI-Seite stützt, auch die Form ist, die ein KI-Editor aus einer Klartextbeschreibung generieren kann — für eine Flotte von Agents ist das schneller als jeden einzeln in der UI zu bauen.

Für den kanonischen UI-Build-Pfad ohne Code-Editor ist [Den ersten Agent end-to-end bauen](/de/tutorials/editor/first-agent-end-to-end) der Einstieg. Für die Connector-Authoring-Oberfläche, neben der diese Seite sitzt, ist [Eine Integration bauen](/de/develop/integrations) die Referenz.
