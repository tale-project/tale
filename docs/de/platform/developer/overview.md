---
title: Was du einrichten kannst
description: Orientierung für alle, die Agents und Automatisierungen bauen.
---

Dieser Bereich ist für die Personen, die die Teile der Plattform aufsetzen, die der Rest des Teams benutzt — die Agents, mit denen alle chatten, die Automatisierungen, die im Hintergrund laufen, die Integrationen, die Tale mit anderen Systemen verbinden, und das Wissen, in dem sich Agents und Automatisierungen verankern. Wenn du einen **Entwickler**-Platz hast (oder einen **Redakteur**-Platz für Agent-Arbeit), sind die folgenden Seiten deine Referenz.

„Einrichten" in Tale ist überwiegend Komposition statt Code. Du entscheidest, was ein Agent wissen soll, was er tun darf und wie er sich verhält — Tale kümmert sich um Modellaufrufe, Konversationsgedächtnis, Tool-Orchestrierung und Lauf-Historie. Das mentale Modell unten ist das kleine Set von Bausteinen, das du komponierst.

## Die Bausteine

### Agents

Ein Agent ist ein massgeschneiderter KI-Assistent. Du entscheidest über seinen System-Prompt, welches KI-Modell er nutzt, welches Wissen er durchsuchen kann, welche Tools er aufrufen darf und wie er sich verhalten soll. Stell dir einen Agent als benannte Rolle vor — `Customer Support`, `Vertriebs-Recherche`, `Legal Review` — jeder mit eigenen Regeln, verfügbar in Chat, Automatisierungen und der API.

Siehe [Agent-Konzepte](/de/platform/agents/concepts) für das mentale Modell, [Agent erstellen](/de/platform/agents/create) für die Schritt-für-Schritt-Anleitung und [Agent-Versionen](/de/platform/agents/versions) für sicheres Iterieren an einem produktiven Agent.

### Automatisierungen

Eine Automatisierung ist ein mehrstufiger Workflow, der auf einen Trigger hin startet — einen Zeitplan, ein Ereignis, einen Webhook oder einen manuellen Start. Jeder Schritt tut genau eine Sache: eine API rufen, eine Datenbank abfragen, ein LLM fragen, abhängig von einer Bedingung verzweigen, über eine Liste iterieren. Automatisierungen übernehmen die Arbeit, die ohne Menschen im Chat stattfinden muss — nächtliche Importe, eingehende Webhook-Fan-Outs, geplante Zusammenfassungen.

Siehe [Automatisierungs-Konzepte](/de/platform/automations/concepts) für das mentale Modell, [Workflows](/de/platform/automations/workflows) für den Editor, [Trigger](/de/platform/automations/triggers) für deren Starts und [Ausführungslogs](/de/platform/automations/execution-logs) zum Debuggen einzelner Läufe.

### Wissen

Die Wissensdatenbank ist das, was Agents durchsuchen, um Fragen zu beantworten. Du lädst Dokumente hoch, zeigst auf Websites zum Crawlen und importierst strukturierte Datensätze — Produkte, Kunden, Lieferanten. Gut gepflegtes Wissen macht aus einem Agent, der halluziniert, einen Agent, der zitiert.

Siehe [Strukturierte Daten](/de/platform/knowledge/structured-data) und [Website-Crawling](/de/platform/knowledge/crawling).

### Integrationen

Integrationen verbinden Tale mit den Systemen, in denen eure echten Daten liegen — REST-APIs, SQL-Datenbanken, E-Mail-Anbieter, Microsoft 365. Einmal konfiguriert, stehen Integrationen Agents als Tools und Automatisierungen als Action-Steps zur Verfügung. Der Unterschied zwischen einem Agent, der generische Ratschläge gibt, und einem Agent, der ein Ticket in eurem Support-Tool aktualisiert, ist eine Integration.

Siehe [Integrationen – Überblick](/de/platform/integrations/overview) und [KI-Anbieter](/de/platform/admin/providers).

## Berechtigungen

Das Einrichten erfordert für Agents die **Redakteur**-Rolle und für Automatisierungen, Integrationen und API-Schlüssel die **Entwickler**-Rolle. Die vollständige Rechtematrix steht unter [Mitglieder und Rollen](/de/platform/admin/members-and-roles); wenn ein Tutorial an einem fehlenden Button scheitert, ist die Rolle das erste, was du prüfst.

## KI-gestütztes Einrichten

Alle Bausteine oben lassen sich auch aus JSON-Dateien in deinem Projekt-Verzeichnis erstellen. Wenn du das Projekt in einem KI-Editor öffnest (Claude Code, Cursor, GitHub Copilot, Windsurf), kennt dieser die Schemas und Plattform-Fähigkeiten vollständig — du beschreibst in natürlicher Sprache, was du willst, und der Editor erzeugt die Konfiguration. Bei komplexen Workflows oder Flotten von Agents ist das meist schneller als die UI. Siehe [AI-assisted development](/de/develop/ai-assisted-development).
