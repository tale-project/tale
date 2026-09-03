---
title: Nutzungs-Analyse
description: Das Dashboard für Tokens, Kosten und Anfragenvolumen nach Benutzer, Team, Modell und Agent — mit Trends und einer Top-Agent-Rangliste. Admins und Inhaber lesen das, wenn eine Rechnung unerwartet ist oder wenn die Führung die grobe Form der AI-Ausgaben will.
---

Nutzungs-Analyse ist das Dashboard, das jeden abrechenbaren AI-Aufruf in einer einzigen Ansicht von Tokens, Kosten und Anfragenvolumen aggregiert. Es schneidet nach Benutzer, Team, Rolle, Modell, Agent und Zeit, sodass die unerwartete Zeile auf der Rechnung zur Last zurückführbar ist, die sie verursacht hat. Admins und Inhaber lesen diese Seite, wenn eine Rechnung unerwartet ist, wenn die Führung die grobe Form der AI-Ausgaben will, oder wenn eine Budgetwarnung auslöst und die nächste Frage _wer und was_ ist.

## Eine durchgespielte Detailansicht

Öffne **Einstellungen > Metriken > Nutzung**. Die Default-Ansicht sind die letzten 30 Tage, org-weit, mit den Kennzahlen-Zählern — Anfragen, Tokens, Kosten und aktive Benutzer — über dem Nutzungs-Trend. Lies **Nutzung pro Benutzer**, um die größten Verbraucher zu finden, **Top-Modelle**, um ein teures Primärmodell mit einem günstigeren Fallback zu vergleichen, oder **Top-Assistenten**, um den Assistenten zu finden, der die Last treibt. Der Perioden-Schalter (7, 30 oder 90 Tage) treibt alle Abschnitte zugleich.

## Die Dimensionen

- **Benutzer** — jedes Mitglied, das einen abrechenbaren Aufruf ausgelöst hat, mit Tokens, Kosten und Anfragen.
- **Modell** — jedes Modell, das eine Antwort erzeugt hat; Sprachmodelle halten ihre eigene Rangliste.
- **Assistent** — jeder Assistent mit zugeordneter Nutzung.
- **Zeit** — der Trend-Chart folgt dem gewählten Fenster: 7, 30 oder 90 Tage.

## Das Kostenmodell

Kosten sind eine Schätzung. Jede Anfrage landet im Nutzungsbuch mit Eingabe-Tokens, Ausgabe-Tokens, dem veröffentlichten Preis des Modells pro Million Tokens und der Wanduhr-Dauer. Das Dashboard multipliziert Tokens mit Preis; Bildgenerierungsaufrufe landen mit einem Per-Bild-Preis, den der Anbieter zurückgibt. Die Zeile im Nutzungsbuch ist die Quelle der Wahrheit, und das [Audit-Log](/de/platform/admin/governance/audit-logs) trägt Akteur und Zeitstempel der Zeile für den Quervergleich.

## Budgets und Nutzung

Budgets leben unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits); dieses Dashboard ist der Ort, an dem du nachverfolgst, was sie getrieben hat. Feuert im Chat eine Budget-Warnung oder ein Budget-überschritten-Hinweis, beantworten die Tabellen pro Benutzer und pro Modell hier die Anschlussfrage — wer hat es ausgegeben, auf welchem Modell, über welche Tage.

## Aufbewahrung von Nutzungs-Zeilen

Das Nutzungsbuch hat sein eigenes Aufbewahrungsfenster in [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits). Default sind 365 Tage; kürze es und der historische Chart wird entsprechend gekürzt. Das Dashboard spiegelt, was das Nutzungsbuch hält — es gibt keine Archiv-Ebene darunter.

## Wo das hingehört

Nutzungs-Analyse ist die Ausgaben- und Volumen-Seite derselben Last, die [Feedback-Analyse](/de/platform/admin/governance/feedback-analytics) für Qualität liest. Zusammen beantworten sie _ist dieser Agent seine Kosten wert_. Die Begleitseite ist [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) — die Seite, auf der die Budgets, die dieses Dashboard überlagert, konfiguriert werden.
