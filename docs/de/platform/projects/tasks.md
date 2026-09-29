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

Ein Titel darf bis zu 200 Zeichen lang sein, eine Beschreibung bis zu 20.000; die meisten Emojis zählen doppelt. Eine längere Beschreibung, ob eingefügt oder von einem früheren Import in der Aufgabe hinterlassen, wird nicht gekürzt: Das Feld nennt die Grenze und zählt die Länge, und **Aufgabe erstellen** oder **Speichern** bleibt nicht verfügbar, bis du sie kürzt.

Tale vergibt eine Kennung aus dem Projektkürzel, etwa `WEB-1`. Verwende sie in Verweisen auf die Arbeit, damit ähnlich benannte Aufgaben unterscheidbar bleiben.

<Tip>

Eine hilfreiche Beschreibung nennt Ausgangsmaterial, gewünschtes Ergebnis und Abschlusskriterium. Zum Beispiel: „Vergleiche den Prüftermin im angehängten Briefing mit den Gesprächsnotizen. Halte Abweichungen in einem Kommentar fest und nenne beide Dateien als Quelle.“

</Tip>

<Frame caption="Die Aufgabendetails stellen Beschreibung, Anhänge, Teilaufgaben und Kommentare neben Zuständigkeit und Status.">

![Die Aufgabe Sign off the launch checklist zeigt den Beschreibungsbereich, Anhänge, Teilaufgaben, Kommentare, Status, Zuständigkeit, Reviewer, Termine, Wiederholung, Labels und Abhängigkeiten.](/images/platform/project-task-detail.webp)

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

Die **Aktivität** der Aufgabe hält jede Änderung mit dem Wert davor und danach fest. Leerst du ein Feld, steht dort, was übrig bleibt, etwa **Kein Fälligkeitsdatum** oder **Nicht zugewiesen**, und nicht bloß der alte Wert. Titel, Beschreibungen, Labels und Dateinamen erscheinen genau so, wie sie geschrieben wurden, auch wenn der Text einem Statusnamen wie `done` entspricht. Nur Status und Prioritäten erscheinen in deiner Sprache.

## Wiederkehrende Aufgaben einrichten

Kommt dieselbe Arbeit regelmäßig wieder, etwa ein wöchentlicher Statusbericht, gib der Aufgabe eine Wiederholung. Jedes Mal, wenn du sie abschließt, steht die nächste Aufgabe in **Zu erledigen** bereit, fällig am nächsten Tag, den die Wiederholung vorsieht.

Klicke in den Details der Aufgabe oder im Dialog **Aufgabe erstellen** auf **Wiederholen** direkt unter **Fällig am** und wähle, wie sich die Aufgabe wiederholt. Deine Wahl wird gespeichert, sobald du sie anklickst:

- **Nie**
- **Täglich**
- **Jeden Werktag**, von Montag bis Freitag
- **Wöchentlich am …**, **Monatlich am …** oder **Jährlich am …**: Sie richten sich nach dem Tag des Fälligkeitsdatums. Hat die Aufgabe keines, zählt ihr Startdatum, wenn es noch bevorsteht, sonst der heutige Tag.

<Frame caption="Wähle die Wiederholung in den Aufgabendetails; die Vorschau zeigt die nächsten Fälligkeiten.">

![Das Menü Repeat der Aufgabe Sign off the launch checklist listet Never, Daily, Every weekday, Weekly on Monday (ausgewählt), Monthly on day 28, Yearly on Sep 28 und Custom, dazu die nächsten Fälligkeiten und die Option, die nächste Aufgabe am Fälligkeitstag zu erstellen.](/images/platform/project-task-repeat.webp)

</Frame>

**Nächste Fälligkeiten** zeigt, wann die nächsten drei Aufgaben fällig werden. Hat die Aufgabe noch kein Fälligkeitsdatum, bekommt sie eines, sobald du eine Wiederholung wählst: den ersten passenden Tag ab heute oder ab ihrem Startdatum, wenn dieses später liegt. Eine monatliche Wiederholung am 31. fällt in kürzeren Monaten auf den letzten Tag des Monats. Entfernst du das Fälligkeitsdatum einer Aufgabe, die sich schon wiederholt, bleibt die Wiederholung bestehen: Die nächste Aufgabe entsteht dann, wenn du diese abschließt, fällig am ersten passenden Tag danach, und **Wiederholen** weist beim Öffnen darauf hin. Jede Änderung an der Wiederholung gibt der Aufgabe wieder ein Fälligkeitsdatum.

