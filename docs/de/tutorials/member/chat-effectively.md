---
title: Eine nützliche Chat-Antwort erhalten
description: Übe eine gezielte Frage, prüfe den Quellenbeleg und verbessere die Antwort mit einer Rückfrage.
---

Eine nützliche Chat-Antwort beginnt mit einer klaren Frage und endet mit einer Quellenprüfung. Nutze für diese Übung ein kurzes Dokument, das du hochladen darfst. Frage nach einer enthaltenen Information und prüfe anschließend, ob der Assistent zwischen belegten Aussagen und offenen Punkten unterscheidet.

Du brauchst Zugriff auf Chat und ein verfügbares Modell. Für Dokumentfragen muss außerdem die Wissensindexierung der Organisation funktionieren. Ein geeignetes, bereits indexiertes Dokument kannst du statt des Beispiels verwenden.

## Eine kleine Quelle vorbereiten

Speichere diesen Text auf deinem Gerät als `launch-brief.txt`:

```text
Briefing zur neuen Website
Die Kundenprüfung findet am 18. September 2026 statt.
Maya Chen ist für die Prüfliste zuständig.
Der Veröffentlichungstermin ist noch nicht freigegeben.
Die Prüfung muss Barrierefreiheit, Weiterleitungen und das Kontaktformular abdecken.
```

Öffne einen neuen Chat und hänge die Datei über **Fotos & Dateien hinzufügen** im Menü des Nachrichtenfelds an. Warte auf das Ende von Upload und Indexierung, bevor du zum Text fragst. [Chat-Anhänge](/de/platform/chat/attachments) erklärt die angezeigten Zustände.

## Nach einem konkreten Ergebnis fragen

Sende:

```text
Nenne anhand von launch-brief.txt den Prüftermin, die zuständige Person und
die drei Prüfthemen. Belege die Antwort mit der Quelle. Nutze vier Stichpunkte.
```

Die Frage nennt Quelle, benötigte Informationen und Ergebnisform. Dadurch lässt sich die Antwort leichter prüfen als bei „Erzähl mir etwas über die neue Website“. **Auto** eignet sich als Ausgangspunkt. Wähle ein Modell ausdrücklich, wenn du sein Verhalten mit einem anderen vergleichen möchtest.

<Frame caption="Behalte die Frage im Blick, während du prüfst, ob die Antwort sie erfüllt.">

![Ein Chat zeigt eine gezielte Frage zum Onboarding-Feedback und eine tabellarisch gegliederte Antwort.](/images/platform/chat-thread-reply.webp)

</Frame>

## Die Antwort mit der Datei vergleichen

Der Prüftermin muss der **18. September 2026** sein, die zuständige Person **Maya Chen**. Die Themen sind **Barrierefreiheit, Weiterleitungen und das Kontaktformular**. Öffne die zitierte Quelle und vergleiche diese Angaben. Die Formatierung darf variieren, die Fakten nicht.

Fehlt ein Beleg, bitte um eine Quellenangabe zum Dokument, statt anzunehmen, dass der Anhang gelesen wurde. Findet der Assistent den Inhalt nicht, prüfe den Indexierungsstatus und versuche es erneut, sobald die Datei bereit ist. Eine flüssige Antwort beweist keinen Quellenabruf.

## Mit einer Rückfrage Unsicherheit sichtbar machen

Frage im selben Gespräch:

```text
Wann ist der freigegebene Veröffentlichungstermin? Falls das Briefing
keinen nennt, sage das ausdrücklich.
```

Die Quelle nennt **keinen** freigegebenen Veröffentlichungstermin. Eine gute Antwort bewahrt diesen Unterschied, statt den Prüftermin als Veröffentlichungstermin zu übernehmen. Macht die Antwort eine unbelegte Annahme, verweise auf den widersprechenden Satz und bitte um Korrektur.

<Tip>

Ändere jeweils einen Teil deiner Frage. „Kürzer“ prüft die Länge; „Trenne bestätigte Termine von offenen Entscheidungen“ prüft das Verständnis. Wenn du Quelle, Modell, Frage und Format gleichzeitig änderst, lässt sich kaum erkennen, was die Antwort verbessert hat.

</Tip>

## Den nützlichen Kontext behalten

Setze verwandte Fragen im selben Chat fort. Beginne bei einem neuen Thema einen neuen Chat, damit frühere Annahmen nicht ablenken. Brauchen mehrere Gespräche dasselbe Briefing, lege es in einem [Projekt](/de/tutorials/member/use-projects) ab und nutze Projektchats.

Lies vor dem [Teilen eines Chats](/de/platform/chat/shared-threads) die Nachrichten und Quellenzitate in der Antwort durch. Soll als Nächstes ein Ergebnis mit Zuständigkeit und Prüfung entstehen, erstelle eine [Projektaufgabe](/de/platform/projects/tasks) mit den geprüften Angaben und Abnahmekriterien.
