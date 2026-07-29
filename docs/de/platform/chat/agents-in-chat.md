---
title: Agents im Chat
description: Wie der Agent-Picker im Chat funktioniert — welche Agents auftauchen, was ein Agent zur Antwort beiträgt, wie lange eine Wahl gilt, der Wechsel mitten im Chat und Sub-Agent-Aufrufe.
---

Einen Agent im Chat zu wählen ist der Unterschied zwischen einer allgemeinen Auskunft und einer Antwort aus einer Fachrichtung, die deine Organisation geformt hat. Der Picker ist das meistgenutzte Bedienelement in der Eingabezeile, und seine Regeln sind zehn Minuten wert: welche Agents erscheinen, was sich mit einer Wahl ändert, wie lange sie gilt und was mit dem Gespräch passiert, wenn du mittendrin wechselst. Diese Seite beschreibt die Nutzungsseite; einen Agent zu bauen steht unter [Agent-Konzepte](/de/platform/agents/concepts).

## Der Agent-Picker

Öffne den Agent-Chip in der Eingabezeile, und der Picker listet die Agents, auf die du Zugriff hast, mit einem Suchfeld, das während des Tippens nach Namen filtert. Die Liste ist flach — Agents sind nicht in Typen sortiert, und kein Eintrag antwortet von sich aus oder reicht die Nachricht an jemand anderen weiter. Wen der Chip nennt, der beantwortet deine nächste Nachricht.

Ob ein Agent hier überhaupt auftaucht, entscheidet seine Sichtbarkeit. Sie herunterzudrehen schaltet den Agent nicht ab: Automatisierungen können ihn weiterhin ausführen, und andere Agents können weiterhin an ihn delegieren. Es hält nur den Picker kurz — was zählt, sobald eine Org Dutzende Hilfs-Agents angesammelt hat, die niemand von Hand wählt.

## Was ein Agent mitbringt

Ein Agent ist ein kleines, lesbares Objekt. Er trägt einen Namen und eine Beschreibung, die Instructions, die seine Antworten formen, eine Sichtbarkeit, die Tools und Skills, die er aufrufen darf, und den Wissensbereich, den er erreichen darf. Diese Liste ist der ganze Agent.

<Note>

Ein Agent trägt kein Modell. Das Modell kommt aus dem Modell-Picker daneben und wird pro Zug gewählt — derselbe Agent kann morgens über ein schnelles Modell antworten und über ein stärkeres, sobald die Frage schwierig wird. Den Modell-Picker und seine zwei Gruppen beschreibt [Chat-Grundlagen](/de/platform/chat/basics).

</Note>

## Wann eine Wahl bleibt

Wählst du einen Agent vor der ersten Nachricht, ist er der Agent dieses Chats — jede folgende Nachricht geht an ihn, bis du die Wahl änderst. Wählst du einen mitten im Chat, gilt er ab der nächsten Nachricht. Eine Geste für „einmal benutzen und zurück" gibt es nicht: Um den Chat zurückzugeben, wähl den anderen Agent ausdrücklich.

Das Transkript hält fest, welcher Agent welche Nachricht beantwortet hat. Ein Chat mit einem Wechsel mittendrin liest sich deshalb wie zwei Agents an derselben Aufgabe und nicht wie ein Agent, der seine Meinung ändert.

## Mitten im Chat wechseln

Instructions, Tools und Wissen des Agents wechseln mit dem Picker. Der Gesprächsverlauf nicht. Der neue Agent liest alles, was vorher kam — deine Nachrichten, die Antworten des vorherigen Agents und die Tool-Aufrufe dazwischen — und macht von dort aus weiter.

Das macht Übergaben billig. Ein Generalist nimmt die erste Frage, du wechselst für die Rückfrage zur Spezialistin, und sie hat den vollen Kontext, ohne dass jemand eine Zusammenfassung einfügt. Umgekehrt erbt der neue Agent auch jeden Fehler im Transkript: Ist ein Thread aus dem Ruder gelaufen, ist ein frischer Chat besser als ein Agentwechsel im kaputten.

## Sub-Agent-Aufrufe

Ein Agent, dem ein Sub-Agent-Tool gegeben wurde, kann einen Teil der Arbeit delegieren, ohne dass du etwas wählst. Die Delegation rendert in der Antwort als eingeklappter Tool-Aufruf — du siehst, was übergeben wurde und was zurückkam, statt ein zweites Gespräch lesen zu müssen. Die verbindlichen Anweisungen der Organisation greifen einmal zu Beginn des Zuges und nicht erneut in jedem verschachtelten Aufruf, damit ein delegierender Agent die Stimme der Org nicht durch Verschachtelung verdoppelt.

## Wo welche Oberfläche passt

Chat ist einer von drei Orten, an denen ein Agent antwortet, und der Unterschied liegt in der Zuständigkeit, nicht im Können.

| Nimm … wenn                                           | Chat | Projekte | Konversationen |
| ----------------------------------------------------- | ---- | -------- | -------------- |
| Persönliche Aufgabe, einmalige Frage                  | ✓    |          |                |
| Geteilter Arbeitsraum im Team, wiederkehrende Threads |      | ✓        |                |
| Eingehend aus einem Kontaktkanal (E-Mail, Webhook)    |      |          | ✓              |

## Wo das hineinpasst

Agents im Chat ist die Nutzerhälfte der Agent-Geschichte — was der Picker listet, was ein Agent zur Antwort beiträgt, wie lange eine Wahl gilt und was einen Wechsel überlebt. Die Bauhälfte ist [Agent-Konzepte](/de/platform/agents/concepts): was in die Instructions gehört, welche Tools ein Agent bekommt und wie du sein Wissen eingrenzt. Fehlt dir im Picker genau der Agent, den du dir immer wieder wünschst, ist das die nächste Seite; willst du stattdessen die Antwort selbst verstehen, geh zurück zu [Chat-Grundlagen](/de/platform/chat/basics).
