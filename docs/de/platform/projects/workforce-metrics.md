---
title: Workforce-Metriken
description: Wie Agenten-Arbeit gemessen wird — Workforce-Dashboard, Scorecards pro Agent und Projekt-Metriken, immer Ergebnis mit Eingriff und Kosten gepaart.
---

Tale misst die KI-Workforce wie ein Team: **Ergebnis, menschlicher Eingriff und Kosten — immer zusammen**. Ein billiger Agent, dessen Arbeit ständig zurückkommt, ist nicht billig.

## Das Workforce-Dashboard

**Agenten → Workforce** ist die operative Zentrale: der Hauptschalter der Aufgaben-Automatisierung, eine Gesundheitsleiste (Läufe der letzten 24h, Fehlschläge, Automatisierungs-Fehler, ältester wartender Lauf), gepaarte KPI-Karten, der tägliche Aktivitätstrend, die Agenten-Rangliste und vier Aufmerksamkeits-Warteschlangen — wartende Reviews, liegengebliebene Agenten-Arbeit, wartende Läufe und Sicherungs-Pausen — jeweils mit Direktlink ins Board.

Die KPIs:

- **Abgeschlossen** — erledigte Aufgaben im Zeitfenster, aufgeteilt Agent vs. Mensch.
- **Eingriffsquote** — Änderungswünsche plus Eskalationen pro Agenten-Lauf, mit der Direkt-Freigabequote der Reviews.
- **Durchlaufzeit** — vom ersten _In Arbeit_ bis _Erledigt_.
- **Ausgaben** — mit Kosten pro abgeschlossener Aufgabe, nie allein.

## Agenten-Scorecards

Der **Leistungs**-Tab jedes Agenten zeigt die 30-Tage-Scorecard — Abschlüsse, Direkt-Freigabequote mit Änderungen/Eskalationen, mittlere Laufzeit, Ausgaben — plus die letzten Läufe mit Status, Auslöser, Dauer und Kosten.

## Projekt-Metriken

Jedes Board hat eine **Metriken**-Ansicht: kumulativer Fluss aus Tagesend-Schnappschüssen, Erstellt-vs.-Abgeschlossen-Durchsatz, Durchlaufzeit-Trend, Agent-vs.-Mensch-Verteilung und Ausgaben.

## Woher die Zahlen kommen

Ein nächtliches Rollup aggregiert pro Projekt und Tag aus der Aktivitäts-Zeitleiste und den vereinheitlichten Laufdaten (interne **und** externe Läufe teilen einen Datensatz). Gespeichert werden Summen und Zähler — Re-Aggregation bleibt exakt. Zahlen, die eine Scan-Grenze erreichen, sind als Untergrenzen markiert. Tägliche Digests (und eine Montags-Wochenzusammenfassung) liefern die Kernzahlen in die Postfächer der Org-Admins — an ruhigen Tagen bleibt es still.
