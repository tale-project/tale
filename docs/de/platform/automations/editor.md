---
title: Der Workflow-Editor
description: Das Betriebshandbuch zur Seite einer Automatisierung — den Canvas lesen, eine Node bearbeiten, eine Version speichern, sie gegen Mocks laufen lassen, live schalten und zurückrollen.
---

Diese Seite ist die praktische Hälfte der Automatisierungen: was du klickst und in welcher Reihenfolge, um aus einer Idee die Version zu machen, die deine Trigger ausführen. Das Modell darunter — ein Dokument, unveränderliche Versionen, genau eine live, Trigger am Namen — steht in den [Automatisierungskonzepten](/de/platform/automations/concepts), und diese Seite setzt es voraus. Speichern, Testen und Live-Schalten sind hier drei getrennte Schritte, und genau diese Trennung erlaubt dir, eine laufende Automatisierung zu bearbeiten, ohne einen einzigen laufenden Job zu stören.

## Wo eine Automatisierung lebt

Öffne **Automatisierungen** in der Seitenleiste. Die Liste zeigt jede Automatisierung der Organisation mit der Anzahl ihrer Versionen und entweder der Version, die live ist, oder **Nicht live**, solange es keine gibt. Klick eine an, und du landest auf ihrer Seite.

Diese Seite ist ein Arbeitsplatz, keine Reihe von Tabs. Der Name trägt das Badge **Live**, wenn die Version auf dem Canvas live ist. **Version**, **Testlauf**, **Live ausführen**, **Verwerfen** und **Speichern** stehen rechts — **Diese Version live schalten** sitzt neben **Version**, wenn die Auswahl nicht live ist. Neben dem Canvas zeigt das Panel **Trigger** und **Projekte** — welche Projekt-Task-Boards die Automatisierung sehen; keines heißt die ganze Organisation — bis du eine Box anklickst. Das Panel ist so hoch wie der Canvas, der das Fenster unter der Kopfzeile füllt. Wählst du eine Node, bleibt der Canvas gleich hoch — überzählige Felder scrollst du im Panel. Klick **Schließen**, drück Escape, klick die ausgewählte Box noch einmal, oder in den leeren Canvas, und sie kommen zurück. **Versionen** und **Läufe** liegen darunter.

## Den Canvas lesen

Der Canvas zeichnet die Version, die du gerade ansiehst. Jede Box ist eine Node, beschriftet mit ihrer id und ihrem Typ, und Boxen, die die Ausgabe einer anderen Node lesen, sagen das: Eine Zeile **Liest** nennt die Nodes, von denen sie abhängen. Die Pfeile dazwischen zeichnest du nicht selbst — ein Pfeil existiert, weil das Feld einer Node die Ausgabe einer anderen referenziert. Der Graph passt deshalb immer zum Dokument.

Die Ablaufsteuerung erscheint als Badge an der Box, für die sie gilt, im selben Vokabular wie im Dokument: `wenn …`, `sonst zu …`, `für jedes …`, `wiederholen bis …` (mit dem Deckel, wo es einen gibt) und `bei Fehler weiterlaufen`. Nichts an der Form des Graphen versteckt sich in einem separaten Einstellungsdialog.

Zwei Zustände lohnen sich zu kennen. Eine Version ohne Nodes sagt das und weist dich darauf hin, dem Dokument eine hinzuzufügen. Eine Version, deren Nodes im Kreis aufeinander verweisen, warnt dich, dass die gezeigte Reihenfolge die ist, in der sie im Dokument stehen, und nicht eine, die die Engine ausführen könnte — und bittet dich, eine der Referenzen zu entfernen, um den Kreis aufzubrechen.

Ein Agent, der ein Modell ohne festen Anbieter nennt, warnt auf seiner Box. Lege den Anbieter am Node fest, speichere und schalte die neue Version live.

<Note>

Der Canvas dient zum Lesen und Auswählen. Du verbindest Nodes, indem du sie referenzierst, nicht indem du eine Linie zwischen zwei Boxen ziehst.

</Note>

## Eine Node bearbeiten

