---
title: Was du einrichten kannst
description: Orientierung für alle, die Agents und Automatisierungen bauen.
---

Wenn du Tale für dein Team konfigurierst, ist dieser Abschnitt für dich. "Einrichten" heisst, die Teile der Plattform aufzusetzen, die alle anderen benutzen — die Agents, mit denen sie chatten; die Automatisierungen, die im Hintergrund laufen; die Integrationen, die Tale mit euren anderen Systemen verbinden; und das Wissen, das die KI durchsuchen kann.

## Die Bausteine

### Agents

Ein Agent ist ein massgeschneiderter KI-Assistent. Du entscheidest über seinen System-Prompt, welches KI-Modell er nutzt, welches Wissen er durchsuchen kann, welche Tools er aufrufen darf und wie er sich verhalten soll. Stell dir einen Agent als benannte Rolle vor — "Customer Support", "Sales Research", "Legal Review" — jeder mit eigenen Regeln.

Siehe [Agent-Konzepte](/de/platform/agents/concepts) für das mentale Modell, [Agent erstellen](/de/platform/agents/create) für die Schritt-für-Schritt-Anleitung und [Agent-Versionen](/de/platform/agents/versions) für sicheres Iterieren an einem produktiven Agent.

### Automatisierungen

Eine Automatisierung ist ein mehrstufiger Workflow, der auf einen Trigger hin startet — einen Zeitplan, ein Ereignis, einen Webhook oder einen manuellen Start. Jeder Schritt tut genau eine Sache: eine API rufen, eine Datenbank abfragen, ein LLM fragen, abhängig von einer Bedingung verzweigen, über eine Liste iterieren. Automatisierungen übernehmen die Arbeit, die ohne Menschen im Chat stattfindet.

Siehe [Automatisierungs-Konzepte](/de/platform/automations/concepts) für das mentale Modell, [Workflows](/de/platform/automations/workflows) für den Editor, [Trigger](/de/platform/automations/triggers) für deren Starts und [Ausführungslogs](/de/platform/automations/execution-logs) zum Debuggen einzelner Läufe.

### Wissen

Die Wissensdatenbank ist das, was Agents durchsuchen, um Fragen zu beantworten. Du kannst Dokumente hochladen, Websites zum Crawlen angeben und strukturierte Datensätze (Produkte, Kunden, Lieferanten) importieren. Gut gepflegtes Wissen ist das, was die Antworten der KI nützlich macht.

Siehe [Strukturierte Daten](/de/platform/knowledge/structured-data) und [Website-Crawling](/de/platform/knowledge/crawling).

## Integrationen

Integrationen verbinden Tale mit den Systemen, in denen eure echten Daten liegen — REST-APIs, SQL-Datenbanken, E-Mail, Microsoft 365. Einmal konfiguriert, stehen Integrationen Agents als Tools und Automatisierungen als Action-Steps zur Verfügung.

Siehe [Integrationen – Überblick](/de/platform/integrations/overview) und [KI-Anbieter](/de/platform/admin/providers).

## Berechtigungen

Das Einrichten erfordert für Agents die **Redakteur**-Rolle und für Automatisierungen, Integrationen und API-Schlüssel die **Entwickler**-Rolle. Siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles) für die vollständige Berechtigungs-Matrix.

## KI-gestütztes Einrichten

Alle Bausteine lassen sich auch aus JSON-Dateien in deinem Projekt-Verzeichnis erstellen. Wenn du das Projekt in einem KI-Editor öffnest (Claude Code, Cursor, GitHub Copilot, Windsurf), kennt dieser die Schemas und Plattform-Fähigkeiten vollständig — du kannst in natürlicher Sprache beschreiben, was du willst, und die KI erzeugt die Konfiguration. Siehe [AI-assisted development](/de/develop/ai-assisted-development).
