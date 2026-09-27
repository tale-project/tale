---
title: Aufgaben auf dem Projektboard verwalten
description: Erstelle Aufgaben, lege Verantwortliche fest, verfolge den Fortschritt und prüfe die Ergebnisse an einem Ort.
---

Eine Aufgabe hält zusammen, worum es bei einer Arbeit geht: Ziel, Zuständigkeit, Status, Dateien und die Diskussion zum Ergebnis. Nutze das Projektboard sowohl für menschliche Arbeit als auch für Aufgaben, die du einem Agenten überträgst. Zum Ändern von Aufgaben brauchst du Bearbeitungszugriff auf das Projekt, und das Projekt muss aktiv sein: Ein archiviertes Projekt bleibt schreibgeschützt, bis ein Administrator es wiederherstellt.

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

Erwähnungen in der Beschreibung der Aufgabe wirken beim Speichern genauso: Die genannten Personen werden benachrichtigt, und ein genannter Agent wird gesteuert oder startet einen Lauf, wie oben beschrieben. Startet er einen Lauf, wechselt die Aufgabe nach **In Bearbeitung**, egal in welcher Spalte du sie angelegt hast. Bearbeitest du die Beschreibung später, zählen nur die Erwähnungen, die du hinzufügst. Formulierst du den Text um eine bestehende Erwähnung herum um, wird niemand erneut benachrichtigt. Der Agent liest die Beschreibung so, wie sie beim Start seines Laufs lautet. Änderst du sie, solange der Lauf noch wartet, arbeitet er also mit deiner neuen Fassung.

Nutze **Teilaufgaben** für Ergebnisse, die sich einzeln prüfen lassen. Eine Teilaufgabe nennt oben in ihren Details die übergeordnete Aufgabe (**Teil von …**); klicke darauf, um zu ihr zurückzukehren. Solange Teilaufgaben offen sind, lässt sich die übergeordnete Aufgabe nicht abschließen. Unter **Abhängigkeiten** siehst du, welche Aufgaben diese Aufgabe blockieren und welche sie selbst blockiert. Kreisförmige Abhängigkeiten sind nicht zulässig.

## Das Ergebnis vor dem Abschluss prüfen

Vergleiche bei menschlicher Arbeit das Ergebnis mit dem Abschlusskriterium in der Beschreibung. Lies bei Agentenarbeit den Bericht in den Kommentaren und prüfe die erzeugten Dateien. Ein beendeter Lauf bedeutet, dass der Agent nicht mehr arbeitet; die menschliche Abnahme steht noch aus.

Setze die Aufgabe auf **Erledigt**, sobald sie die Anforderung erfüllt. Soll ein Agent nacharbeiten, beschreibe die nötige Änderung in einem Kommentar und erwähne ihn darin. [Aufgaben automatisieren](/de/platform/projects/task-automation) erklärt Wiederholungen, Nacharbeit und Abbruch.

## Deine Aufgaben aus Start öffnen

[Start](/de/platform#home) listet die offenen Aufgaben, die dir zugewiesen sind oder auf dein Review warten, aus allen Projekten, die du lesen darfst; **Aufgaben** über der Liste zeigt nur sie. Öffnest du dort eine Aufgabe, erscheint sie als eigene Seite neben der Seitenleiste von **Start** und nicht im Dialog des Boards:

- Oben steht der Auftrag als Karte: Beschreibung, Anhänge und Teilaufgaben.
- Darunter folgt die Diskussion wie ein Gespräch, mit den ältesten Einträgen zuerst und nach Tagen gegliedert. Sie verbindet die Kommentare mit dem Verlauf der Aufgabe, etwa Statuswechseln, Zuweisungen und Agentenläufen.
- Das Kommentarfeld steht ganz unten. Zum Senden drückst du **⌘+Enter** oder **Ctrl+Enter** oder klickst auf die runde Senden-Schaltfläche; **Enter** allein beginnt eine neue Zeile. Mit `@` erwähnst du einen Agenten oder eine Person, mit derselben Wirkung wie im Dialog des Boards. Was du noch nicht gesendet hast, bleibt für diese Aufgabe im Feld stehen, hier wie im Dialog des Boards. Solange du woanders arbeitest, zeigt die Zeile der Aufgabe in **Start** den Hinweis **Entwurf**.
- **Details** neben der Diskussion enthält Status, Priorität, Zuständigkeit, Reviewer, Termine, Labels und Abhängigkeiten, dazu **Verfolgen** und **Archivieren**. Inhaber und Administratoren der Organisation finden dort zusätzlich **Löschen**: Es entfernt die Aufgabe samt Teilaufgaben, Kommentaren und Dateien endgültig und stoppt ihre laufenden Agentenläufe. **Details ausblenden** am Ende der Kopfzeile blendet diesen Bereich aus, **Details einblenden** holt ihn zurück. Ist das Fenster zu schmal für beides nebeneinander, öffnet **Details einblenden** die Details stattdessen in einem Fenster über der Diskussion — von der Seite oder, auf dem Smartphone, vom unteren Bildschirmrand.

**Board** in der Kopfzeile öffnet das Aufgaben-Board des Projekts. Öffnest du eine Aufgabe dort, erscheint sie weiterhin im Dialog des Boards; beide Ansichten bearbeiten dieselbe Aufgabe. **Link kopieren**, das Link-Symbol neben **Board**, kopiert den Link zu dieser Aufgabenseite. Die Kennung der Aufgabe, etwa `WEB-2`, kopierst du mit einem Klick darauf in der Zeile unter dem Titel. Eine kurze Meldung bestätigt jede Kopie.

## Aufgaben finden, die Aufmerksamkeit brauchen

Grenze das Board mit **Filter** ein oder wechsle zur **Liste**, um Zeilen zu überfliegen. Lass Vorschläge im [Backlog](/de/platform/projects/backlog), bis sie begonnen werden sollen. Nutze Labels für Unterscheidungen, die keinen eigenen Status brauchen.

In den Ansichten **Board** und **Liste** erreichst du den Aufgabentitel mit **Tab**. Drücke dann **Enter**, um die Aufgabe zu öffnen.

Prüfe bei einer abgelehnten Änderung zuerst den Zustand der Aufgabe: Ein aktiver Agentenlauf verhindert die Neuzuweisung, offene Teilaufgaben verhindern den Abschluss, und der Projektzugriff entscheidet über deine Bearbeitungsrechte.
