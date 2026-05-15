---
title: Effektiv chatten
description: Agents, Anhänge und Diktat zu einem täglichen Tale-Workflow kombinieren.
---

Die meisten Mitglieder nutzen Chat jeden Tag gleich: den richtigen Agent wählen, Kontext anhängen, fragen, nachhaken. Dieses Tutorial geht diese Schleife end-to-end durch, damit du Antworten bekommst, die auf dem Wissen deiner Organisation beruhen, statt auf generischem Modell-Output. Es verbindet drei Funktionen, die du schon in der UI siehst — den [Agent-Selector](/de/platform/chat/agents-in-chat), [Anhänge](/de/platform/chat/attachments) und Diktat — zu einem Workflow, den du für echte Aufgaben wiederverwenden kannst.

Der ganze Ablauf dauert unter fünf Minuten, sobald du ihn einmal gemacht hast. Du brauchst Mitglied-Zugriff oder höher, sonst nichts.

## Schritt 1 — Den richtigen Agent wählen

Öffne **Chat** in der Seitenleiste und klicke den Agent-Selector unten links im Composer. Standard ist der allgemeine Chat-Agent, der das gesamte Organisationswissen durchsucht. Wenn dein Team spezialisierte Agents angelegt hat — einen Support-Agent, einen Legal-Review-Agent, einen Sales-Research-Agent — wechsle zu einem, dessen Wissen und Tools zu deiner Aufgabe passen. Ein engerer Agent liefert fast immer bessere Antworten.

Wenn du unsicher bist, welcher Agent passt, beginne mit dem, dessen Beschreibung am nächsten dran ist. Du kannst mitten in der Konversation wechseln; der neue Agent übernimmt den Verlauf.

## Schritt 2 — Kontext per Anhang mitgeben

Zieh die Datei oder das Bild, auf das der Agent schauen soll, auf das Chat-Fenster oder klicke das Büroklammer-Symbol. Anhänge werden vor dem Senden verarbeitet, damit der Agent sie beim Lesen deiner Frage schon sieht. Unterstützte Typen stehen unter [Anhänge](/de/platform/chat/attachments) — PDFs, Office-Dokumente, Bilder und die meisten Code-Dateien.

Anhänge bleiben bei der Konversation, nicht bei der gemeinsamen Wissensdatenbank. Wenn die Datei etwas ist, worüber alle später fragen sollen, lade sie stattdessen über die [Wissensdatenbank](/de/platform/workspace/knowledge-base) hoch.

## Schritt 3 — Diktieren, wenn es schneller geht

Wenn du unterwegs bist, ein Gespräch zusammenfasst oder schneller denkst als du tippst, klicke das Mikrofon-Symbol im Composer und sprich. Das Diktat läuft in deinem Browser (Web Speech API), das Audio verlässt dein Gerät nicht. Das Transkript erscheint beim Sprechen im Eingabefeld; du kannst es vor dem Senden bearbeiten.

Diktieren ist kein Modus, sondern ein Tool pro Nachricht — einschalten, sprechen, ausschalten, senden.

## Schritt 4 — An der Antwort feilen

Die erste Antwort ist selten die endgültige. Nutze kurze Nachfragen zum Einengen: „in drei Stichpunkten zusammenfassen“, „jetzt auf Französisch“, „nenne das Dokument, aus dem du zitierst“, „formuliere es für Nicht-Techniker“. Der Agent behält den gesamten Thread im Kontext, jede Nachfrage profitiert vom vorherigen Turn.

Wenn du auf ein Ergebnis triffst, das du wiederverwenden willst, speichere es in der [Prompt-Bibliothek](/de/platform/workspace/prompt-library) — beim nächsten Mal ist derselbe Startpunkt einen Klick entfernt.

## Schritt 5 — Artefakte in Canvas anschauen, wenn es mehr als Text ist

Wenn der Agent lauffähiges HTML, ein SVG, ein Mermaid-Diagramm oder ein längeres Markdown-Dokument zurückgibt, legt er ein **Artefakt** an, das automatisch im Canvas-Seitenbereich öffnet und in der Artefakte-Leiste über dem Chat erscheint. Canvas gibt dir Live-Vorschau, Quellcode-Bearbeitung und Export — deutlich lesbarer als eine rollende Chat-Bubble, und die KI kann das Artefakt direkt überarbeiten, wenn du um Korrekturen bittest. Siehe [Canvas](/de/platform/workspace/canvas) für alle Aktionen.

## Wo das eingesetzt wird

Dieselben fünf Schritte decken fast jede tägliche Chat-Aufgabe ab: den Agent wählen, der zur Aufgabe passt, ihm den Kontext geben, fragen, iterieren, Artefakte aus der Chat-Bubble in etwas Grösseres heben, wenn sie dorthin gehören. Die Shortcuts, die diese Schleife schnell machen — Drag-and-Drop für Anhänge, Diktat, Agent-Selektor, die Prompt-Bibliothek — liegen alle im Composer; je mehr Muskelgedächtnis du aufbaust, desto näher fühlt sich der Chat an eine Suchleiste über dem Wissen deiner Organisation an.

Wenn du merkst, dass du einen passgenaueren Agent willst als die verfügbaren, führt [Den ersten Agent end-to-end bauen](/de/tutorials/editor/first-agent-end-to-end) durch den Bau (Redakteur-Rolle). Für die Tastenkürzel, die die Schleife oben schneller machen, hat [AI-Chat](/de/platform/chat/basics) die volle Liste.
