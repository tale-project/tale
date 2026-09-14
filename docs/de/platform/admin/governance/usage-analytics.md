---
title: Nutzungsanalyse
description: Untersuche Tokenverbrauch, Anfragevolumen und erfasste Kosten nach Modell, Assistent und Person.
---

Öffne als Admin oder Inhaber **Einstellungen > Metriken > Nutzung**, um zu sehen, welche Aufgaben KI-Ressourcen verbrauchen. Wähle zuerst den Zeitraum und untersuche dann die Aufschlüsselungen, um veränderte Kosten oder Mengen zu erklären.

## Einen Nutzungsanstieg untersuchen

1. Öffne **Filter** und wähle unter **Zeitraum** 7, 30 oder 90 Tage. Die erste Ansicht zeigt 30 Tage.
2. Vergleiche Anfragen, Tokens, Kosten und aktive Benutzer. Mehr Anfragen haben andere Ursachen als längere Antworten.
3. Wähle im Filtermenü die Messgröße und zeitliche Auflösung des Diagramms, um den Beginn der Veränderung zu erkennen.
4. Prüfe die Tabellen für Assistenten, Modelle und Nutzung pro Person. Wähle eine Assistenten- oder Modellaufschlüsselung, um die Ansicht einzugrenzen. Entferne den Filterchip, um wieder mehr zu sehen.

Unter den Assistentennamen können auch Hilfsaufgaben wie die Erzeugung von Chattiteln stehen. Die Zahl der Anfragen entspricht daher nicht immer der Zahl gesendeter Nachrichten. Für die Sprachausgabe gibt es eine eigene Tabelle der Sprachmodelle.

## Kosten zusammen mit Tokens lesen

Das Dashboard verwendet erfasste Nutzungs- und Verbrauchsdaten. Eingabe- und Ausgabetokens sind getrennt. Dienste wie Sprach- oder Bilderzeugung können andere Abrechnungseinheiten haben. Die Tokenzahl allein erklärt deshalb nicht alle Kosten.

Lies die Kosten als erfasste Anwendungsnutzung, nicht als Rechnung deines Anbieters. Preise, Abos, Guthaben und nicht erfasste Aufrufe können den Vergleich beeinflussen. Eine angezeigte Null beweist nicht, dass der Anbieter nichts berechnet hat.

## Auf eine Budgetwarnung reagieren

Wähle für die Untersuchung denselben Zeitraum und die betroffene Aufgabe. Finde die Person, den Assistenten oder das Modell hinter dem Anstieg. Entscheide dann, ob du den Ablauf änderst, ein anderes Modell wählst oder unter [Richtlinien und Limits](/platform/admin/governance/policies-and-limits) eine Obergrenze anpasst.

Prüfe die [Feedback-Analyse](/platform/admin/governance/feedback-analytics), bevor du ein Modell allein wegen der Kosten wechselst. Geringere Ausgaben helfen nur, wenn die Ergebnisse die Aufgabe weiterhin erfüllen.

## Fehlende Historie verstehen

Die Diagramme zeigen die Nutzungsdaten, die Tale noch aufbewahrt. Organisations- und Deployment-Einstellungen bestimmen, wie weit die Historie reicht; eine allgemeine Garantie von 365 Tagen gibt es nicht. Prüfe Zeitraum, Filter und Aufbewahrung des Nutzungsprotokolls, wenn erwartete Aktivität fehlt.
