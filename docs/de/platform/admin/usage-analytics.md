---
title: Usage Analytics
description: Zeitbasierte Analysen zu Token-Verbrauch, Kosten und Workflow-Performance.
---

Das Usage-Analytics-Dashboard unter **Einstellungen > Governance > Usage Dashboard** gibt Admins einen Zeitreihen-Blick darauf, wie die Organisation Tale nutzt. Es ist eine Erweiterung der Snapshot-Zahlen aus den Budgets — hier siehst du Trends, kannst auf einzelne Nutzer oder Teams drill-downen und Daten für Finanzen oder Kapazitätsplanung exportieren.

## Verfügbare Charts

| Chart                     | Zeigt                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| **Tokens im Zeitverlauf** | Input- und Output-Tokens pro Tag, gestapelt nach Modell.                                      |
| **Kosten im Zeitverlauf** | Kosten pro Tag und Monat, gestapelt nach Anbieter.                                            |
| **Top-Nutzer**            | Ranking der Nutzer nach Token-Verbrauch im gewählten Zeitraum.                                |
| **Top-Teams**             | Ranking der Teams nach Token-Verbrauch.                                                       |
| **Model-Mix**             | Anteile der Anfragen pro Modell — nützlich bei Rollouts neuer Modelle oder Kostenoptimierung. |
| **Feature-Mix**           | Anteile der Anfragen pro Feature — Chat, Arena, Agents, Automatisierungen.                    |
| **Workflow-Kennzahlen**   | Run-Anzahl, Erfolgsrate, Median-Dauer und p95-Dauer pro Automatisierung.                      |

## Filter

Jedes Chart respektiert die globale Filterleiste:

- **Zeitraum** — letzte 7 Tage, letzte 30 Tage, aktueller Monat, letztes Quartal, benutzerdefiniert.
- **Team** — auf Mitglieder ausgewählter Teams beschränken.
- **Nutzer** — Einzel-Nutzer-Ansicht für gezielte Untersuchungen.
- **Agent** — auf Konversationen und Automatisierungen beschränken, die einen bestimmten Agent nutzen.

## Export

Der **Export**-Button über jedem Chart erzeugt eine CSV mit den zugrunde liegenden Datenzeilen, unter Berücksichtigung aller aktiven Filter. Nutze das für Board-Reporting, Finanz-Abgleich oder das Einspielen in ein externes BI-Tool.

## Aufbewahrung

Analytics-Daten folgen der allgemeinen [Aufbewahrungsrichtlinie](/de/platform/admin/governance). Standardmäßig werden detaillierte Usage-Datensätze 13 Monate lang aufbewahrt, sodass du Jahr-über-Jahr-Vergleiche hast; aggregierte Monatswerte bleiben unbegrenzt.

## Verwandt

- [Governance](/de/platform/admin/governance) — die hier gezeigten Budgets und Limits konfigurieren.
- [Operations](/de/self-hosted/operate/observability/operations) — Operator-seitige Observability (Prometheus, Logs, Health).
