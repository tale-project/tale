---
title: Feedback-Analyse
description: Aggregierte Daumen-hoch- und Daumen-runter-Bewertungen auf Agent-Nachrichten plus Chat-Bewertungen, aufgeschlüsselt pro Agent und pro Modell. Admins und Inhaber lesen das, wenn eine Agent-Regression eine Zahl dahinter braucht.
---

Feedback-Analyse ist das Dashboard, das die Per-Nachricht-Daumen und die Per-Chat-Bewertungen in Trendlinien verwandelt. Mitglieder hinterlassen das Feedback inline im Chat; diese Seite aggregiert es pro Agent, pro Modell und über die Zeit, sodass die Regression aus der Stimmänderung letzter Woche als Zahl sichtbar ist und nicht als Bauchgefühl. Admins und Inhaber lesen diese Seite, wenn ein Modellwechsel wie eine Verschlechterung aussieht, wenn ein Agent schlechter abschneidet als die anderen, oder wenn die Führung die grobe Qualitätshaltung jedes Agents in der Organisation will.

## Eine durchgespielte Detailansicht

Öffne **Einstellungen > Richtlinien > Feedback** und die Default-Ansicht ist das organisationsweite Verhältnis über die letzten 30 Tage. Wechsle die Aufschlüsselung auf **Nach Agent**, um das Verhältnis pro Agent zu sehen — sortiere nach Feedback-Volumen, um die Agents zu finden, die Mitglieder tatsächlich nutzen, klick dann in einen hinein, um seine Modellhistorie neben demselben Verhältnis über die Zeit zu sehen. Die Ansicht Aufteilung nach Modell sind dieselben Daten, geschnitten auf das Modell, das jede bewertete Antwort erzeugt hat.

## Die zwei Signale

**Daumen-Feedback** ist das Per-Nachricht-Signal — ein Daumen hoch oder ein Daumen runter auf eine Agent-Antwort. Der Daumen trägt einen optionalen Freitext-Kommentar; der Kommentar ist pro Zeile und fließt nie ins Verhältnis. Mitglieder können beides hinterlassen, eines bearbeiten oder ganz zurückziehen; die Zeitleiste zeigt den jeweils letzten Stand.

**Chat-Bewertungen** ist das Per-Konversations-Signal — die Bewertung von eins bis fünf Sternen, die am Ende einer Konversation auftaucht. Bewertungen tragen auch einen optionalen Kommentar. Chat-Bewertungen sind gröber als Daumen und nützlich, um die Agent-Stimmung über viele Runden zu verfolgen, wo einzelne Daumen Rauschen wären.

## Aufschlüsselungen

Das Dashboard schneidet nach drei Dimensionen:

- **Agent** — jeder Agent in der Organisation bekommt seine eigene Zeile mit Verhältnis, Volumen und Trend.
- **Modell** — jedes Modell, das eine bewertete Antwort erzeugt hat, trägt bei; nützlich beim Vergleich eines Primärmodells mit seinem Fallback.
- **Zeit** — der Trend ist täglich für die letzten 30 Tage und wöchentlich für längere Fenster.

## Freitext-Kommentare

Kommentare erscheinen unter den aggregierten Zahlen als Liste. Sortiere nach Aktualität oder nach Sentiment; klick durch zur Konversation im Kontext, um zu sehen, worauf die bewertete Antwort reagiert hat. Kommentare unterliegen derselben Aufbewahrungsrichtlinie wie die Konversationen, zu denen sie gehören; wird ein Thread gelöscht oder verworfen, gehen die Kommentare mit.

## Wo das hingehört

Feedback-Analyse ist der Puls jedes Agents in der Organisation — der Ort, an dem eine Regression in Stimme oder Modellverhalten auftaucht, bevor jemand sie meldet. Die Begleitseite ist [Nutzungs-Analyse](/de/platform/admin/governance/usage-analytics) — dieselben Agents und Modelle, geschnitten nach Kosten und Token-Volumen statt nach Qualität.
