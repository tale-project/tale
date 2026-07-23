---
title: Ausführungsprotokolle
description: Wie du die Läufe einer Automatisierung liest — die Status, der Modus, was jeden gestartet hat, die Ergebnisse pro Node und die Auswirkungen, plus eine durchgespielte Fehlersuche.
---

Jeder Start einer Automatisierung öffnet einen Lauf, und dieser Lauf schreibt weiter an sich selbst, bis er fertig ist. Er hält fest, was ihn gestartet hat, welche Version er benutzt hat, was er bekommen hat, was jede Node erzeugt hat und alles, was er außerhalb der Plattform verändert hat. Das ist die Fläche, auf die jede andere Automatisierungsseite zeigt, wenn etwas anders lief als erwartet — es lohnt sich also, einen Lauf lesen zu können, bevor du es musst.

## Die Liste der Läufe

Die Seite einer Automatisierung endet mit einer Liste **Läufe**, neueste zuerst. Jede Zeile trägt den Status des Laufs, ob es ein Test oder ein Live-Lauf war, die ausgeführte Version, den Startzeitpunkt und was ihn gestartet hat. Ein fehlgeschlagener oder wartender Lauf zeigt den Grund direkt in der Zeile statt des Starters — oft beantwortet die Liste die Frage also, ohne dass du etwas öffnen musst.

Eine Automatisierung, die noch nie gelaufen ist, sagt das, statt eine leere Tabelle zu zeigen.

## Was jeder Status bedeutet

| Status                   | Was er dir sagt                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------- |
| **In der Warteschlange** | Der Lauf existiert und wartet darauf, dass die Engine ihn aufnimmt                    |
| **Läuft**                | Die Engine arbeitet sich durch die Nodes                                              |
| **Wartet**               | Der Lauf steht auf einer menschlichen Entscheidung oder einer Antwort, die er braucht |
| **Erfolgreich**          | Jede erreichte Node ist fertig geworden und die Ausgabe wurde erzeugt                 |
| **Fehlgeschlagen**       | Eine Node lief auf einen Fehler, und nichts war so eingestellt, dass es weitergeht    |
| **Gestoppt**             | Jemand hat den Lauf abgebrochen; bereits Erledigtes wird nicht rückgängig gemacht     |

**Wartet** wird am häufigsten falsch gelesen. Es ist kein Stillstand und kein Fehler — der Lauf hält seinen Platz und macht an genau der Node weiter, an der er stehen geblieben ist, sobald die Entscheidung gefallen ist. [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) behandelt, worauf er wartet.

## Testläufe und Live-Läufe

Jeder Lauf ist als das eine oder das andere markiert, und der Unterschied ist, ob die Außenwelt berührt wurde. Ein **Test**-Lauf nutzt den deterministischen Platzhalter jedes Konnektors: Es geht keine Mail raus, kein Datensatz wird geschrieben, nichts wird abgerechnet. Ein **Live**-Lauf darf all das, weshalb ihn zu starten eine Entwickler-Berechtigung braucht und weshalb jede Auswirkung festgehalten wird.

Ein Testlauf sagt dir, ob Graph und Datenfluss stimmen. Nur ein Live-Lauf sagt dir, ob sich die Systeme draußen so verhalten haben, wie du dachtest.

## Einen Lauf lesen

Öffne einen Lauf, und du bekommst den Canvas der Automatisierung mit diesem Lauf darübergelegt, dazu die Eckdaten des Laufs: die Version, den Modus, wann er gestartet ist und wann er geendet hat.

### Ergebnisse pro Node

Jede Box auf dem Canvas trägt den Status, den der Lauf ihr gegeben hat — sie ist **Gelaufen**, wurde **Übersprungen**, ist **Fehlgeschlagen**, wurde **Nie erreicht** oder ist **Noch nicht erreicht**, solange der Lauf weitergeht. Ein Fehler ist damit eine Stelle im Graphen statt einer Zeile, die du suchen musst, und die Nodes dahinter zeigen offensichtlich, dass sie nie erreicht wurden.

Wähl eine Node, und das Panel zeigt, was mit ihr passiert ist: die **Aufgelöste Eingabe**, die sie tatsächlich bekommen hat, nachdem jedes Template ausgewertet war, und ihre **Ausgabe**. Die aufgelöste Eingabe ist das nützlichste Feld dieser Seite. Sie zeigt den Wert, den eine Referenz ergeben hat, statt der Referenz, die du geschrieben hast — so fällt ein Template auf, das still zu nichts aufgelöst wurde.

