---
title: Den Weg zur Automatisierung wählen
description: Ändere Felder einer Automatisierung im Editor, oder lass einen Coding-Agent sie über MCP erstellen und ändern.
---

Ändere die Felder einer Automatisierung direkt im Editor, oder lass einen Coding-Agent wie Claude Code, Codex oder Cursor sie über MCP erstellen und ändern. Beide Wege speichern Versionen desselben Workflows und nutzen dieselben Prüf- und Bereitstellungsregeln. Zum Erstellen und Bereitstellen brauchst du Entwicklerrechte.

## Eine Änderung im Editor vornehmen

Öffne **Automatisierungen** und wähle den Workflow. Wähle eine Node, um Eingabe, Modell, Code oder andere Einstellungen zu prüfen, und ändere das Feld, das du brauchst. Speichere die Änderung mit einer Versionsnachricht, führe einen Test aus und stelle nach bestandenen Prüfungen die gewünschte Version bereit. Der Canvas ordnet sich anhand der Referenzen zwischen den Nodes selbst an; du fügst darin keine Nodes hinzu und zeichnest keine Verbindungen.

<Frame caption="Eine ausgewählte Node zeigt ihre Konfiguration neben dem Workflow-Graphen.">

![Der Automatisierungs-Editor zeigt den Workflow zwischen Start und Ende und die Felder der ausgewählten Node in einer Seitenleiste.](/images/platform/automation-editor-canvas.webp)

</Frame>

[Der Workflow-Editor](/de/platform/automations/editor) erklärt diese Schritte, das Lesen des Canvas, die Prüfung eines Laufs und die Rückkehr zu einer früheren Version. Der Canvas enthält keinen Chat-Assistenten.

## Mit deinem Coding-Agent ändern

Der Weg dorthin ist **Mit deinem Coding-Agent bearbeiten**, die letzte Schaltfläche oben rechts im Canvas des Editors. Ihr Dialog zeigt den Namen der Automatisierung, den du dem Agent gibst, **MCP einrichten**, das **Einstellungen > API > MCP** öffnet, und einen Link zur Anleitung, mit der du einen Coding-Agent verbindest. Richte deinen Client mit diesem Endpunkt und einem passenden Organisations-API-Schlüssel ein. Beschreibe Eingaben, gewünschte Ausgabe und die Systeme, die der Workflow verändern darf, und lass den Agent vorhandene Automatisierungen und Funktionen prüfen, bevor er eine weitere erstellt.

Der [MCP-Endpoint](/de/develop/mcp-endpoint) bietet Tools für Dokumentation, Validierung, Speichern, Testen und Bereitstellen. Eine Version, die der Agent speichert, erscheint im Canvas, während du die Automatisierung ansiehst. Prüfe den entstandenen Workflow und die Testergebnisse vor der Bereitstellung. Ein Speichervorgang erstellt eine Version, schaltet sie aber nicht live.

## Entscheidungen während eines Laufs unterscheiden

Eine Agent-Node arbeitet während eines Laufs der Automatisierung. Sie ist nicht der Coding-Agent, mit dem du den Workflow schreibst. Ebenso genehmigt eine [Freigabe](/de/platform/approvals/concepts) eine ausstehende Operation während der Ausführung und keine vorgeschlagene Änderung an der Workflow-Definition.

Nutze [den Editor](/de/platform/automations/editor) für direkte Änderungen oder [MCP](/de/develop/mcp-endpoint) für die Arbeit mit deinem Coding-Agent. Beginne mit [einer vorhandenen Automatisierung](/de/platform/automations/catalog), wenn bereits eine passende verfügbar ist.
