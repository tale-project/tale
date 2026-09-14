---
title: Den Weg zur Automation wählen
description: Bearbeite Workflows direkt im visuellen Editor oder verbinde einen externen Assistenten über MCP mit Tale.
---

Bearbeite eine Automation direkt auf ihrer Arbeitsfläche oder verbinde einen externen Assistenten über MCP mit den Werkzeugen von Tale. Beide Wege speichern Versionen desselben Workflows und nutzen dieselben Prüf- und Bereitstellungsregeln. Zum Erstellen und Bereitstellen brauchst du Entwicklerrechte.

## Eine Änderung im visuellen Editor vornehmen

Öffne **Automatisierungen** und wähle den Workflow. Klicke auf einen Knoten, um Eingaben, Modell, Code oder andere Einstellungen zu prüfen. Speichere die Änderung mit einer Versionsnachricht, führe einen Test aus und stelle nach bestandenen Prüfungen die gewünschte Version bereit.

<Frame caption="Ein ausgewählter Knoten zeigt seine Konfiguration neben dem Workflow-Graphen.">

![Der Automation-Editor zeigt den Workflow-Graphen und die Eingabefelder des ausgewählten Knotens in einer Seitenleiste.](/images/platform/automation-editor-canvas.webp)

</Frame>

[Der Workflow-Editor](/de/platform/automations/editor) erklärt diese Schritte, die Prüfung eines Laufs und die Rückkehr zu einer früheren Version. Die Arbeitsfläche enthält keinen Chat-Assistenten.

## Einen externen Assistenten über MCP nutzen

Richte deinen Client mit dem Endpunkt unter **Einstellungen > API > MCP** und einem passenden Organisations-API-Schlüssel ein. Beschreibe Eingaben, gewünschte Ausgabe und die Systeme, die der Workflow verändern darf. Lass den Client vorhandene Automationen und Funktionen prüfen, bevor er eine weitere erstellt.

Der [MCP-Endpunkt](/de/develop/mcp-endpoint) bietet Tools für Dokumentation, Validierung, Speichern, Testen und Bereitstellen. Prüfe den entstandenen Workflow und die Testergebnisse vor der Bereitstellung. Ein Speichervorgang erstellt eine Version, schaltet sie aber nicht live.

## Entscheidungen während eines Laufs unterscheiden

Ein Agentenknoten arbeitet während eines Automation-Laufs. Er ist nicht der Client, mit dem du den Workflow schreibst. Ebenso genehmigt eine [Freigabe](/de/platform/approvals/concepts) eine ausstehende Operation während der Ausführung und keine vorgeschlagene Änderung an der Workflow-Definition.

Nutze [den Editor](/de/platform/automations/editor) für direkte Änderungen oder [MCP](/de/develop/mcp-endpoint) für deinen eigenen Client. Beginne mit [einer vorhandenen Automation](/de/platform/automations/catalog), wenn bereits eine passende verfügbar ist.