Liegen die Termine außerhalb des unterstützten Datumsbereichs, weist die Vorschau darauf hin. Wähle ein früheres Start- oder Fälligkeitsdatum, bevor du die Wiederholung festlegst.

### Eine eigene Wiederholung festlegen

Für jeden anderen Rhythmus wählst du in derselben Liste **Benutzerdefiniert**. Wähle **Tag**, **Woche**, **Monat** oder **Jahr**, lege fest, wie oft die Aufgabe wiederkommt, und wähle die Wochentage, den Tag im Monat oder das Datum, etwa alle 2 Wochen am Dienstag und Donnerstag. **Nächste Fälligkeiten** passt sich jeder Änderung an. Mit **Speichern** übernimmst du die Wiederholung. **Abbrechen**, **Escape** oder ein Klick außerhalb der Liste verwerfen deine Änderungen; der Pfeil zurück führt zur Liste und behält sie bei.

### Die nächste Aufgabe am Fälligkeitstag erstellen

Normalerweise entsteht die nächste Aufgabe, sobald du diese auf **Erledigt** oder **Abgebrochen** setzt. Soll die Arbeit pünktlich wiederkommen, auch wenn die letzte Runde noch nicht fertig ist, öffne **Wiederholen** bei einer wiederkehrenden Aufgabe, wähle unter den Terminen **Nächste Aufgabe am Fälligkeitstag erstellen** und klicke auf **Speichern**. Die nächste Aufgabe entsteht dann zu Beginn des Fälligkeitstags, um Mitternacht in der Zeitzone der Person, die die Wiederholung eingerichtet hat, auch wenn diese Aufgabe noch offen ist. Ist die Aufgabe schon fällig, erscheint die nächste innerhalb weniger Minuten, und schließt du die Aufgabe vor ihrem Fälligkeitstag ab, entsteht die nächste sofort. In der Aktivität der Aufgabe steht **System** als Urheber. **Wiederholen** zeigt dann ein Kalendersymbol, und der Tooltip des Wiederholungssymbols auf dem **Board** und in der **Liste** endet mit **nächste Aufgabe am Fälligkeitstag**.

Offene Aufgaben halten eine solche Serie nicht mehr auf, deshalb können sie sich stapeln, wenn niemand sie abschließt. Eine Serie hat nie mehr als 10 offene Aufgaben: Die nächste wartet, bis jemand eine davon abschließt. Änderst du die Wiederholung oder wählst erst **Nie** und dann wieder eine Wiederholung, zählen die noch offenen Aufgaben der Serie weiterhin mit.

### Was die nächste Aufgabe mitbringt

Die nächste Aufgabe hat eine eigene Kennung und beginnt in **Zu erledigen**. Sie übernimmt Titel, Beschreibung, Priorität, Labels, Anhänge, Zuständigkeit, Reviewer, die Personen, die die Aufgabe verfolgen, und die Wiederholung. Ihre Teilaufgaben kommen mit, jede wieder in **Zu erledigen** und mit Terminen, die um denselben Schritt verschoben sind, samt den Abhängigkeiten zwischen ihnen. Kommentare, Abhängigkeiten zu anderen Aufgaben, archivierte Teilaufgaben und die Dateien, die ein Agent erzeugt hat, bleiben bei der vorherigen Aufgabe. Personen kommen nur mit, solange sie noch Zugriff haben: die Zuständigkeit, solange sie noch so vergeben werden kann, der Reviewer, solange er das Projekt noch bearbeiten darf, und wer die Aufgabe verfolgt, solange er das Projekt noch sehen kann. Wer die Aufgabe nicht mehr verfolgt, verfolgt auch die nächste nicht, selbst wenn er sie erstellt hat.

Die nächste Aufgabe ist am ersten passenden Tag nach dem Fälligkeitsdatum der vorherigen fällig, und ein Startdatum liegt wieder gleich viele Tage davor. Dieses Fälligkeitsdatum liegt nie in der Vergangenheit: Schließt du eine Aufgabe verspätet ab, ist die nächste heute oder am nächsten passenden Tag fällig. So sammeln sich für verpasste Termine keine überfälligen Aufgaben an.

