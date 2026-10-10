---
title: Den Weg zur Automatisierung wählen
description: Ändere Workflows direkt im visuellen Editor oder lass deinen Coding-Agent Automatisierungen über den MCP-Endpoint von Tale bearbeiten.
---

Ändere die Felder einer Automatisierung direkt im Editor oder lass deinen Coding-Agent sie über den MCP-Endpoint von Tale erstellen und ändern. Einen KI-Assistenten im Editor gibt es nicht: Mit KI arbeitest du an Automatisierungen über einen Coding-Agent wie Claude Code oder Codex, den du mit deinem API-Schlüssel verbindest. Beide Wege speichern Versionen desselben Workflows und nutzen dieselben Prüf- und Bereitstellungsregeln. Automatisierungen erstellen und live schalten dürfen Inhaber, Admins und Entwickler.

## Eine Änderung im Editor vornehmen

Öffne **Automatisierungen** und wähle den Workflow. Wähle eine Node, um Eingabe, Modell, Code oder andere Einstellungen zu prüfen, und ändere das Feld, das du brauchst. Speichere die Änderung mit einer Versionsnachricht, führe einen Test aus und stelle nach bestandenen Prüfungen die gewünschte Version bereit. Der Canvas ordnet sich anhand der Referenzen zwischen den Nodes selbst an; du fügst darin keine Nodes hinzu und zeichnest keine Verbindungen.

<Frame caption="Eine ausgewählte Node zeigt ihre Konfiguration neben dem Workflow-Graphen.">

![Der Automatisierungs-Editor zeigt den Workflow zwischen Start und Ende und die Felder der ausgewählten Node in einer Seitenleiste.](/images/platform/automation-editor-canvas.webp)

</Frame>

[Der Workflow-Editor](/de/platform/automations/editor) erklärt diese Schritte, das Lesen des Canvas, die Prüfung eines Laufs und die Rückkehr zu einer früheren Version. Der Canvas enthält keinen Chat-Assistenten.

## Mit deinem Coding-Agent ändern

Der Weg dorthin ist **Mit deinem Coding-Agent bearbeiten**, die letzte Schaltfläche oben rechts im Canvas des Editors. Ihr Dialog zeigt den Namen der Automatisierung, den du dem Agent gibst, **MCP einrichten**, das **Einstellungen > API > MCP** öffnet, und einen Link zur Anleitung, mit der du einen Coding-Agent verbindest. Verbinde deinen Coding-Agent mit dem Endpoint unter **Einstellungen > API > MCP** und deinem persönlichen API-Schlüssel; fertige Konfigurationen findest du unter [Tale aus deinem Editor oder einem Skript nutzen](/de/develop/use-tale-from-your-editor). Sag ihm, was die Automatisierung entgegennehmen und liefern soll und welche Systeme sie verändern darf. Lass ihn die vorhandenen Automatisierungen und das, was deine Organisation hat, ansehen, bevor er eine weitere erstellt.

Dein Agent arbeitet an einer Automatisierung so, wie du es im Editor tust. Er liest die Referenz und die aktuelle Version, validiert seine Änderung, führt sie mit den Mocks aus und lässt die Tests der Automatisierung laufen. Dann speichert er eine neue Version und nennt dabei die Version, von der er ausgegangen ist. Hat inzwischen jemand eine neuere Version gespeichert, lehnt Tale das Speichern ab; der Agent liest dann diese Version und führt seine Änderung zuerst zusammen. Startet er eine gespeicherte Version mit den Mocks, erscheint der Lauf im Tab **Läufe** der Automatisierung als **Test**-Lauf mit **Von dir gestartet (API)**, sodass du öffnen kannst, was er ausgeführt hat. Eine Version, die der Agent speichert, erscheint im Canvas, während du die Automatisierung ansiehst.

Speichern erstellt eine Version, schaltet sie aber nicht live. Bevor dein Agent live schaltet, löscht, einen Trigger setzt oder eine Automatisierung in Projekten installiert, fragt dich ein Client wie Claude Code, der Tales Kennzeichnung dieser Tools beachtet, um dein Ja – selbst wenn du den Agent andere Tools ohne Rückfrage ausführen lässt. Prüfe die Version und ihre Testergebnisse, bevor du zustimmst. Jede Änderung deines Agents steht im [Audit-Log](/de/platform/admin/governance/audit-logs) mit **Quelle** Coding-Agent, und der [MCP-Endpoint](/de/develop/mcp-endpoint) listet jedes Tool, das er nutzen kann.

## Entscheidungen während eines Laufs unterscheiden

Ein Agentenknoten arbeitet während eines Laufs einer Automatisierung. Er ist nicht der Coding-Agent, mit dem du den Workflow schreibst. Ebenso erlaubt eine [Genehmigung](/de/platform/approvals/concepts) eine ausstehende Operation während der Ausführung und keine vorgeschlagene Änderung an der Workflow-Definition. Dein Coding-Agent entscheidet nie über eine Genehmigung: Braucht ein Lauf, den er gestartet hat, eine Genehmigung, wartet er, bis eine Person in Tale entscheidet.

Nutze [den Editor](/de/platform/automations/editor) für direkte Änderungen oder [MCP](/de/develop/mcp-endpoint) für deinen eigenen Client. Beginne mit [einer vorhandenen Automatisierung](/de/platform/automations/catalog), wenn bereits eine passende verfügbar ist.