Übersprungene Nodes lohnt es sich zu lesen, statt sie zu überfliegen, denn der Grund ist verschieden: Eine Node kann durch ihre eigene Bedingung übersprungen werden, weil eine Node, von der sie abhängt, übersprungen wurde, weil sie der Sonst-Zweig einer gelaufenen Node ist, oder weil sie unter einer Einstellung fehlschlug, die den Lauf weiterlaufen lässt.

### Auswirkungen

Ein Lauf bewahrt außerdem die geordnete Liste von allem, was er außerhalb der Plattform verändert hat — jeder Eintrag nennt die verursachende Node, die aufgerufene Integration und die Eingabe, mit der sie aufgerufen wurde. Ein Lauf, der außerhalb der Plattform nichts verändert hat, sagt das ausdrücklich, und das ist eine echte Antwort statt eines leeren Abschnitts.

Die Liste der Auswirkungen macht einen Lauf nachträglich prüfbar. Wenn jemand fragt, ob eine Nachricht tatsächlich rausging, ist das die Liste, die antwortet — und sie bleibt dauerhaft beim Lauf.

## Warum ein langer Lauf sich nicht wiederholt

Ein Live-Lauf läuft nicht in einem Zug durch. Er geht Node für Node vor, und jede abgeschlossene Node wird festgehalten, bevor die nächste beginnt. Erreicht der Lauf das Zeitfenster der Plattform, gibt er sich zurück und setzt bei der letzten abgeschlossenen Node fort. Eine bereits gelaufene Node wird nie ein zweites Mal erreicht — das hindert einen unterbrochenen Lauf daran, dieselbe Nachricht zweimal zu senden.

Dieselben Checkpoints decken einen Lauf ab, dessen Fortsetzung verloren ging. Ein Lauf, der über eine Schonfrist hinaus in einem nicht abgeschlossenen Zustand liegt, wird von selbst wieder aufgenommen und setzt dort fort, wo seine Checkpoints ihn verorten — statt neu zu starten oder für immer unfertig liegen zu bleiben.

## Eine durchgespielte Fehlersuche

Die tägliche Erinnerung ging nicht raus. Öffne die Automatisierung und sieh in die Liste **Läufe**: Der Lauf von heute Morgen steht da und ist **Fehlgeschlagen**, mit dem Grund in der Zeile.

Öffne ihn. Der Canvas zeigt die ersten drei Nodes als gelaufen, die vierte als fehlgeschlagen und alles danach als nie erreicht — die Frage ist damit schon auf eine Box eingegrenzt. Wähl die fehlgeschlagene Node und lies ihre **Aufgelöste Eingabe**: Der Kundenname ist da, die Rechnungs-id ist ein leerer Text. Das zeigt eine Node weiter nach oben.

Wähl diese Node und lies ihre Ausgabe. Sie hat einen Datensatz ohne Feld `id` zurückgegeben, weil das gelesene Feld umbenannt worden war. Das Template darauf ergab nichts, und die Node dahinter scheiterte am leeren Wert statt an irgendetwas an sich selbst.

<Tip>

Lies die Liste der Auswirkungen, bevor du etwas reparierst. Sie sagt dir, ob der Lauf weit genug kam, um die Außenwelt zu berühren — und davon hängt ab, ob ein erneuter Lauf harmlos ist oder erst aufgeräumt werden muss.

</Tip>

Korrigier die Referenz im Node-Panel, speichere eine Version mit einer Notiz, die das umbenannte Feld nennt, und drück **Testlauf**. Der Testlauf geht denselben Graphen durch, und diesmal zeigt jede Box, dass sie gelaufen ist. Schalt diese Version live, und der Zeitplan von morgen nimmt sie auf.

## Einen Lauf stoppen

Solange ein Lauf nicht fertig ist, kannst du ihn stoppen, und ein gestoppter Lauf ist endgültig — die Engine prüft an jeder Node-Grenze und plant die nächste nicht mehr ein. Bereits Erledigtes wird nicht zurückgenommen, weil es das nicht kann: Eine gesendete Nachricht ist gesendet. Lies die Liste der Auswirkungen, um zu sehen, wie weit er kam, bevor du entscheidest, was als Nächstes passiert.

## Wo das hingehört

Ein Lauf ist die Quittung, die eine Automatisierung hinterlässt: Sein Status sagt, was passiert ist, seine Ergebnisse pro Node sagen wo, seine aufgelösten Eingaben sagen warum, und seine Auswirkungen sagen, was er außerhalb der Plattform verändert hat. Kombinier diese Seite mit [Workflow-Trigger](/de/platform/automations/triggers) für die Startarten, die diese Einträge öffnen, und mit [Audit-Logs](/de/platform/admin/governance/audit-logs) für die organisationsweite Spur, wer was geändert hat.
