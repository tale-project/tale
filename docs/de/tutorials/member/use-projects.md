---
title: Projekte nutzen, um Dateien und Chats zu bündeln
description: Verwandle einen Einmal-Chat in einen geteilten Arbeitsraum, der dieselben Dateien, Instruktionen und Konversationen zusammenhält — und hör auf, jedes Mal dieselben Dokumente erneut hochzuladen.
---

Ein Projekt ist das, wozu du greifst, wenn du dich zum zweiten Mal beim Einkopieren desselben Kontexts in einen Chat ertappst. Es bündelt Dateien, Instruktionen und Chats rund um eine Arbeitssache — einen Kontakt, einen Launch, eine lange Untersuchung — damit jede neue Konversation mit bereits geladenem Kontext beginnt. Dieser Spaziergang führt ein frisches Projekt von „ich lade immer dasselbe Briefing erneut hoch" zu „jeder Chat in diesem Projekt kennt das Briefing schon" auf einer Instanz.

Du brauchst eine Member-Rolle (das Minimum, um Projekte zu erstellen) und drei oder vier Dateien, auf die du immer wieder verweist. Die konzeptuelle Seite lebt in [Projekt-Konzepte](/de/platform/projects/concepts); dieser Spaziergang ist der End-to-End-Mechanismus.

## Bevor du beginnst

Bestätige zwei Dinge. Deine Rolle ist mindestens Member — das Anlegen von Projekten ist auf Member und höher begrenzt. Du hast drei bis vier Dateien, die in deinen bisherigen Chats wiederkehren — ein Briefing, ein Transkript, eine Preisliste, eine Richtlinie. Die werden zum Arbeits-Set des Projekts.

## Schritt 1 — Das Projekt erstellen

Das Projekt ist der Behälter, in dem die restlichen Teile leben. Öffne **Projekte > Neues Projekt** und setze:

- **Name** — `Acme-Account` (oder was die Arbeitssache benennt)
- **Beschreibung** — ein Satz, wofür das Projekt da ist
- **Mitglieder** — vorerst privat lassen; du kannst Teammitglieder ergänzen, sobald der erste Chat funktioniert

Speichern. Das Projekt erscheint in der Sidebar; ein Klick öffnet das **Aufgaben**-Board, mit Tabs für Allgemein, Chats, Wissen und Agenten.

## Schritt 2 — Die Dateien einmalig hochladen

Die Projektdateien sind für jeden Chat im Projekt sichtbar, also passiert dieser Upload einmal und zahlt sich bei jedem späteren Chat aus. Öffne den **Wissen**-Tab und zieh die drei oder vier Dateien aus den Voraussetzungen hinein.

Jede Datei landet im Projekt-Speicher und indexiert sich genauso wie ein Wissensdatenbank-Dokument. Sobald der Status **Bereit** ist, erreicht jeder im Projekt gestartete Chat die Dateien.

## Schritt 3 — Projekt-Instruktionen hinzufügen

Projekt-Instruktionen rahmen jeden Chat im Projekt. Sie komponieren mit den eigenen Instruktionen des Agenten: das Projekt rahmt die Arbeit, der Agent rahmt die Antwort. Öffne den **Instruktionen**-Tab und setze:

`You are working on the Acme account. The contract and the call notes in the Knowledge tab are the source of truth; cite them when you make a claim. The customer's voice is conservative — drafts should not promise dates we have not confirmed.`

Speichern. Jeder neue Chat im Projekt läuft jetzt mit dieser Präambel zusätzlich zu den eigenen Instruktionen des Agenten.

## Schritt 4 — Einen Chat starten und prüfen, dass der Kontext mitgeht

Öffne den **Threads**-Tab und klick **Neuer Chat**. Wähl einen Agent — der Default-Assistant reicht für den ersten Lauf — und stell eine Frage, die eine der Projektdateien beantwortet (`What does the contract say about the renewal clause?`). Die Antwort sollte den Vertrag zitieren; das Zitat öffnet die Datei aus dem Wissen-Tab des Projekts, nicht aus der Org-weiten Bibliothek.

Antwortet der Agent ohne Zitat, wurden die Projektdateien nicht retrieved — meist weil der gewählte Agent kein Retrieval-Tool aktiviert hat. Wechsle auf einen Agent mit aktivem RAG oder aktivier es am Assistant für den Projektgebrauch.

## Wo das eingesetzt wird

Ein Projekt mit Dateien, Instruktionen und Threads ist die kleinste nützliche Einheit von geteiltem Kontext in Tale. Dieselbe Form skaliert — Mitglieder ergänzen, damit ein Team das Projekt gemeinsam bearbeitet, einen projekt-skopierten Agent ergänzen, damit die Stimme festsitzt, das Projekt archivieren, wenn die Arbeit ausgeliefert ist.

Für das tiefere Modell, was ein Projekt ist und wann man danach greift, siehe [Projekt-Konzepte](/de/platform/projects/concepts). Für projekt-skopierte Agenten siehe [Projekt-Agenten](/de/platform/projects/project-agents).
