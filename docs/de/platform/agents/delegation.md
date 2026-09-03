---
title: Agent-Worker
description: Das Worker-Tool spawn_agent gibt es in dieser Version nicht — Arbeit geht über eine Board-Aufgabe an einen Projekt-Agenten und über ihren Agent-Knoten an eine Automatisierung.
---

Diese Seite hat früher Worker erklärt: ein Tool `spawn_agent`, mit dem der Agent, mit dem du chattest, einen flüchtigen Unter-Agenten zusammenstellte, laufen ließ und das Ergebnis unter einer Job-Karte in seine Antwort faltete. Dieses Tool existiert in dieser Version von Tale nicht — der Chat-Assistent kann nichts starten, und eine Job-Karte gibt es nicht. Arbeit an einen Agenten zu geben bleibt der zentrale Zug; er läuft über Aufgaben und Automatisierungen.

<Note>

Worker aus dem Chat heraus sind in dieser Version nicht verfügbar. Der Chat beantwortet Fragen und recherchiert; Arbeit, die etwas hervorbringt, ist eine Aufgabe, die einem Projekt-Agenten zugewiesen wird.

</Note>

## Arbeit heute übergeben

Weis eine Board-Aufgabe einem **Projekt-Agenten** zu und klick auf **Agent starten**. Der Agent arbeitet in einer isolierten Sandbox mit Beschreibung, Kommentaren und Eingabedateien der Aufgabe als Kontext, schreibt seinen Bericht als Aufgaben-Kommentar zurück, hängt erzeugte Dateien als Ergebnisse an und parkt die Aufgabe bei **In Prüfung** — Agenten schließen Arbeit nie ab, das tut ein Mensch. Einen laufenden Lauf steuerst du oder den nächsten startest du, indem du den Agenten in einem Aufgaben-Kommentar mit @ erwähnst; er liest deinen Kommentar zuerst und macht dort weiter, wo der vorige Lauf aufgehört hat. [Aufgaben-Automatisierung](/de/platform/projects/task-automation) ist die Schleife von Anfang bis Ende, [Projekt-Agenten](/de/platform/projects/project-agents) die Crew, aus der du zuweist.

Soll die Übergabe ohne Menschen passieren, übernimmt das eine **Automatisierung**: Ihr Agent-Knoten führt einen Harness-Zug als einen Schritt eines Workflows aus — nach Zeitplan, per Webhook oder auf ein Ereignis —, neben den Connector-Aktionen und Code-Knoten um ihn herum. [Automatisierungskonzepte](/de/platform/automations/concepts) erklärt die Teile; [Mitgelieferte Automatisierungen](/de/platform/automations/builtin) zeigt die ausgelieferten Pakete.

## Wo das hingehört

Delegation ist in dieser Version ausdrücklich und prüfbar: Eine Aufgabe nennt Agent und Prüfer, eine Automatisierung nennt Trigger und Knoten, und hinter einer Antwort wird nichts gestartet. Nimm eine Aufgabe, wenn ein Mensch das Ergebnis prüfen soll; nimm eine Automatisierung, wenn die Arbeit feste Stufen hat und von selbst laufen soll.
