---
title: Ausführungslogs
description: Vergangene Workflow-Runs untersuchen, Fehler debuggen und mit Anpassungen neu laufen lassen.
---

Der **Ausführungen**-Tab jedes Workflows listet jeden Lauf — ob per Zeitplan, Event, Webhook oder manuell gestartet — mit Zeitstempeln, Dauer, Endstatus und Schritt-für-Schritt-Details.

## Was ein Ausführungs-Datensatz zeigt

Klicke in der **Ausführungen**-Tabelle auf eine Zeile, um das Detail-Panel zu öffnen:

- **Übersicht** — Trigger-Typ, Start- und Endzeit, Dauer, Endstatus und das vollständige Input-Payload.
- **Schritte** — jeder Schritt mit Status (erfolgreich, fehlgeschlagen, übersprungen), Input, Output, Dauer und etwaiger Fehlermeldung.
- **Variablen** — die Workflow-Variablen zum Zeitpunkt des Laufs (hilfreich, falls du sie seither geändert hast).
- **Roh** — die JSON-Trace des gesamten Laufs, per Kopier-Button exportierbar.

Fehlgeschlagene Schritte sind standardmässig aufgeklappt, damit du den Fehler ohne Klick siehst.

## Filtern und Suchen

Die **Ausführungen**-Tabelle unterstützt:

- **Status-Filter** — erfolgreich, fehlgeschlagen, laufend, abgebrochen.
- **Zeitbereich** — letzte Stunde, letzte 24 Stunden, letzte 7 Tage, benutzerdefiniert.
- **Trigger-Filter** — Zeitplan, Event, Webhook, manuell.
- **Textsuche** — über Trigger-Namen, Fehlermeldungen und Schritt-Inputs/Outputs.

## Neu starten

Aus dem Detail-Panel einer Ausführung kannst du:

- **Mit gleichem Input erneut ausführen** — eine neue Ausführung mit demselben Input starten. Nützlich, wenn sich der Workflow geändert hat und du einen vergangenen Request erneut durchspielen willst.
- **Mit anderem Input erneut ausführen** — das Input-Payload vor dem erneuten Lauf bearbeiten. Nützlich für das Debuggen von Edge Cases.

Erneute Läufe erscheinen als neue Ausführungen — der Originalsatz bleibt erhalten.

## Aufbewahrung

Ausführungs-Datensätze werden gemäss der [Aufbewahrungsrichtlinie](/de/platform/admin/governance) deiner Organisation aufbewahrt. Standardmässig bleiben Schritt-Details 90 Tage erhalten, Zusammenfassungs-Datensätze ein Jahr.

## Alarme

Konfiguriere Alarme im **Alarme**-Tab des Workflows, damit ein Admin per E-Mail benachrichtigt wird, wenn ein Workflow fehlschlägt, länger als ein Schwellwert läuft oder einen Fehler erzeugt, der einem Muster entspricht. Für Workflow-übergreifende Alarme (z. B. "mehr als 5 Fehlschläge pro Stunde über alle Workflows") nutze [Operations](/de/self-hosted/operate/observability/operations).
