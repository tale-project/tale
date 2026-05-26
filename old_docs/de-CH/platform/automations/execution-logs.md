---
title: Ausführungslogs
description: Vergangene Workflow-Runs untersuchen, Fehler debuggen und mit Anpassungen neu laufen lassen.
---

Der **Ausführungen**-Tab jedes Workflows listet jeden Lauf — ob per Zeitplan, Event, Webhook oder manuell gestartet — mit Zeitstempeln, Dauer, Endstatus und Schritt-für-Schritt-Details. Dorthin gehst du, wenn ein Workflow gelaufen ist und du genau wissen musst, was passiert ist: welcher Schritt scheiterte, welchen Input er sah, welchen Output er produzierte, wie der Variablenzustand in dem Moment aussah.

Ausführungen werden für den Zeitraum aufbewahrt, der unter [Governance — Aufbewahrung](/de/platform/admin/governance#aufbewahrung) konfiguriert ist; jenseits dieses Horizonts werden Zeilen vom täglichen Cleanup-Runner hart gelöscht. Für langlebiges Debugging kopierst du den Trace, bevor die Aufbewahrung greift.

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

- **Mit gleichem Input erneut ausführen** — eine neue Ausführung mit demselben Input starten. Nützlich, wenn sich der Workflow geändert hat und du einen vergangenen Lauf erneut durchspielen willst.
- **Mit anderem Input erneut ausführen** — das Input-Payload vor dem erneuten Lauf bearbeiten. Nützlich für das Debuggen von Edge Cases.

Erneute Läufe erscheinen als neue Ausführungen — der Originalsatz bleibt erhalten.

## Aufbewahrung

Ausführungs-Datensätze werden gemäss der [Aufbewahrungsrichtlinie](/de/platform/admin/governance) deiner Organisation aufbewahrt. Standardmässig bleiben Schritt-Details 90 Tage erhalten, Zusammenfassungs-Datensätze ein Jahr.

## Alarme

Konfiguriere Alarme im **Alarme**-Tab des Workflows, damit ein Admin per E-Mail benachrichtigt wird, wenn ein Workflow fehlschlägt, länger als ein Schwellwert läuft oder einen Fehler erzeugt, der einem Muster entspricht. Für Workflow-übergreifende Alarme („mehr als 5 Fehlschläge pro Stunde über alle Workflows") nutze [Operations](/de/self-hosted/operate/observability/operations).

## Wo das einsetzt

Ausführungslogs sind die Pro-Workflow-Debug-Oberfläche. Wenn etwas fehlschlägt, gehst du hier hin — der Schritt-Name, der buchstäbliche Input, der buchstäbliche Output, die Fehlermeldung. Für die Workflow-übergreifende Aufrollung (KPIs, Läufe über die Zeit, Status-Aufteilung, Top-Workflows) ist [Automatisierungs-Metriken](/de/platform/automations/metrics) das Dashboard. Für organisationsweite Fehler-Trends über Automatisierungen und Chat hinweg ist [Operations](/de/self-hosted/operate/observability/operations) die richtige Oberfläche.