Klick eine Box an, und das Panel neben dem Canvas wechselt von **Trigger** zu den Feldern dieser Node. Klick **Schließen**, drück Escape (wenn du nicht in einem Feld tippst), klick die Box noch einmal, oder in den leeren Canvas, um zurückzuwechseln. Welche Felder auftauchen, hängt vom Typ ab: **Code** bei einer `transform`, **Prompt**, **System-Prompt**, **Modell** und **Ausgabeschema** bei einer `llm`, **Automatisierung** bei einer `subautomation`, und ein `agent` ergänzt seine Ausstattung — **Agent-Laufzeit**, **Skills**, **Connectors**, **Plattform-Tools**, **Secrets** und **Bereitgestellte Dateien** — um Prompt und Modell, die er sich mit `llm` teilt. **Eingabe** taucht überall dort auf, wo es eine gibt, und die typabhängigen Felder sitzen darüber.

**Eingabe** ist ein JSON-Objekt, und dort leben die Referenzen. Ein Text-Wert darf die Ausgabe einer anderen Node referenzieren, und genau diese Referenz zeichnet den Pfeil auf dem Canvas. Solange das JSON unvollständig ist, sagt dir das Panel, dass es noch nicht gültig ist, und lässt die Node unverändert — eine halb getippte Änderung lässt sich so nie versehentlich speichern.

Öffne **Ablaufsteuerung** für **Wenn**, **Sonst zu**, **Für jedes** und **Wiederholen bis**. Es sind dieselben Felder, die die Badges auf dem Canvas spiegeln: Setzt du hier eines, ändert sich das Badge sofort. Die Gruppe ist aufgeklappt, sobald eines davon gesetzt ist.

## Speichern, starten, live schalten

Die drei Schritte sind bewusst getrennt. Geh sie beim ersten Mal der Reihe nach durch, dann fühlt sich die Trennung nicht mehr nach Mehrarbeit an.

<Steps>

<Step title="Eine Version speichern">

Änderungen zeigen den Hinweis **Nicht gespeicherte Änderungen**, bis du speicherst. Klick **Speichern**, schreib eine **Notiz zur Version**, die sagt, was sich geändert hat — diese Notiz unterscheidet später als Einziges zwei Versionen in der Liste —, und bestätige **Version speichern**. Das Speichern hängt eine neue Version an und lässt jede frühere genau so, wie sie war. Hat sich nichts geändert, sagt dir die Schaltfläche das, statt eine identische Version anzulegen.

</Step>

<Step title="Gegen Mocks laufen lassen">

**Testlauf** startet einen Lauf im Testmodus: Konnektoren liefern ihre deterministischen Platzhalter, und nichts außerhalb der Plattform wird berührt. Du kannst ihn beliebig oft drücken, und genau deshalb ist er die Schleife, in der du arbeitest, solange eine Node noch Form annimmt.

Ist die Automatisierung an mehr als ein Projekt gebunden, sitzt neben den Lauf-Schaltflächen ein **Projektbereich**-Auswähler. Er steht standardmäßig auf organisationsweit; wähle eines der gebundenen Projekte, damit der Lauf — und die Aufgaben- und Dokument-Tools seiner Agents — nur in diesem Projekt wirkt.

</Step>

<Step title="Die gewünschte Version live schalten">

Wenn die Version auf dem Canvas nicht live ist, schaltet **Diese Version live schalten** neben **Version** genau diese live. Die aktuelle trägt in **Versionen** das Badge **Live**, und eine andere live zu schalten verschiebt dieses Badge, ohne den Inhalt irgendeiner Version anzufassen.

</Step>

</Steps>

<Note>

Die Schaltfläche auf dieser Seite startet immer einen Lauf gegen Mocks. Ein Lauf, der die Außenwelt erreichen darf, wird von einem Trigger oder programmatisch gestartet, und das ist eine Entwickler-Berechtigung.

</Note>

## Tests und das Tor zum Live-Schalten

Tests sind Teil des Dokuments, kein eigenes Panel. Jeder trägt einen Namen, eine Eingabe und Erwartungen an die Ausgabe sowie an die Auswirkungen, die der Lauf erzeugen soll, und sie reisen mit der Version wie jedes andere Feld.

```yaml
tests:
  - name: erinnert einen säumigen Zahler
    input: { invoiceId: 'inv-1' }
    expect:
      effects:
        - connector: email.send
```

