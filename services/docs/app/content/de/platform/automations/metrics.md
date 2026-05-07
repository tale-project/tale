---
title: Workflow-Metriken
description: Nutzungs- und Leistungs-KPIs über alle Automatisierungen deiner Organisation.
---

Die Workflow-Metriken-Seite ist eine workflowübergreifende Sicht auf den Lauf deiner Automatisierungen. Sie aggregiert jeden Workflow der Organisation in vier Headline-KPIs, eine Ausführungen-im-Zeitverlauf-Kurve, eine Statusverteilung und eine Top-Workflows-Tabelle. Nutze sie, um den Workflow zu finden, der gestern angefangen hat zu scheitern, den Workflow, dessen Volumen nach einer Prozessänderung um das Zehnfache gestiegen ist, oder den langen Schwanz an Automatisierungen, die niemand mehr wirklich braucht.

Die Seite liegt unter **Automatisierungen > Metriken**. Sie steht den Rollen Admin und Developer offen, also derselben Gruppe, die Automatisierungen bearbeiten darf.

## Was sie zeigt

| Karte / Chart                   | Misst                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Ausführungen gesamt**         | Anzahl der Ausführungen im gewählten Zeitraum.                                                                               |
| **Erfolgsquote**                | Erfolgreiche Ausführungen geteilt durch alle — `running` und `cancelled` sind ausgenommen.                                   |
| **Ø Dauer**                     | Mittlere Wall-Clock-Dauer abgeschlossener Ausführungen.                                                                      |
| **Fehlgeschlagen**              | Anzahl der Ausführungen, die mit einem Fehler geendet haben.                                                                 |
| **Ausführungen im Zeitverlauf** | Tageswerte für abgeschlossene, fehlgeschlagene und laufende Ausführungen.                                                    |
| **Statusverteilung**            | Donut, der den Anteil jedes Endstatus über den Zeitraum zeigt.                                                               |
| **Top-Workflows**               | Tabelle, sortiert nach Ausführungsanzahl, mit Erfolgsquote, Ø Dauer, Fehlern und letztem Ausführungs-Zeitpunkt pro Workflow. |

Klicke eine Zeile in **Top-Workflows** an, um zu den [Ausführungsprotokollen](/de/platform/automations/execution-logs) dieses Workflows zu springen.

## Zeitraum-Wahl

Wechsle oben auf der Seite zwischen **Letzte 7 Tage**, **Letzte 30 Tage** und **Letzte 90 Tage**. Der Zeitraum spiegelt sich in der URL (`?period=30`), damit ein Link auf das Dashboard reproduzierbar bleibt.

Pro Abfrage werden nur die letzten 5.000 Ausführungen im gewählten Fenster ausgewertet. Wird das Limit erreicht, blendet sich ein Banner ein: _„Es werden die letzten 5.000 Ausführungen in diesem Zeitraum angezeigt. Ältere Ausführungen sind nicht in diesen Summen enthalten.“_ — wähle dann ein kürzeres Fenster für ein komplettes Bild oder springe zu **Top-Workflows** und untersuche die ungekappten, workflow-spezifischen Ausführungsprotokolle.

## Leerer Zustand

Hat im gewählten Zeitraum kein Workflow laufen, zeigt die Seite einen leeren Zustand mit dem Titel _Keine Workflow-Ausführungen_ statt KPI-Karten mit Null-Werten. Das ist das Signal, entweder den Zeitraum zu erweitern oder zu prüfen, ob deine Trigger feuern — siehe [Trigger](/de/platform/automations/triggers).

## Verwandt

- [Ausführungsprotokolle](/de/platform/automations/execution-logs) — pro Workflow mit Step-Detail.
- [Usage Analytics](/de/platform/admin/usage-analytics) — Token- und Kosten-Trends über die ganze Organisation inklusive Automatisierungen.
