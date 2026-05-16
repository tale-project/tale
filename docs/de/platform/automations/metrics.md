---
title: Workflow-Metriken
description: Ein automatisierungsübergreifendes Dashboard mit Gesamtausführungen, Erfolgsquote, durchschnittlicher Dauer und Top-Bewegungen.
---

Das Dashboard **Workflow-Metriken** fasst jede Automatisierung der Organisation in einer Ansicht zusammen: vier Kennzahlen oben, ein Trend der Ausführungen im Zeitverlauf, eine Statusverteilung und eine Top-Workflows-Tabelle, in die du hineinspringen kannst. Öffne es, wenn die Frage über mehrere Automatisierungen hinweg geht und nicht in einer einzigen sitzt — „haben wir mit dem Deploy gestern etwas kaputt gemacht", „welche Automatisierung ist nach der Prozessänderung um das Zehnfache gewachsen", „was liegt im langen Schwanz, das niemand mehr nutzt". Die Zielgruppe sind Admin und Entwickler, dieselben Rollen, die Automatisierungen bearbeiten dürfen.

Das Dashboard liegt unter **Automatisierungen > Metriken anzeigen**. Es ist leer, bis mindestens eine Automatisierung gelaufen ist; sobald Ausführungen eintreffen, frischt sich die Oberfläche nahezu in Echtzeit auf.

## Die vier Kennzahlen oben

Der obere Bereich der Seite trägt vier Karten.

| Karte                   | Liest                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Ausführungen gesamt** | Anzahl der Ausführungen im gewählten Zeitraum.                                                                  |
| **Erfolgsquote**        | Erfolgreiche Ausführungen geteilt durch die Gesamtzahl. Noch laufende und abgebrochene Ausführungen fallen weg. |
| **Ø Dauer**             | Mittlere Wanduhrzeit der abgeschlossenen Ausführungen.                                                          |
| **Fehlgeschlagen**      | Anzahl der Ausführungen, die mit einem Fehler endeten.                                                          |

Die vier zusammen beantworten die Frage „ist das System in diesem Zeitraum gesund". Eine sinkende Erfolgsquote bei stabilen Gesamtausführungen zeigt auf eine bestimmte Automatisierung mit Regression; eine stabile Erfolgsquote bei einbrechenden Gesamtausführungen zeigt darauf, dass die Trigger-Quelle still geworden ist.

## Trend und Status

Unter den Karten teilen zwei Diagramme den Zeitraum auf.

**Ausführungen im Zeitverlauf** ist eine tägliche Reihe aus abgeschlossenen, fehlgeschlagenen und laufenden Ausführungen über das gewählte Fenster. Die Form der Reihe — langsamer Anstieg, Wochenrhythmus, plötzlicher Ausschlag — ist der Hinweis darauf, welche Automatisierung als Nächstes zu öffnen ist.

**Statusverteilung** ist ein Donut mit dem Anteil, den jeder Endstatus über den Zeitraum hinweg einnimmt. Eine gesunde Mischung ist schwer bei „abgeschlossen" mit einem dünnen Streifen „fehlgeschlagen"; ein Donut, in dem fehlgeschlagen mehr als ein paar Prozent ausmacht, ist das Signal zum Reinschauen.

## Top-Workflows

Die Tabelle unten ordnet Automatisierungen nach Ausführungsanzahl und zeigt für jede die Erfolgsquote, die durchschnittliche Dauer, die Anzahl der Fehlläufe und den Zeitstempel der letzten Ausführung. Klick eine Zeile an, um direkt in die [Ausführungsprotokolle](/de/platform/automations/execution-logs) dieser Automatisierung zu springen — die Rangtabelle ist die automatisierungsübergreifende Linse, das Ausführungsprotokoll ist die Wahrheit pro Lauf.

## Zeitraum und das Limit

Wechsle zwischen **Letzte 7 Tage**, **Letzte 30 Tage** und **Letzte 90 Tage** über die Zeitraumauswahl oben rechts. Die Wahl spiegelt sich in der URL wider, sodass ein verlinktes Dashboard reproduzierbar ist.

Jede Abfrage liest die jüngsten 5.000 Ausführungen im Fenster. Wird das Limit erreicht, zeigt ein Banner über den Karten den Hinweis _„Es werden die letzten 5.000 Ausführungen in diesem Zeitraum angezeigt. Ältere Ausführungen sind nicht in diesen Summen enthalten."_ — wechsle dann auf ein kürzeres Fenster für ein vollständiges Bild oder springe in die Top-Workflows-Tabelle und öffne das Ausführungsprotokoll jeder einzelnen Automatisierung, das nicht gedeckelt ist.

## Leerer Zeitraum

Ein Zeitraum ohne Ausführungen zeigt den Leerzustand — eine einzelne Zeile **Keine Workflow-Ausführungen** statt Karten mit Null-Werten. Der Leerzustand ist der Hinweis, entweder das Fenster zu erweitern oder zu prüfen, ob die Trigger überhaupt feuern; der natürliche nächste Schritt von dort ist [Trigger](/de/platform/automations/triggers).

## Wo das hingehört

Workflow-Metriken sind die automatisierungsübergreifende Linse: die Antwort auf „ist etwas kaputt" und „was hat sich seit letzter Woche geändert", ohne jede Automatisierung einzeln zu öffnen. Wenn sich eine Zahl verändert, sind die [Ausführungsprotokolle](/de/platform/automations/execution-logs) die Wahrheit pro Lauf — öffne die betroffene Automatisierung, finde den fehlerhaften Lauf, lies sein Journal. Für LLM-Kostentrends, die Automatisierungen und Chat zusammen abdecken, liegt [Nutzungsanalyse](/de/platform/admin/usage-analytics) eine Lasche weiter.