Unter **Wiederholen** verweist die vorherige Aufgabe auf die nächste, etwa mit **Nächste Aufgabe: WEB-13**. Öffnest du die vorherige Aufgabe wieder und schließt sie erneut ab, entsteht keine zweite. Auf dem **Board** und in der **Liste** kennzeichnet ein Wiederholungssymbol die Aufgabe, die die Serie gerade weiterführt; sein Tooltip nennt die Wiederholung.

### Eine Serie beenden

Schließt du eine wiederkehrende Aufgabe ab, nennt die Meldung **Nächste Aufgabe erstellt** das Fälligkeitsdatum der nächsten und bietet **Wiederholung beenden** an. Dieselbe Schaltfläche bleibt bei der Aufgabe, die die nächste erstellt hat, unter **Wiederholen** neben **Nächste Aufgabe**, solange sich die nächste Aufgabe noch wiederholt. Hat noch niemand die nächste Aufgabe angefasst (sie steht unverändert in **Zu erledigen**, ohne Kommentare und ohne Agentenlauf), wird sie samt ihren Teilaufgaben entfernt. Andernfalls bleibt sie bestehen und wiederholt sich nicht mehr. In beiden Fällen endet die Serie: Bei der Aufgabe, von der aus du sie beendet hast, zeigt **Wiederholen** dann **Nie**, und der Tooltip lautet **Die Serie wurde beendet.** Hast du die Schaltfläche unter **Wiederholen** verwendet, springt der Fokus danach auf **Wiederholen**. Du kannst auch bei der neuesten Aufgabe der Serie **Wiederholen** auf **Nie** stellen.

Löschst du die neueste Aufgabe einer Serie, endet die Serie. Die Aufgabe davor erstellt keine weitere, auch wenn du sie wieder öffnest und erneut abschließt: Sie zeigt kein Wiederholungssymbol, und ihr Feld **Wiederholen** bleibt gesperrt, mit dem Tooltip **Die nächste Aufgabe wurde gelöscht. Diese Aufgabe kann sich nicht noch einmal wiederholen.** Löschst du eine frühere Aufgabe, geht die Serie bei der neuesten weiter.

### Wenn sich die Wiederholung nicht ändern lässt

Zeige auf **Wiederholen** oder setze den Tastaturfokus darauf, um zu lesen, warum das Feld gesperrt ist:

- Hat eine Aufgabe ihre nächste Aufgabe schon erstellt, führt diese die Serie weiter, und die Aufgabe selbst wiederholt sich nicht mehr, auch wenn du sie wieder öffnest. Solange die Serie weitergeht, änderst du die Wiederholung bei der nächsten Aufgabe; **Nächste Aufgabe** öffnet sie. Wurde die Serie beendet oder die nächste Aufgabe gelöscht, zeigt **Wiederholen** das an.
- Jede andere Aufgabe in **Erledigt** oder **Abgebrochen** behält die Wiederholung, mit der sie abgeschlossen wurde. Öffne sie wieder, um die Wiederholung zu ändern.
- Eine Teilaufgabe hat keine eigene Wiederholung. Solange sich die übergeordnete Aufgabe wiederholt, steht bei **Wiederholen** zum Beispiel **Mit WEB-3**, und jede nächste Aufgabe der übergeordneten bringt eine neue Kopie der Teilaufgabe mit. Eine archivierte Teilaufgabe hat kein Feld **Wiederholen**: Sie kommt nicht wieder. Folgt eine Arbeit ihrem eigenen Rhythmus, braucht sie eine eigene Aufgabe.
- Eine Aufgabe, die einer Automatisierung gehört, wiederholt sich nicht. Weist du eine wiederkehrende Aufgabe einer Automatisierung zu, endet ihre Serie.
- Im Dialog **Aufgabe erstellen** zeigt das Feld **Wiederholen** den Wert **Nie**, solange **Status** auf **Erledigt** oder **Abgebrochen** steht oder eine Automatisierung zuständig ist.

## Das Ergebnis vor dem Abschluss prüfen

Vergleiche bei menschlicher Arbeit das Ergebnis mit dem Abschlusskriterium in der Beschreibung. Lies bei Agentenarbeit den Bericht in den Kommentaren und prüfe die erzeugten Dateien. Ein beendeter Lauf bedeutet, dass der Agent nicht mehr arbeitet; die menschliche Abnahme steht noch aus.

