---
title: Nutzungsanalyse
description: Zeitreihen-Sicht auf Token-Verbrauch, Kosten und Workflow-Performance — gefiltert nach Team, Nutzer, Agent und Zeitraum, mit CSV-Export für Finance und Kapazitätsplanung.
---

Nutzungsanalyse ist das Dashboard, das Admins konsultieren, wenn die Frage lautet: „Wie viel gibt die Organisation aus, auf welchen Modellen, für welche Arbeit?". Es ist eine Obermenge der Snapshot-Zahlen, die die Budget-Oberfläche zeigt: Budgets beantworten „Sind wir gerade über der Obergrenze", und diese Seite beantwortet „Wie ist der Trend, wer treibt ihn, und welcher Workflow ist verantwortlich". Die Oberfläche ist **Einstellungen > Richtlinien > Nutzungs-Dashboard** und ausschließlich für Admins.

Zielgruppe ist der Admin, der Finance-Abgleich, Kapazitätsplanung oder einen Nutzungs-Review nach einem Vorfall macht. Für den Operator-seitigen Observability-Stapel (Prometheus, Logs, Health-Checks) ist [Betrieb](/de/self-hosted/operate/observability/operations) die Seite; diese hier bleibt innerhalb des Produkts.

## Verfügbare Diagramme

| Diagramm              | Was es zeigt                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| **Tokens über Zeit**  | Eingabe- und Ausgabe-Tokens je Tag, gestapelt nach Modell.                                               |
| **Kosten über Zeit**  | Tages- und Monats-Kosten, gestapelt nach Anbieter.                                                       |
| **Top-Nutzer**        | Nach Token-Verbrauch sortierte Nutzer im gewählten Zeitraum.                                             |
| **Top-Teams**         | Nach Token-Verbrauch sortierte Teams im gewählten Zeitraum.                                              |
| **Modell-Mix**        | Anteil der Anfragen je Modell — nützlich beim Ausrollen eines neuen Modells oder bei Kosten-Optimierung. |
| **Funktions-Mix**     | Anteil der Anfragen je Funktion — Chat, Arena, Agents, Automatisierungen.                                |
| **Workflow-Metriken** | Je Automatisierung Lauf-Zahl, Erfolgsrate, mittlere Dauer und p95-Dauer.                                 |

Jedes Diagramm respektiert die globale Filter-Leiste, sodass eine einzelne Filter-Änderung das ganze Dashboard auffrischt.

## Filter

Die Filter-Leiste oben exponiert vier Geltungsbereiche:

- **Zeitraum** — letzte 7 Tage, letzte 30 Tage, dieser Monat, letztes Quartal oder eigener Bereich.
- **Team** — auf Mitglieder der gewählten Teams einschränken.
- **Nutzer** — Einzelnutzer-Sicht für individuelle Nachforschungen.
- **Agent** — auf Konversationen und Automatisierungen mit einem bestimmten Agent einschränken.

Filter komponieren: Wähle **Team = Support** und **Agent = Kundensupport**, um den Token-Verbrauch eines Agents in einem Team zu sehen. Der aktive Filter-Satz wird in jedem CSV-Export mitgegeben, damit eine nachgelagerte Tabelle den Geltungsbereich sichtbar behält.

## Exportieren

Die **Export**-Schaltfläche über jedem Diagramm erzeugt eine CSV der zugrunde liegenden Zeilen und respektiert jeden aktiven Filter. Nutze sie für Vorstands-Reporting, Finance-Abgleich oder das Einspeisen in ein externes BI-Werkzeug — die Zeilen entsprechen den Datenpunkten des Diagramms eins zu eins, sodass die Tabellen-Posten mit dem Dashboard zusammenpassen.

## Gedeckelte Fenster

Enthält ein Filter-Fenster mehr als 5.000 Läufe, zeigt das Dashboard ein Banner, dass es die jüngsten 5.000 Läufe in diesem Fenster zeigt. Ältere Läufe in der gleichen Spanne sind aus den Summen ausgeschlossen. Engere das Fenster — wähle einen engeren Zeitraum oder ein spezifischeres Team oder einen spezifischeren Agent — um vollständige Zahlen für die Spanne zu sehen, die in die Decke passt.

## Aufbewahrung

Zeilen der Nutzungsanalyse folgen der Einstellung **Nutzungs-Ledger** unter [Richtlinien > Aufbewahrung](/de/platform/admin/governance#retention). Voreingestellt werden detaillierte Nutzungs-Datensätze lange genug für Jahresvergleiche gehalten; aggregierte Monatswerte bleiben unbegrenzt. Eine Verkürzung der Nutzungs-Ledger-Aufbewahrung kürzt die historische Analyse, von der diese Seite zieht — deshalb zeigt das Aufbewahrungs-Formular vor einer Verkürzung eine Warnung.

## Wo das hingehört

Nutzungsanalyse ist die Zeitreihen-Sicht auf den Verbrauch — Tokens, Kosten, Läufe, je Nutzer und Team. Sie passt zu [Richtlinien](/de/platform/admin/governance), wo die Budgets und Limits gesetzt werden, gegen die das Dashboard misst, und zu [Betrieb](/de/self-hosted/operate/observability/operations) für den Operator-seitigen Observability-Stapel. Wenn ein Diagramm in die falsche Richtung tendiert, geht die Aktion zurück zu Richtlinien, um die Politik zu straffen — ein Budget anpassen, ein Modell einschränken, eine Voreinstellung verengen — und auf dieser Seite prüfst du beim nächsten Refresh, ob die Änderung gegriffen hat.
