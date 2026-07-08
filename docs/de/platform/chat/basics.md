---
title: Chat-Grundlagen
description: Was zwischen dem Druck auf Senden und der landenden Antwort passiert — Composer, Agent-Wahl, Modell-Auflösung, Streaming, Zitate, und wie ein Chat gespeichert wird.
---

Diese Seite ist das mentale Modell für alles im Chat-Tab. Sie benennt die Teile des Composers, verfolgt eine Nachricht vom Tastendruck bis zur gestreamten Antwort und erklärt, wie ein Chat gespeichert wird, sobald er landet — lies sie einmal, und die übrigen Chat-Seiten lesen sich als Variationen desselben Ablaufs.

<Frame caption="Der Chat-Tab mit einer gestreamten Antwort über dem Composer.">

![Ein Chat-Thread zeigt eine Nutzerfrage zu Onboarding-Feedback und eine Assistenten-Antwort mit einer Markdown-Tabelle aus drei Themen.](/images/platform/chat-thread-reply.webp)

</Frame>

## Der Composer

Der Composer ist der Eingabestreifen am unteren Bildschirmrand. Drei Bedienelemente zählen: der Agent-Picker links, der Modell-Picker daneben und das Nachrichtenfeld mit **Nachricht senden** rechts. Anhänge kommen per Einfügen, Drag-and-drop oder über den Anhang-Knopf herein — was akzeptiert wird, steht unter [Anhänge](/de/platform/chat/attachments).

<Frame caption="Die drei Bedienelemente des Composers — Agent-Picker, Modell-Picker, Nachrichtenfeld.">

![Der Composer-Streifen des Chats zeigt den Agent-Picker, den Modell-Picker und den Senden-Knopf.](/images/platform/chat-composer.webp)

</Frame>

## Einen Agent wählen

Der Agent-Picker filtert nach Namen, während du tippst; der Standard ist ein agentenloser **Assistent**, der das Standard-Chatmodell der Org und kein zusätzliches Wissen und keine Tools nutzt. Wählst du einen Agent vor der ersten Nachricht, bleibt er für den ganzen Chat gesetzt; wählst du einen mitten im Chat, gilt er ab der nächsten Nachricht.

<Note>

Einen Schalter zurück zu „ohne Agent" gibt es nicht — wähl **Assistent**, um zurückzukehren. Die vollständigen Regeln stehen unter [Agents im Chat](/de/platform/chat/agents-in-chat).

</Note>

## Ein Modell wählen

Der Modell-Picker listet, was der Agent (oder die Org, wenn kein Agent gewählt ist) erlaubt. Jedes Modell trägt einen Tag — **Chat**, **Vision**, **Bildgenerierung**, **Embedding** —, der signalisiert, wofür es taugt. **Auto** wählt das Primärmodell des Agents; ist das Primärmodell rate-limitiert oder nicht erreichbar, fällt Tale entlang der Failover-Reihenfolge des Agents zurück.

<Warning>

Wählst du ein Modell ohne Vision, während die Nachricht ein Bild enthält, fällt das Bild stillschweigend weg — die Antwort liest sich, als wäre das Bild nie gesendet worden.

</Warning>

## Die Antwort lesen

Die Antwort streamt Token für Token herein. Denkt der Agent nach, bevor er antwortet, erscheint eine einklappbare Denkzeile über der Antwort. Tool-Aufrufe rendern als eingeklappte Boxen, die du aufklappen kannst, um zu lesen, was der Agent getan hat; die Ausgabe von **Code ausführen** landet rechts im Canvas, als **Code-Ausgabe** in seinem Dateibaum. Ruft der Agent Wissen ab, hängen sich Zitate an die Sätze, die sie stützen — beim Hovern über ein Zitat erscheint der Quelltitel, ein Klick öffnet die Quelle. Die Instructions des Agents erscheinen nie in der gerenderten Antwort; sie sitzen eine Schicht tiefer und formen Verhalten statt Text.

## Fragen vom Agent

Ein Agent mit dem Human-Input-Tool kann mitten in einer Aufgabe innehalten und dich etwas fragen — eine **Frage**-Karte erscheint im Chat mit den Feldern, die der Agent braucht, und die Generierung wartet, bis du antwortest. Füll das Formular aus und klick **Antwort absenden**, oder klick **Anders antworten**, um stattdessen in freiem Text zu widersprechen. War deine Antwort falsch oder unvollständig, klick auf der beantworteten Karte **Antwort bearbeiten** — das Formular öffnet sich vorausgefüllt, und **Antwort aktualisieren** lässt den Agent erneut laufen, wobei die korrigierte Antwort die alte ersetzt. Die Karte behält jede frühere Antwort: Blätter mit den Pfeilen neben der Antwort durch die Versionen, genau wie bei bearbeiteten Nachrichten.

## Konversationen versus Chats

Innerhalb von Chat ist die Einheit ein **Chat** — das Wort, das jede Schaltfläche und jeder Toast verwendet. Das Datenmodell dahinter heißt `threads`, und der URL-Slug ist `threads/$threadId`; die Docs folgen der UI und sagen in der Prosa „Chat". Die Kundenkanal-Inbox, die eine installierte E-Mail-Automatisierung hinzufügt, ist eine andere Oberfläche — eine Konversation dort ist ein Kunden-Thread, kein Chat; die Inbox-Bedeutung steht unter [Mitgelieferte Automatisierungen](/de/platform/automations/builtin).

## Verlauf und Suche

**Verlauf anzeigen** über dem Composer öffnet die Verlaufs-Sidebar — jeder Chat, den du in dieser Org fortsetzen kannst, der neueste zuoberst; eine Auswahl öffnet das volle Transkript. Die Suche dort filtert nach Titel; Volltextsuche über Nachrichtentexte ist eine Pro-Chat-Operation, nicht org-weit. Einen Chat umzubenennen setzt einen eigenen Titel, der den modellgenerierten überschreibt; einen Chat zu löschen verschiebt ihn in den [Papierkorb](/de/platform/admin/governance/trash), wo die Aufbewahrung ihn nach der Schonfrist wegräumt.

## Wo das hineinpasst

Chat-Grundlagen ist die Seite, die alles andere in diesem Abschnitt verfeinert: [Agents im Chat](/de/platform/chat/agents-in-chat) vertieft den Picker, [Anhänge](/de/platform/chat/attachments) den Upload, [Sprachmodus](/de/platform/chat/voice-mode) die STT- und TTS-Übergaben rund um denselben Composer. Wenn du hier bist, um einen Agent zu bauen statt einen zu nutzen, spring zu [Agent-Konzepte](/de/platform/agents/concepts) — das Vier-Knöpfe-Modell ist die Grundlage, auf der jeder Chat mit einem Agent steht.
