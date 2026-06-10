---
title: Chat-Grundlagen
description: Was zwischen dem Druck auf Senden und der landenden Antwort passiert — Composer, Agent-Wahl, Modell-Auflösung, Streaming, Zitate, und wie ein Chat gespeichert wird.
---

Diese Seite ist das mentale Modell für alles im Chat-Tab. Sie benennt die Teile des Composers, verfolgt eine einzelne Nachricht vom Tastendruck bis zur gestreamten Antwort und erklärt, wie ein Chat gespeichert wird, sobald er landet. Sobald du sie gelesen hast, lesen sich die übrigen Chat-Seiten als Variationen desselben Ablaufs.

Der Ablauf ist meistens unsichtbar — Tale fügt ein halbes Dutzend Subsysteme zusammen, damit sich ein Chat wie eine einzelne Konversation anfühlt — aber die Nähte zählen, wenn etwas unerwartet reagiert. Zu wissen, welches Subsystem welchen Schritt besitzt, ist der Unterschied zwischen einem nützlichen Bugreport und einem vagen.

## Der Composer

Der Composer ist der Eingabestreifen am unteren Bildschirmrand. Drei Bedienelemente zählen: der Agents-Picker links, der Modell-Picker daneben, und die Textarea mit **Nachricht senden** rechts. Der Agents-Picker zeigt jeden Agent, den die Org als **Visible in chat** markiert hat, plus einen Standard-**Assistant**, wenn kein Agent gewählt ist. Der Modell-Picker zeigt jedes chat-getaggte Modell, das die Policy des Agents erlaubt; **Auto** lässt Tale zur Request-Zeit auflösen. Anhänge kommen per Einfügen, Drag-and-drop oder Upload-Knopf herein — siehe [Anhänge](/de/platform/chat/attachments) für das, was akzeptiert wird.

## Der Agents-Picker

Der Agents-Picker filtert nach Namen, während du tippst; der Standard ist ein agentenloser **Assistant**, der das Standard-Chatmodell der Org und kein zusätzliches Wissen oder Tools nutzt. Wählst du einen Agent vor der ersten Nachricht, ist er für den ganzen Chat klebrig; wählst du einen mitten im Chat, wird er auf die nächste Nachricht und alles danach angewendet. Es gibt keinen „Zurück zu kein Agent"-Schalter — wähl **Assistant**, um zurückzukehren. Die Seite [Agents im Chat](/de/platform/chat/agents-in-chat) deckt die Regeln im Detail ab.

## Der Modell-Picker

Der Modell-Picker listet Modelle, die der Agent (oder die Org, wenn kein Agent gewählt ist) nutzen darf. Jedes Modell trägt einen Tag — **Chat**, **Vision**, **Image generation**, **Embedding** — der signalisiert, wofür es gut ist. Ein Vision-Modell zu wählen, wenn die Nachricht kein Bild hat, ist okay; ein Nicht-Vision-Modell zu wählen, wenn die Nachricht ein Bild enthält, lässt das Bild stillschweigend fallen. **Auto** wählt das primäre des Agents; wenn das primäre rate-limitiert oder nicht erreichbar ist, fällt Tale auf die Failover-Reihenfolge des Agents zurück.

## Antwort-Rendering und Zitate

Die Antwort streamt Token für Token herein. Tool-Aufrufe rendern als eingeklappte Boxen, die der User aufklappen kann, um zu lesen, was der Agent gemacht hat; Ausgaben von **Run code** landen rechts im Canvas. Wenn der Agent Wissen abruft, hängen sich Zitate an die Sätze, die sie stützen — beim Hovern über ein Zitat erscheint der Quelltitel; ein Klick öffnet die Quelle. Die Instructions des Agents erscheinen nie in der gerenderten Antwort; sie sitzen eine Schicht tiefer und formen Verhalten statt Text.

## Fragen vom Agent

Ein Agent mit dem Human-Input-Tool kann mitten in einer Aufgabe innehalten und dich etwas fragen — eine **Frage**-Karte erscheint im Chat mit den Feldern, die der Agent braucht, und die Generierung wartet, bis du antwortest. Fülle das Formular aus und klicke auf **Antwort absenden**, oder klicke auf **Anders antworten**, um stattdessen in freiem Text zu widersprechen. Die beantwortete Karte bleibt an der Stelle im Verlauf, an der die Frage gestellt wurde, sodass sich der Austausch später in der richtigen Reihenfolge liest. War deine Antwort falsch oder unvollständig, klicke auf der beantworteten Karte auf **Antwort bearbeiten** — das Formular öffnet sich vorausgefüllt, und **Antwort aktualisieren** lässt den Agent erneut laufen, wobei die korrigierte Antwort die alte ersetzt. Die Karte behält jede frühere Antwort: Blättere mit den Pfeilen neben der Antwort durch die Versionen, genau wie bei bearbeiteten Nachrichten.

## Konversationen versus Chats

Innerhalb von Chat ist die Einheit ein **Chat** — das ist das Wort, das jede Schaltfläche und jeder Toast verwendet. Das Datenmodell dahinter heisst `threads`, und der URL-Slug ist `threads/$threadId`; die Docs folgen der UI und sagen „Chat" in der Prosa. Der separate **Conversations**-Tab (einen weiter in der Sidebar) ist die Kundenkanal-Inbox, nicht eine Liste von Chats. Zwei Bedeutungen von „Konversation", zwei Oberflächen — siehe [Conversations-Übersicht](/de/platform/conversations/overview) für die Inbox-Bedeutung.

## History und Suche

**History** ist die Liste jedes Chats, den der User in dieser Org fortsetzen kann. Neue Chats erscheinen oben; eine Auswahl öffnet das volle Transkript. **Chat durchsuchen** filtert die History nach Titel; Volltextsuche über Nachrichtentexte ist eine Pro-Chat-Operation, nicht org-weit. **Chat umbenennen** setzt einen benutzerdefinierten Titel, der den modellgenerierten überschreibt; **Chat löschen** verschiebt den Chat in den [Papierkorb](/de/platform/admin/governance/trash), wo die Aufbewahrung ihn nach dem Schonzeitfenster wegfegt.

## Wo das hineinpasst

Chat-Grundlagen ist die Seite, die alles andere in diesem Abschnitt verfeinert: [Agents im Chat](/de/platform/chat/agents-in-chat) vertieft den Picker, [Anhänge](/de/platform/chat/attachments) den Upload, [Sprachmodus](/de/platform/chat/voice-mode) die STT- und TTS-Übergaben rund um denselben Composer. Wenn du hier bist, um einen Agent zu bauen statt einen zu nutzen, spring zu [Agent-Konzepte](/de/platform/agents/concepts) — das Vier-Knöpfe-Modell ist die Grundlage, auf der jeder Chat mit einem Agent steht.
