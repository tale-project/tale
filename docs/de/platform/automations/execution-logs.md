---
title: Ausführungslogs
description: Vergangene Workflow-Runs untersuchen, Fehler debuggen und mit Anpassungen neu laufen lassen.
---

Der Executions-Tab jedes Workflows listet jeden Run — ob per Zeitplan, Event, Webhook oder manuell gestartet — mit Zeitstempeln, Dauer, Endstatus und Schritt-für-Schritt-Details.

## Was ein Execution-Datensatz zeigt

Klicke in der Executions-Tabelle auf eine Zeile, um das Detail-Panel zu öffnen:

- **Overview** — Trigger-Typ, Start- und Endzeit, Dauer, Endstatus und das vollständige Input-Payload.
- **Steps** — jeder Schritt mit Status (erfolgreich, fehlgeschlagen, übersprungen), Input, Output, Dauer und etwaiger Fehlermeldung.
- **Variables** — die Workflow-Variablen zum Zeitpunkt des Runs (hilfreich, falls du sie seither geändert hast).
- **Raw** — die JSON-Trace des gesamten Runs, per Copy-Button exportierbar.

Fehlgeschlagene Schritte sind standardmäßig aufgeklappt, damit du den Fehler ohne Klick siehst.

## Filtern und Suchen

Die Executions-Tabelle unterstützt:

- **Status-Filter** — erfolgreich, fehlgeschlagen, laufend, abgebrochen.
- **Zeitbereich** — letzte Stunde, letzte 24 Stunden, letzte 7 Tage, benutzerdefiniert.
- **Trigger-Filter** — Zeitplan, Event, Webhook, manuell.
- **Textsuche** — über Trigger-Namen, Fehlermeldungen und Schritt-Inputs/Outputs.

## Neu starten

Aus dem Detail-Panel einer Execution kannst du:

- **Rerun with same input** — eine neue Execution mit demselben Input starten. Nützlich, wenn sich der Workflow geändert hat und du einen vergangenen Request erneut durchspielen willst.
- **Rerun with different input** — das Input-Payload vor dem Rerun bearbeiten. Nützlich für das Debuggen von Edge Cases.

Reruns erscheinen als neue Executions — der Originalsatz bleibt erhalten.

## Aufbewahrung

Execution-Datensätze werden gemäß der [Retention-Richtlinie](/de/platform/admin/governance) deiner Organisation aufbewahrt. Standardmäßig bleiben Schritt-Details 90 Tage erhalten, Summary-Datensätze ein Jahr.

## Alarme

Konfiguriere Alarme im Alerts-Tab des Workflows, damit ein Admin per E-Mail benachrichtigt wird, wenn ein Workflow fehlschlägt, länger als ein Schwellwert läuft oder einen Fehler erzeugt, der einem Muster entspricht. Für Workflow-übergreifende Alarme (z. B. "mehr als 5 Fehlschläge pro Stunde über alle Workflows") nutze [Operations](/de/self-hosted/operate/observability/operations).