Ob die Tests einer Version bestanden waren, wird beim Speichern festgehalten, und die Liste **Versionen** zeigt das Ergebnis als Badge **Tests bestanden** oder **Tests fehlgeschlagen**. Das Live-Schalten liest diesen Eintrag: Eine mit fehlgeschlagenen Tests gespeicherte Version wird abgewiesen, und die Seite sagt dir, dass sie nicht live geschaltet wurde, statt stillschweigend nichts zu tun. Behebe die Ursache und speichere eine neue Version — ein festgehaltenes Ergebnis ist eine Tatsache über diese Version und ändert sich nie.

## Zurückrollen

Zurückrollen heißt, eine ältere Version live zu schalten. Wähl sie oben unter **Version** — oder such sie in **Versionen**, lies die Notiz und klick sie an — und klick **Diese Version live schalten**. Das Badge wandert, die neueren Versionen bleiben unangetastet in der Liste, und kein Dokument wird umgeschrieben.

Deshalb zählen Versionsnotizen mehr, als sie aussehen. Sechs Versionen später sagt dir die Notiz, welche der letzte gute Stand war — schreib sie also für die Person, die sie während einer Störung lesen wird.

## Eine Automatisierung löschen

Löschen betrifft die Automatisierung als Ganzes: alle Versionen, das Deployment, der Trigger und die Projekt-Bindungen gehen zusammen — ein Zeitplan löst danach nicht mehr aus, eine Webhook-URL funktioniert sofort nicht mehr. Das passiert in der Liste, nicht auf dieser Seite: öffne **Automatisierungen**, das Zeilenmenü, und klicke **Löschen**. Die Bestätigung (**Automatisierung löschen**) nennt sie zuerst. Die bisherigen Läufe bleiben lesbar, bis die Aufbewahrungsfrist sie entfernt — was die Automatisierung getan hat, bleibt also nachvollziehbar.

Zwei Leitplanken. Ein Lauf, der noch aussteht, läuft oder wartet, blockiert das Löschen — brich ihn ab oder lass ihn zu Ende laufen. Und ein gelöschtes mitgeliefertes Pack bleibt über Plattform-Upgrades hinweg gelöscht; legst du unter demselben Namen neu an, lebt der Name wieder.

## Den letzten Lauf auf dem Canvas lesen

Sobald eine Automatisierung gelaufen ist, legt **Letzten Lauf einblenden** diesen Lauf über den Canvas — ein Symbol auf dem Canvas schaltet das ein (es heißt **Letzten Lauf ausblenden**, solange die Überlagerung an ist). Jede Box übernimmt den Status, den der Lauf ihr gegeben hat — sie ist **Gelaufen**, wurde **Übersprungen**, ist **Fehlgeschlagen**, wurde **Nie erreicht** oder ist **Noch nicht erreicht**, solange der Lauf weitergeht. Ein Fehler wird so als Stelle im Graphen sichtbar statt als Zeile in einem Log.

Wähl bei eingeblendetem Lauf eine Node, und das Panel ergänzt einen Abschnitt **In diesem Lauf**: die **Aufgelöste Eingabe**, die die Node tatsächlich bekommen hat, nachdem jedes Template ausgewertet war, ihre **Ausgabe** und die Auswirkungen, die sie erzeugt hat, oder den Hinweis, dass sie außerhalb der Plattform nichts verändert hat. Die aufgelöste Eingabe beantwortet meist am schnellsten die Frage, warum eine Node getan hat, was sie getan hat — sie zeigt den Wert, den eine Referenz ergeben hat, nicht die Referenz, die du geschrieben hast.

Ein Klick auf eine Zeile unter **Läufe** öffnet die Lauf-Seite, wo derselbe Canvas neben Eingabe, Ausgabe und der kompletten Liste der Auswirkungen steht. [Ausführungsprotokolle](/de/platform/automations/execution-logs) liest diese Seite von Anfang bis Ende.

## Wo das hingehört

Die Schleife ist kurz, sobald die drei Schritte klar sind: eine Node bearbeiten, eine Version mit einer lesenswerten Notiz speichern, sie gegen Mocks laufen lassen, bis sie tut, was du meintest, und sie dann live schalten — und eine ältere live schalten, wenn du etwas rückgängig machen musst. [Automatisierungskonzepte](/de/platform/automations/concepts) ist das Modell, das diese Seite bedient; [Workflow-Trigger](/de/platform/automations/triggers) ist das, was die live geschaltete Version startet, sobald du zufrieden bist.
