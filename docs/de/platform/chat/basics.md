---
title: Chat-Grundlagen
description: Was zwischen dem Druck auf Senden und der landenden Antwort passiert — die Wahl in der Eingabezeile, was das Modell bekommt, wie eine Antwort streamt und wie ein Chat gespeichert wird.
---

Diese Seite ist das mentale Modell für alles im Chat-Tab. Sie benennt die Teile des Bildschirms, verfolgt eine Nachricht vom Tastendruck bis zur gestreamten Antwort, sagt genau, was das Modell unterwegs in die Hand bekommt, und erklärt, wie ein Chat gespeichert wird, sobald er landet. Lies sie einmal, und die übrigen Chat-Seiten lesen sich als Variationen desselben Ablaufs.

<Frame caption="Der Chat-Tab mit einer gestreamten Antwort über der Eingabezeile.">

![Ein Chat-Thread zeigt eine Nutzerfrage zu Onboarding-Feedback und eine Assistenten-Antwort mit einer Markdown-Tabelle aus drei Themen.](/images/platform/chat-thread-reply.webp)

</Frame>

## Die Eingabezeile

Die Eingabezeile ist der Eingabestreifen am unteren Bildschirmrand. Drei Bedienelemente entscheiden, was zurückkommt: der Agent-Picker, der Modell-Picker daneben und das Nachrichtenfeld mit dem Senden-Knopf. Anhänge kommen per Einfügen, Drag-and-drop oder über den Anhang-Knopf herein — [Anhänge](/de/platform/chat/attachments) beschreibt, was Tale annimmt und wo ein Upload landet.

Zwei dieser drei Bedienelemente sind bewusste Entscheidungen, und keines davon hat einen Standard, der für dich mitdenkt. Der Picker zeigt, was läuft; und was er zeigt, läuft auch.

## Einen Agent wählen

Der Agent-Picker filtert nach Namen, während du tippst, und listet die Agents, auf die du Zugriff hast und die im Chat sichtbar sind. Ein Agent trägt einen Namen, eine Beschreibung, seine Instructions, eine Sichtbarkeit, die Tools und Skills, die er aufrufen darf, und den Wissensbereich, den er erreichen darf — die vollständigen Regeln stehen unter [Agents im Chat](/de/platform/chat/agents-in-chat).

Wechselst du den Agent mitten im Chat, bleibt das Gespräch erhalten. Die nächste Nachricht geht an den Agent, der jetzt im Picker steht, und dieser Agent liest alles, was vorher passiert ist.

## Ein Modell wählen

Du benennst das Modell immer selbst. Es gibt kein automatisches Routing, keine Komplexitätsbewertung, die für dich entscheidet, und keine Kette, die still ein anderes Modell einsetzt, wenn das erste langsam ist — die Antwort vor dir kam jedes Mal aus dem Eintrag, den du gewählt hast.

Der Picker sortiert seine Einträge in zwei Gruppen:

- **Modelle** — Modelle, die die Plattform direkt über ihre eigene Chat-Schleife aufruft. Das ist der gewöhnliche Weg: Die Plattform baut den Kontext, streamt die Antwort und führt die Tool-Aufrufe aus.
- **Sandbox-Agents** — Modelle, die statt in der Chat-Schleife in einem Coding-Agent-Harness in einer Sandbox laufen. Ein Harness ist ein Kommandozeilen-Agent mit eigenen Datei-Tools und eigener Schleife; die Plattform startet ihn, gibt ihm den Prompt und streamt seine Ausgabe zurück in den Chat.

Auch ein Modell aus der ersten Gruppe kannst du in eine Sandbox schieben: Schalte die Sandbox-Ausführung für diesen Zug ein, und das Modell läuft unter einem Harness statt in der direkten Schleife. Der Harness ist auf den des jeweiligen Anbieters vorbelegt und lässt sich auf einen anderen umstellen.

<Note>

Manche Credentials nehmen dir die Wahl ab. Ein Abo-Credential eines Anbieters funktioniert nur im Kommandozeilen-Agent desselben Anbieters — ein Anthropic-Abo etwa läuft ausschließlich unter dem Harness `claude-code`. Für solche Credentials ist die Sandbox-Ausführung eingeschaltet und gesperrt, und ein anderer Harness wird mit einer Begründung abgelehnt statt still umgebogen.

</Note>

## Was das Modell bekommt

Der Prompt entsteht in einer festen Reihenfolge, und die Liste ist bewusst kurz: die verbindlichen Anweisungen der Organisation, die Instructions des Agents, die Regeln für den Umgang mit nicht vertrauenswürdigen Inhalten, eine kurze Zeile Dokumentation pro verfügbarem Tool, dann der aktuelle Zeitstempel mit der Sprachvorgabe für die Antwort und schließlich der vollständige Nachrichtenverlauf — samt Tool-Nachrichten, Freigabe-Karten und Rückfrage-Karten, wobei Anhänge als Inhaltsteile mitreisen.

