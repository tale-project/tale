---
title: Nutzungs-Analyse
description: Das Dashboard für Tokens, Kosten und Anfragenvolumen nach Benutzer, Team, Modell und Agent — mit Trends und einer Top-Agent-Rangliste. Admins und Inhaber lesen das, wenn eine Rechnung unerwartet ist oder wenn die Führung die grobe Form der AI-Ausgaben will.
---

Nutzungs-Analyse ist das Dashboard, das jeden abrechenbaren AI-Aufruf in einer einzigen Ansicht von Tokens, Kosten und Anfragenvolumen aggregiert. Es schneidet nach Benutzer, Team, Rolle, Modell, Agent und Zeit, sodass die unerwartete Zeile auf der Rechnung zur Last zurückführbar ist, die sie verursacht hat. Admins und Inhaber lesen diese Seite, wenn eine Rechnung unerwartet ist, wenn die Führung die grobe Form der AI-Ausgaben will, oder wenn eine Budgetwarnung auslöst und die nächste Frage _wer und was_ ist.

## Eine durchgespielte Detailansicht

Öffne **Einstellungen > Richtlinien > Nutzung**. Die Default-Ansicht sind die letzten 30 Tage, org-weit, mit den drei Kennzahlen-Zählern — Tokens insgesamt, Kosten insgesamt in USD, Anfragen insgesamt. Wechsle die Aufschlüsselung auf **Nach Benutzer**, um die größten Verbraucher zu finden, **Nach Modell**, um ein teures Primärmodell mit einem günstigeren Fallback zu vergleichen, oder **Nach Agent**, um den Agent zu finden, der die Last treibt. Jede Zeile öffnet eine Per-Zeile-Zeitreihe; die Diagrammachse folgt der gewählten Periode.

## Die Dimensionen

- **Benutzer** — jedes Mitglied, das einen abrechenbaren Aufruf ausgelöst hat. Paare mit dem Team- oder Rollenfilter, um die Ansicht einzugrenzen.
- **Team** — aggregiert über Team-Mitglieder; nützlich, wenn Budgets team-gebunden sind.
- **Rolle** — Inhaber, Admin, Entwickler, Redakteur, Mitglied.
- **Modell** — jedes Modell, das eine Antwort erzeugt hat, gruppiert nach Anbieter.
- **Agent** — jeder benannte Agent (die Rangliste sortiert nach Token-Volumen, Kosten oder Anfragenzahl).
- **Zeit** — täglicher Trend für kurze Fenster, wöchentlich für längere.

## Das Kostenmodell

Kosten sind eine Schätzung. Jede Anfrage landet im Nutzungsbuch mit Eingabe-Tokens, Ausgabe-Tokens, dem veröffentlichten Preis des Modells pro Million Tokens und der Wanduhr-Dauer. Das Dashboard multipliziert Tokens mit Preis; Bildgenerierungsaufrufe landen mit einem Per-Bild-Preis, den der Anbieter zurückgibt. Die Zeile im Nutzungsbuch ist die Quelle der Wahrheit, und das [Audit-Log](/de/platform/admin/governance/audit-logs) trägt Akteur und Zeitstempel der Zeile für den Quervergleich.

## Budget-Überlagerungen

Wenn [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) ein Budget für einen Bereich hat, überlagert das Nutzungs-Diagramm das Limit als horizontale Linie. Beim Hovern auf einen Punkt erscheint der verbrauchte Anteil des Limits und der projizierte Monatsendwert basierend auf dem aktuellen Trend. Das Überschreiten der Warnschwelle färbt die Reihe orange; das Überschreiten des Limits färbt sie rot und zeigt die Budget-überschritten-Ereignisse als Marker auf der Zeitachse.

## Aufbewahrung von Nutzungs-Zeilen

Das Nutzungsbuch hat sein eigenes Aufbewahrungsfenster in [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits). Default sind 365 Tage; kürze es und der historische Chart wird entsprechend gekürzt. Das Dashboard spiegelt, was das Nutzungsbuch hält — es gibt keine Archiv-Ebene darunter.

## Wo das hingehört

Nutzungs-Analyse ist die Ausgaben- und Volumen-Seite derselben Last, die [Feedback-Analyse](/de/platform/admin/governance/feedback-analytics) für Qualität liest. Zusammen beantworten sie _ist dieser Agent seine Kosten wert_. Die Begleitseite ist [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) — die Seite, auf der die Budgets, die dieses Dashboard überlagert, konfiguriert werden.