Setze die Aufgabe auf **Erledigt**, sobald sie die Anforderung erfüllt. Soll ein Agent nacharbeiten, beschreibe die nötige Änderung in einem Kommentar und erwähne ihn darin. [Aufgaben automatisieren](/de/platform/projects/task-automation) erklärt Wiederholungen, Nacharbeit und Abbruch.

## Deine Aufgaben aus Start öffnen

[Start](/de/platform#home) listet die offenen Aufgaben, die dir zugewiesen sind oder auf dein Review warten, aus allen Projekten, die du lesen darfst; **Aufgaben** über der Liste zeigt nur sie. Öffnest du dort eine Aufgabe, erscheint sie als eigene Seite neben der Seitenleiste von **Start** und nicht im Dialog des Boards:

- Oben steht der Auftrag als Karte: Beschreibung, Anhänge und Teilaufgaben.
- Darunter folgt die Diskussion wie ein Gespräch, mit den ältesten Einträgen zuerst und nach Tagen gegliedert. Sie verbindet die Kommentare mit dem Verlauf der Aufgabe, etwa Statuswechseln, Zuweisungen und Agentenläufen.
- Das Kommentarfeld steht ganz unten. Zum Senden drückst du **⌘+Enter** oder **Ctrl+Enter** oder klickst auf die runde Senden-Schaltfläche; **Enter** allein beginnt eine neue Zeile. Mit `@` erwähnst du einen Agenten oder eine Person, mit derselben Wirkung wie im Dialog des Boards. Was du noch nicht gesendet hast, bleibt für diese Aufgabe im Feld stehen, hier wie im Dialog des Boards. Solange du woanders arbeitest, zeigt die Zeile der Aufgabe in **Start** den Hinweis **Entwurf**.
- **Details** neben der Diskussion enthält Status, Priorität, Zuständigkeit, Reviewer, Termine, Wiederholung, Labels und Abhängigkeiten, dazu **Verfolgen** und **Archivieren**. Inhaber und Administratoren der Organisation finden dort zusätzlich **Löschen**: Es entfernt die Aufgabe samt Teilaufgaben, Kommentaren und Dateien endgültig und stoppt ihre laufenden Agentenläufe. **Details ausblenden** am Ende der Kopfzeile blendet diesen Bereich aus, **Details einblenden** holt ihn zurück. Ist das Fenster zu schmal für beides nebeneinander, öffnet **Details einblenden** die Details stattdessen in einem Fenster über der Diskussion — von der Seite oder, auf dem Smartphone, vom unteren Bildschirmrand.

**Board** in der Kopfzeile öffnet das Aufgaben-Board des Projekts. Öffnest du eine Aufgabe dort, erscheint sie weiterhin im Dialog des Boards; beide Ansichten bearbeiten dieselbe Aufgabe. **Link kopieren**, das Link-Symbol neben **Board**, kopiert den Link zu dieser Aufgabenseite. Die Kennung der Aufgabe, etwa `WEB-2`, kopierst du mit einem Klick darauf in der Zeile unter dem Titel. Eine kurze Meldung bestätigt jede Kopie.

## Aufgaben finden, die Aufmerksamkeit brauchen

Grenze das Board mit **Filter** ein oder wechsle zur **Liste**, um Zeilen zu überfliegen. Lass Vorschläge im [Backlog](/de/platform/projects/backlog), bis sie begonnen werden sollen. Nutze Labels für Unterscheidungen, die keinen eigenen Status brauchen.

In den Ansichten **Board** und **Liste** erreichst du den Aufgabentitel mit **Tab**. Drücke dann **Enter**, um die Aufgabe zu öffnen.

Kannst du die Aufgabe bearbeiten, drückst du auf ihrem Titel die **Leertaste**, um sie aufzunehmen. Verschiebe sie mit den Pfeiltasten und lege sie mit der **Leertaste** wieder ab. **Escape** bricht das Verschieben ab und lässt die Aufgabe, wo sie war. Ein Screenreader nennt die Aufgabe beim Aufnehmen und sagt beim Verschieben ihren Status und ihre Position an.

Prüfe bei einer abgelehnten Änderung zuerst den Zustand der Aufgabe: Ein aktiver Agentenlauf verhindert die Neuzuweisung, offene Teilaufgaben verhindern den Abschluss, und der Projektzugriff entscheidet über deine Bearbeitungsrechte.
