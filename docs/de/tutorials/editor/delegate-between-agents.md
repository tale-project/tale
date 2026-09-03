---
title: Arbeit an einen Worker geben
description: Den Worker spawn_agent und seine Job-Karte gibt es in dieser Version nicht — gib Arbeit über eine Board-Aufgabe an einen Projekt-Agenten oder über ihren Agent-Knoten an eine Automatisierung.
---

Diese Anleitung hat früher einen Recherche-Job durch einen **Worker** laufen lassen: Du hast den Assistenten um offene, zitierbare Arbeit gebeten, er rief `spawn_agent` auf, und eine Job-Karte unter seinem Zug zeigte Fortschritt, Ergebnis und Protokoll des Workers. Dieses Tool existiert in dieser Version von Tale nicht — der Chat-Assistent trägt drei nur lesende Recherche-Tools und kann nichts starten, also gibt es auch keine Job-Karte zu lesen. Arbeit an einen Agenten zu geben bleibt der alltägliche Zug; er läuft jetzt über das Projekt-Board, wo die Übergabe einen Verantwortlichen und einen Prüfer hat.

<Note>

Worker aus dem Chat heraus sind in dieser Version nicht verfügbar. Der Chat beantwortet Fragen und recherchiert; Arbeit, die etwas hervorbringt, ist eine Aufgabe, die einem Projekt-Agenten zugewiesen wird.

</Note>

## Arbeit heute übergeben

Der echte Weg ist kurz, und jeder Schritt ist auf dem Board sichtbar:

1. **Das Projekt besetzen.** Öffne den Tab **Agenten** des Projekts und stell sicher, dass ein Agent existiert — [Projekt-Agenten](/de/platform/projects/project-agents) geht den Dialog durch, und [Deinen ersten Agent bauen](/de/tutorials/editor/first-agent-end-to-end) legt einen von Null an.
2. **Die Anfrage als Aufgabe schreiben.** Erstell eine Aufgabe und schreib den Auftrag in ihre Beschreibung — für das Recherche-Beispiel die Frage, die Quellen, die du akzeptierst, und die Form, die die Antwort haben soll. Häng Eingabedateien an die Aufgabe, wenn die Arbeit sie braucht.
3. **Zuweisen und starten.** Weis die Aufgabe dem Agenten zu und klick auf **Agent starten**. Die Karte wandert nach _In Bearbeitung_, und der Agent arbeitet in seiner eigenen Sandbox mit Beschreibung, Kommentaren und Eingabedateien als Kontext.
4. **Prüfen.** Der Bericht landet als Aufgaben-Kommentar, erzeugte Dateien als Ergebnisse, und die Aufgabe parkt bei **In Prüfung** — der **Reviewer** der Aufgabe bekommt eine Glocke und eine E-Mail. Zieh die Karte nach _Erledigt_, um anzunehmen; zum Zurückgeben erwähnst du den Agenten mit @ in einem Kommentar samt deinem Feedback, und ein Nacharbeits-Lauf macht dort weiter, wo der vorige aufgehört hat.

[Aufgaben-Automatisierung](/de/platform/projects/task-automation) beschreibt diese Schleife von Anfang bis Ende, auch was passiert, wenn ein Lauf scheitert.

## Ohne Menschen in der Schleife

Soll die Übergabe von selbst passieren, übernimmt das eine **Automatisierung**: Ihr Agent-Knoten führt einen Harness-Zug als einen Schritt eines Workflows aus — nach Zeitplan, per Webhook oder auf ein Ereignis —, neben den Connector-Aktionen und Code-Knoten um ihn herum. [Automatisierungskonzepte](/de/platform/automations/concepts) erklärt die Teile; [Mitgelieferte Automatisierungen](/de/platform/automations/builtin) zeigt die ausgelieferten Pakete.

## Wo das hingehört

Delegation ist in dieser Version ausdrücklich und prüfbar: Eine Aufgabe nennt Agent und Prüfer, eine Automatisierung nennt Trigger und Knoten, und hinter einer Chat-Antwort wird nichts gestartet. Nimm eine Aufgabe, wenn ein Mensch das Ergebnis prüfen soll; nimm eine Automatisierung, wenn die Arbeit feste Stufen hat und von selbst laufen soll. Die konzeptionelle Seite ist [Agent-Worker](/de/platform/agents/delegation).
