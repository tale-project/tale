---
title: Feedback-Analyse
description: Aggregierte Daumen-hoch- und Daumen-runter-Bewertungen auf Assistenten-Antworten plus Arena-Urteile, aufgeschlüsselt pro Assistent und pro Modell.
---

Feedback-Analyse ist das Dashboard, das die Per-Nachricht-Daumen und die Arena-Urteile in Trendlinien verwandelt. Mitglieder hinterlassen das Feedback inline im Chat; diese Seite aggregiert es pro Assistent, pro Modell und über die Zeit, sodass die Regression aus der Stimmänderung letzter Woche als Zahl sichtbar ist und nicht als Bauchgefühl. Admins und Inhaber lesen diese Seite, wenn ein Modellwechsel wie eine Verschlechterung aussieht, wenn ein Assistent schlechter abschneidet als die anderen, oder wenn die Führung die grobe Qualitätshaltung jedes Assistenten in der Organisation will.

## Eine durchgespielte Detailansicht

Öffne **Einstellungen > Metriken > Feedback** und die Default-Ansicht ist die organisationsweite Stimmung über die letzten 7 Tage — weite das Fenster, wenn es ruhig ist. **Top-Assistenten nach Feedback** zeigt das Hilfreich-Verhältnis pro Assistent samt Volumen, sodass die tatsächlich genutzten Assistenten herausstechen; filtere auf einen, und Stimmungs-Trend und aktuelle Kommentare ziehen mit. **Top-Modelle nach Feedback** sind dieselben Daten, geschnitten auf das Modell, das jede bewertete Antwort erzeugt hat.

## Die zwei Signale

**Daumen-Feedback** ist das Per-Nachricht-Signal — ein Daumen hoch oder ein Daumen runter auf eine Assistenten-Antwort. Der Daumen trägt einen optionalen Freitext-Kommentar; der Kommentar ist pro Zeile und fließt nie ins Verhältnis. Mitglieder können ihren Daumen ändern oder ganz zurückziehen; die Zahlen zeigen den jeweils letzten Stand.

**Arena-Urteile** ist das Per-Vergleich-Signal — lässt ein Mitglied zwei Modelle im [Arena-Modus](/de/platform/chat/arena-mode) nebeneinander laufen, landet das Urteil hier. Die Zusammenfassung zählt entschiedene Stimmen, Unentschieden und Beide-schlecht; **Top Modell-Duelle** hält den Stand pro Paarung fest, weil ein „A gewinnt" nur gegen das geschlagene Modell etwas bedeutet.

## Aufschlüsselungen

Das Dashboard schneidet nach drei Dimensionen:

- **Assistent** — jeder Assistent mit bewerteten Antworten bekommt seine eigene Zeile mit Hilfreich- und Nicht-hilfreich-Zählern und der resultierenden Stimmung.
- **Modell** — jedes Modell, das eine bewertete Antwort erzeugt hat, trägt bei; Arena-Paarungen bleiben im Duell-Tableau Kopf an Kopf.
- **Zeit** — die Kurve Stimmung im Zeitverlauf folgt dem gewählten Fenster, von einem Tag bis 90 Tagen. Ab 50.000 Einträgen im Fenster zeigt die Seite Teilergebnisse und bittet dich, es zu verengen.

## Freitext-Kommentare

Kommentare erscheinen in der Liste **Aktuelles Feedback** unter den aggregierten Zahlen. Filtere mit **Nur Kommentare**, um blanke Daumen auszublenden, und nach Typ, um Chat-Daumen von Arena-Urteilen zu trennen. Kommentare unterliegen derselben Aufbewahrungsrichtlinie wie die Konversationen, zu denen sie gehören; wird ein Thread gelöscht oder verworfen, gehen die Kommentare mit.

## Wo das hingehört

Feedback-Analyse ist der Puls jedes Assistenten in der Organisation — der Ort, an dem eine Regression in Stimme oder Modellverhalten auftaucht, bevor jemand sie meldet. Die Begleitseite ist [Nutzungs-Analyse](/de/platform/admin/governance/usage-analytics) — dieselben Assistenten und Modelle, geschnitten nach Kosten und Token-Volumen statt nach Qualität.