Mehr kommt nicht dazu. Es gibt keinen Personalisierungs-Block, keine heimlich eingeschobenen Memories, keinen automatischen Wissensabruf, keinen automatischen Web-Kontext und keinen Marken- oder Tuning-Text, der an deine Instructions gehängt wird. Alles, was das Modell über seine Instructions hinaus erfährt, erfährt es, indem es etwas aufruft — und damit steht es im Transkript, zuordenbar und ablehnbar.

<Info>

Wächst das Gespräch über das Kontextfenster des Modells hinaus, fallen die ältesten Nachrichten weg, und an ihre Stelle tritt ein sichtbarer Hinweis. Zusammengefasst wird nichts: Eine Zusammenfassung wäre ein zweiter Modellaufruf, der genau die Historie erfinden kann, die er bewahren soll. Nachrichten wegzuwerfen verliert Information auf eine Art, die du sehen kannst.

</Info>

## Was das Modell aufrufen kann

Eingebaute Tools, Integrations-Aktionen, Skills, Automatisierungen und Tools angebundener MCP-Server liegen in einer einzigen Registry hinter einem einzigen Dispatcher. Das Modell durchsucht diese Fläche und ruft einen Eintrag über seine ID auf — die Automatisierungen deiner Org sind damit genauso auffindbar wie die eingebauten Tools. Vor jedem Aufruf prüft der Dispatcher die Eingabe gegen das Schema.

Der Wissensabruf ist bewusst ein eigener Aufruf und kein weiteres Suchergebnis: Eine Tatsache zu finden und ein Tool zu finden sind verschiedene Fragen. Eine Automatisierung, die nur ein Event starten kann, steht mit genau diesem Hinweis in der Liste, und ein Aufruf scheitert mit einer Erklärung, statt aus der Ansicht zu verschwinden.

## Die Antwort lesen

Die Antwort streamt herein, während sie entsteht. Denkt das Modell nach, bevor es antwortet, erscheint eine einklappbare Denkzeile darüber. Tool-Aufrufe rendern als eingeklappte Karten, die du aufklappen kannst, um zu lesen, was lief und was zurückkam; ausgeführter Code schickt seine Ausgabe rechts ins Canvas. Ruft das Modell Wissen ab, hängen sich Zitate an die Sätze, die sie stützen — beim Hovern erscheint die Quelle, ein Klick öffnet sie. Die Instructions des Agents erscheinen nie in der gerenderten Antwort; sie sitzen eine Schicht tiefer und formen Verhalten statt Text.

## Fragen vom Agent

Ein Agent mit dem Human-Input-Tool kann mitten in einer Aufgabe innehalten und dich etwas fragen. Eine Frage-Karte erscheint im Chat mit den Feldern, die der Agent braucht, und die Generierung wartet auf deine Antwort. Füll das Formular aus und schick es ab — oder antworte in freiem Text, wenn das Formular die falsche Form für das hat, was du sagen willst. War deine Antwort falsch oder unvollständig, öffne die beantwortete Karte erneut: Das Formular kommt vorausgefüllt zurück, und beim erneuten Absenden läuft der Agent noch einmal, wobei die korrigierte Antwort die alte ablöst. Die Karte behält jede frühere Antwort, sodass du durch die Versionen blättern kannst wie bei bearbeiteten Nachrichten.

## Konversationen versus Chats

Innerhalb von Chat ist die Einheit ein **Chat** — das Wort, das jede Schaltfläche und jeder Toast verwendet. Das Datenmodell dahinter heißt `threads`, und die URL trägt `threads/$threadId`; die Docs folgen der UI und sagen in der Prosa „Chat". Die Kontaktkanal-Inbox, die eine installierte E-Mail-Automatisierung hinzufügt, ist eine andere Oberfläche: Eine Konversation dort ist ein Kontakt-Thread und kein Chat — diese Bedeutung steht unter [Mitgelieferte Automatisierungen](/de/platform/automations/builtin).

## Verlauf und Suche

Die Verlaufs-Sidebar listet jeden Chat, den du in dieser Org fortsetzen kannst, den neuesten zuoberst; eine Auswahl öffnet das volle Transkript. Die Suche dort filtert nach Titel, und die Volltextsuche über Nachrichtentexte läuft pro Chat statt org-weit. Benennst du einen Chat um, überschreibt der eigene Titel den generierten. Löschst du einen Chat, wandert er in den [Papierkorb](/de/platform/admin/governance/trash), wo die Aufbewahrung ihn nach der Schonfrist wegräumt.

## Wo das hineinpasst

Chat-Grundlagen ist die Seite, die der Rest dieses Abschnitts verfeinert: [Agents im Chat](/de/platform/chat/agents-in-chat) vertieft den Picker und den Wechsel mitten im Chat, [Anhänge](/de/platform/chat/attachments) zeigt, was aus einem Upload wird, [Sprachmodus](/de/platform/chat/voice-mode) das Sprechen statt Tippen und [Canvas-Bereich](/de/platform/chat/canvas-pane), wo lange Ausgaben landen. Wenn du hier bist, um einen Agent zu bauen statt einen zu nutzen, lies als Nächstes [Agent-Konzepte](/de/platform/agents/concepts) — die Form eines Agents ist das, worauf jeder Chat mit einem Agent steht.
