---
title: Aufgaben auf dem Projektboard verwalten
description: Erstelle Aufgaben, lege Verantwortliche fest, verfolge den Fortschritt und prüfe die Ergebnisse an einem Ort.
---

Eine Aufgabe hält zusammen, worum es bei einer Arbeit geht: Ziel, Zuständigkeit, Status, Dateien und die Diskussion zum Ergebnis. Nutze das Projektboard sowohl für menschliche Arbeit als auch für Aufgaben, die du einem Agenten überträgst. Zum Ändern von Aufgaben brauchst du Bearbeitungszugriff auf das Projekt.

<Frame caption="Das Board ordnet Aufgaben nach Status. Unter Liste siehst du dieselben Aufgaben als Zeilen.">

![Das Aufgabenboard des Projekts Website relaunch zeigt Karten in Backlog, Zu erledigen, In Bearbeitung, In Prüfung, Erledigt und Abgebrochen.](/images/platform/projects-task-board.webp)

</Frame>

## Eine Aufgabe mit klarem Ergebnis erstellen

1. Öffne **Aufgaben** im Projekt und klicke auf **Aufgabe erstellen**.
2. Benenne unter **Titel** das gewünschte Ergebnis, etwa „Launch-Briefing prüfen“.
3. Erkläre in der **Beschreibung**, was benötigt wird und wie das Ergebnis geprüft werden soll. Füge benötigte Dateien als Anhänge hinzu.
4. Wähle bei Bedarf **Status**, **Priorität** und **Zuständig**. Neue Aufgaben starten mit **Zu erledigen**. Für noch nicht beschlossene Vorschläge nutze **Backlog**.
5. Klicke auf **Aufgabe erstellen**. Öffne die neue Karte, um weitere Angaben zu ergänzen.

Tale vergibt eine Kennung aus dem Projektkürzel, etwa `WEB-1`. Verwende sie in Verweisen auf die Arbeit, damit ähnlich benannte Aufgaben unterscheidbar bleiben.

<Tip>

Eine hilfreiche Beschreibung nennt Ausgangsmaterial, gewünschtes Ergebnis und Abschlusskriterium. Zum Beispiel: „Vergleiche den Prüftermin im angehängten Briefing mit den Gesprächsnotizen. Halte Abweichungen in einem Kommentar fest und nenne beide Dateien als Quelle.“

</Tip>

<Frame caption="Die Aufgabendetails stellen Beschreibung, Anhänge, Teilaufgaben und Kommentare neben Zuständigkeit und Status.">

![Die Aufgabe Sign off the launch checklist zeigt den Beschreibungsbereich, Anhänge, Teilaufgaben, Kommentare, Status, Zuständigkeit, Reviewer, Termine, Labels und Abhängigkeiten.](/images/platform/project-task-detail.webp)

</Frame>

## Zuständigkeit und Prüfung festlegen

**Zuständig** bestimmt, wer die Arbeit übernimmt: eine Person, ein Projektagent oder eine im Projekt verfügbare Automation. **Reviewer** benennt die Person, die bei einem prüfbereiten Agentenergebnis benachrichtigt wird. Reviewer können nur Mitglieder mit Bearbeitungszugriff auf das Projekt sein.

Einen Agenten zuweisen und seinen Lauf starten sind zwei Entscheidungen. Klicke nach der Zuweisung auf **Agent starten** oder verschiebe die Aufgabe nach **In Bearbeitung**. Lies [Aufgaben automatisieren](/de/platform/projects/task-automation), bevor du Arbeit mit verbundenen Diensten oder Dateiergebnissen startest.

Der Reviewer erhält die Prüfanfrage, hat aber kein ausschließliches Entscheidungsrecht. Auch andere Mitglieder mit Bearbeitungszugriff dürfen das Ergebnis annehmen.

## Fortschritt mit dem Status zeigen

Ändere den **Status** in den Aufgabendetails oder ziehe die Karte auf dem **Board** in eine andere Spalte. Die Statusauswahl lässt sich auch mit der Tastatur bedienen.

| Status | Bedeutung |
| --- | --- |
| **Backlog** | Vorgeschlagene Arbeit, die noch nicht beschlossen ist. |
| **Zu erledigen** | Arbeit, die begonnen werden kann. |
| **In Bearbeitung** | Die Arbeit läuft. Bei einer Agentenaufgabe startet der Wechsel hierhin den Lauf. |
| **In Prüfung** | Ein Ergebnis wartet auf die Prüfung durch eine Person. |
| **Erledigt** | Eine Person hat die abgeschlossene Arbeit angenommen. |
| **Abgebrochen** | Die Arbeit wird nicht weitergeführt. |

Bei Agentenaufgaben kann ein Statuswechsel die Ausführung starten oder abbrechen. Lies deshalb den Aktionshinweis vor dem Verschieben. Ein Agent liefert sein Ergebnis unter **In Prüfung** ab; auf **Erledigt** darf er es nicht selbst setzen.

## Entscheidungen an der Aufgabe festhalten

Öffne die Aufgabe, um Beschreibung, Anhänge, Termine, Labels, Teilaufgaben oder Kommentare zu ergänzen. Halte Fragen, Entscheidungen und Rückmeldungen in Kommentaren fest, die spätere Prüfer nachvollziehen können.

Mit `@` im Kommentarfeld öffnest du die Erwähnungsauswahl. Eine Erwähnung des zuständigen Agenten ist eine Anweisung: Sie kann einen laufenden Agenten steuern oder einen neuen Lauf auslösen, wenn er gerade nicht arbeitet. Ein Kommentar ohne Erwähnung hält die Diskussion fest, ohne diese Agentenaktion anzufordern.

Nutze **Teilaufgaben** für Ergebnisse, die sich einzeln prüfen lassen. Solange Teilaufgaben offen sind, lässt sich die übergeordnete Aufgabe nicht abschließen. Unter **Abhängigkeiten** siehst du, welche Aufgaben diese Aufgabe blockieren und welche sie selbst blockiert. Kreisförmige Abhängigkeiten sind nicht zulässig.

## Das Ergebnis vor dem Abschluss prüfen

Vergleiche bei menschlicher Arbeit das Ergebnis mit dem Abschlusskriterium in der Beschreibung. Lies bei Agentenarbeit den Bericht in den Kommentaren und prüfe die erzeugten Dateien. Ein beendeter Lauf bedeutet, dass der Agent nicht mehr arbeitet; die menschliche Abnahme steht noch aus.

Setze die Aufgabe auf **Erledigt**, sobald sie die Anforderung erfüllt. Soll ein Agent nacharbeiten, beschreibe die nötige Änderung in einem Kommentar und erwähne ihn darin. [Aufgaben automatisieren](/de/platform/projects/task-automation) erklärt Wiederholungen, Nacharbeit und Abbruch.

## Aufgaben finden, die Aufmerksamkeit brauchen

Grenze das Board mit **Filter** ein oder wechsle zur **Liste**, um Zeilen zu überfliegen. Lass Vorschläge im [Backlog](/de/platform/projects/backlog), bis sie begonnen werden sollen. Nutze Labels für Unterscheidungen, die keinen eigenen Status brauchen.

Prüfe bei einer abgelehnten Änderung zuerst den Zustand der Aufgabe: Ein aktiver Agentenlauf verhindert die Neuzuweisung, offene Teilaufgaben verhindern den Abschluss, und der Projektzugriff entscheidet über deine Bearbeitungsrechte.
