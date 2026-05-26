---
title: Entwickler
description: Der Sitz fürs Bauen und Integrieren — Agents, Automatisierungen, Integrationen, MCP-Server und API-Schlüssel. Die aufgabenorientierte Landung des Entwicklers für den Alltag.
---

Ein **Entwickler** in Tale ist der Sitz fürs Bauen und Integrieren. Du verdrahtest die Teile der Plattform, die alle anderen nutzen: die Agents, für die deine Redakteure Wissen kuratieren, die Automatisierungen, die im Hintergrund laufen, die Integrationen, die Tale mit anderen Systemen verbinden, und die API-Schlüssel, die Skripte und Webhooks von außen in Tale hineinrufen lassen. Alles, was ein Redakteur kann, kannst du auch; obendrein erstellst und veröffentlichst du Automatisierungen, konfigurierst Integrationen und MCP-Server und verwaltest API-Schlüssel. Du änderst keine Organisations-Einstellungen — Branding, Richtlinien, Anbieter, Mitglieder-Rollen — das ist Admin-Territorium.

Bauen in Tale ist meistens Komposition statt Code. Du entscheidest, was ein Agent wissen, was er können und wie er sich verhalten soll; Tale erledigt die Modell-Aufrufe, das Konversations-Gedächtnis, die Tool-Orchestrierung und die Lauf-Historie. Das Mental-Modell unten ist die kleine Menge an Bausteinen, die du komponierst. Die kanonische Berechtigungsmatrix lebt unter [Mitglieder und Rollen](/de/platform/admin/members-and-roles) — lies sie, wenn ein Tutorial an einer fehlenden Schaltfläche scheitert.

## Ein Entwickler-Tag

Ein typischer Entwickler-Tag startet in **Automatisierungen** mit einem Blick auf die nächtlichen Läufe — grün ist langweilig; rot ist das Erste, was du aus den Ausführungslogs triagierst. Von dort spaltet sich die Arbeit: Das Redakteurs-Team braucht einen Agent mit einem neuen Wissens-Filter und einem neuen Tool aktualisiert, und ein eingehender Webhook vom Support-System braucht einen neuen Automatisierungs-Schritt. Die Agent-Anpassung ist eine einzelne Bildschirm-Änderung in **Agents** und eine Veröffentlichung; der neue Schritt wird im Workflow-Editor hinzugefügt, in einem Trockenlauf getestet und hinter einem Feature-Flag ausgerollt. Spät am Nachmittag fragt ein Admin nach einer API-Schlüssel-Rotation; du erstellst den Ersatz-Schlüssel, tauschst ihn am externen Aufrufer und widerrufst den alten.

Die Seiten unten stehen in der Reihenfolge, die der Tag verlangt — Agents zuerst, weil die Frage meistens „Tut der Agent das Richtige?" lautet, dann Automatisierungen, weil die Frage zu „Und was läuft, wenn niemand zusieht?" wird, dann Wissen und Integrationen, weil die die Eingaben für beide sind.

## Seiten in diesem Bereich

- **[Agent-Konzepte](/de/platform/agents/concepts)** — die vier Bausteine jedes Agents (Anweisungen, Wissen, Tools, Modell) und die Abwägungen, die jeder Baustein benennt.
- **[Agent erstellen](/de/platform/agents/create)** — Schritt für Schritt von `Agents > Neu` zu einem veröffentlichten Agent, den der Rest des Teams im Chat wählen kann.
- **[Agent-Versionen](/de/platform/agents/versions)** — wie du an einem laufenden Agent arbeitest, ohne die Konversationen und Automatisierungen zu brechen, die ihn schon nutzen.
- **[Automatisierungs-Konzepte](/de/platform/automations/concepts)** — das Mental-Modell: Workflow, Schritt, Trigger, Lauf, Verzweigung, Schleife. Einmal lesen, wieder darauf zurückgreifen.
- **[Workflows](/de/platform/automations/workflows)** — der visuelle Editor, in dem Schritte hinzugefügt, verdrahtet und im Trockenlauf getestet werden.
- **[Trigger](/de/platform/automations/triggers)** — Zeitpläne, Webhooks, Ereignisse, manuelle Läufe; wie eine Automatisierung startet.
- **[Ausführungslogs](/de/platform/automations/execution-logs)** — Je-Lauf-Eingaben, -Ausgaben, Verzweigungs-Entscheidungen und Fehler; der Debugger, zu dem du greifst, wenn eine Automatisierung den falschen Weg ging.
- **[Strukturierte Daten](/de/platform/knowledge/structured-data)** — Produkte, Kunden, Lieferanten; die Zeilen, gegen die Agents grounden, wenn eine Antwort mehr als ein Dokument braucht.
- **[Website-Crawling](/de/platform/knowledge/crawling)** — Tale auf eine Website richten, Recrawls planen, dem Indexer beim Füllen der Wissensdatenbank zusehen.
- **[Integrationen — Übersicht](/de/platform/integrations/overview)** — REST, SQL, E-Mail, Microsoft 365; die Systeme, in denen die echten Daten leben.
- **[KI-Anbieter](/de/platform/admin/providers)** — Admin-eigen, hier verlinkt, weil die Modellauswahl jedes Agents aus diesem Katalog zieht.

## KI-unterstütztes Bauen

Jeder Baustein oben lässt sich auch aus JSON-Dateien in deinem Projektverzeichnis verfassen. Öffnest du das Projekt in einem KI-fähigen Editor (Claude Code, Cursor, GitHub Copilot, Windsurf), hat der Editor vollen Kontext über die Schemas und die Plattform-Fähigkeiten — beschreibe in normaler Sprache, was du willst, und der Editor erzeugt die Konfiguration. Bei komplexen Workflows oder Agent-Flotten ist das oft schneller als das UI. Siehe [KI-unterstützte Entwicklung](/de/develop/ai-assisted-development) für die Einrichtung.

## Wo das hingehört

Die Entwickler-Rolle ist der Sitz fürs Bauen und Integrieren. Dieselbe Person, die die Agents baut, die Redakteure kuratieren, verdrahtet auch die Integrationen, die die Agents aufrufen, die Automatisierungen, die im Hintergrund laufen, und die API-Schlüssel, die externe Systeme in Tale hineinrufen lassen. Für die kanonische Berechtigungsmatrix siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles); für übergreifende Arbeit (Tale aus einem Skript aufrufen, Webhooks empfangen) ist die Sektion [Entwickeln](/de/develop/api-reference) einen Tab weiter.
