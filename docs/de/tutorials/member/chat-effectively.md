---
title: Effektiv chatten
description: Agents, Anhänge, Diktat und Canvas zu einem täglichen Tale-Workflow verbinden.
---

Die meisten Mitglieder nutzen den Tale-Chat jeden Tag gleich: den richtigen Agent auswählen, Kontext mitgeben, fragen, nachfassen. Dieses Tutorial läuft die Schleife durch, damit deine Antworten im Wissen deiner Organisation verankert sind statt in generischem Modell-Output. Feature-Referenz zu jedem Schritt liegt unter [Chat](/de/platform/chat/basics); diese Seite verbindet die Teile zu einem wiederholbaren Workflow.

Die ganze Schleife dauert unter fünf Minuten, sobald du sie einmal gemacht hast. Das Ergebnis am Ende ist eine Konversation, die Antworten liefert, die du weiterleiten würdest.

## Bevor du beginnst

Du brauchst Mitglied-Zugriff oder höher in der Tale-Instanz, in der du angemeldet bist — jedes angemeldete Konto ausser `Deaktiviert` kann den Chat nutzen. Mindestens ein Agent muss in der Organisation existieren; der allgemeine Chat-Agent wird standardmäßig ausgeliefert, also ist diese Voraussetzung auf jeder Instanz erfüllt. Kein externes Setup, kein API-Schlüssel, keine Admin-Berechtigung nötig.

## Schritt 1 — Den richtigen Agent auswählen

Ein zweckgebauter Agent durchsucht einen engeren Ausschnitt der Wissensdatenbank und folgt einem strafferen Systemprompt — das produziert fast immer eine schärfere Antwort als der allgemeine Chat-Agent. Öffne **Chat** in der Seitenleiste und klicke auf die Agent-Auswahl unten links am Composer; das Dropdown listet jeden Agent auf, den deine Rolle sehen kann.

Wähle den, dessen Beschreibung deiner Aufgabe am nächsten kommt — ein `product-support`-Agent für eine Kundenanfrage, ein `legal-review`-Agent für eine Vertragsklausel, der Standard-Chat-Agent für alles andere. Bist du unsicher, fang beim nächsten Treffer an und wechsle mitten in der Konversation: der neue Agent behält die Nachrichten-Historie.

Der Schritt hat funktioniert, wenn der Anzeigename des Agents über dem Composer steht und der Platzhalter-Text seine Konversationsstarter zeigt.

## Schritt 2 — Kontext über Anhänge mitgeben

Anhänge lassen den Agent die exakte Datei lesen, nach der du fragst, statt aus seinem Gedächtnis zu raten. Ziehe eine Datei oder ein Bild auf das Chat-Fenster oder klicke auf das Büroklammer-Symbol im Composer. Unterstützte Typen — PDFs, Office-Dokumente, Bilder, Audio, Video und die meisten Code-Dateien — sind in [Anhängen](/de/platform/chat/attachments) gelistet; Dateien außerhalb der Liste werden vor dem Upload abgelehnt.

Anhänge bleiben auf die Konversation begrenzt, nicht auf die geteilte Wissensdatenbank. Soll die Datei später für alle abfragbar sein, lade sie über die [Wissensdatenbank](/de/platform/workspace/knowledge-base) hoch — dort wird sie einmal indiziert und von jedem Agent wiederverwendet.

Der Schritt hat funktioniert, wenn die Datei als Chip unter dem Composer erscheint, mit Name und Größe, und die erste Antwort des Agents auf den Inhalt eingeht.

## Schritt 3 — Diktieren, wenn Sprechen schneller ist als Tippen

Das Mikrofon-Symbol im Composer aktiviert das Browser-Diktat; das Audio wird lokal über die Web Speech API verarbeitet und das Transkript fließt in das Eingabefeld, während du sprichst. Audio-Bytes erreichen die Tale-Server nicht — nur der erkannte Text verlässt dein Gerät.

Schalte das Mikrofon ein, sprich die Frage, schalte es aus und bearbeite das Transkript vor dem Absenden. Diktat ist ein Werkzeug pro Anfrage, kein Modus: es gibt keine Einstellung zu setzen, und es bleibt keine Spur, sobald die Nachricht abgeschickt ist.

Der Schritt hat funktioniert, wenn das Transkript im Eingabefeld erscheint, während du sprichst.

## Schritt 4 — Bei der Antwort nachfassen

Die erste Antwort ist selten die endgültige. Kurze Nachfragen sind der schnellste Weg, einzugrenzen: `fass in drei Punkten zusammen`, `jetzt auf Englisch`, `zitiere das Dokument, das du verwendet hast`, `formuliere für nicht-technische Leser um`. Der Agent behält den ganzen Thread im Kontext, also profitiert jede Nachfrage vom vorherigen Zug — du musst nicht wiederholen, was du schon gesagt hast.

Landest du auf einem Ergebnis, das es wert ist, wiederverwendet zu werden, speichere den Prompt in der [Prompt-Bibliothek](/de/platform/workspace/prompt-library). Beim nächsten Mal ist der gleiche Ausgangspunkt einen Klick vom Composer entfernt.

Der Schritt hat funktioniert, wenn die nächste Antwort des Agents sichtbar auf die Einschränkung eingeht, die du in der Nachfrage hinzugefügt hast.

## Schritt 5 — Artefakte in Canvas sehen, wenn es mehr als Text ist

Ein langes Markdown-Dokument, eine lauffähige HTML-Seite, ein SVG oder ein Mermaid-Diagramm ist in einer Chat-Blase schlecht lesbar. Wenn der Agent so etwas erzeugt, öffnet Tale es automatisch als Artefakt im Seitenbereich [Canvas](/de/platform/workspace/canvas) und listet es in der Artefakt-Leiste über dem Chat — Live-Vorschau, Quellansicht und Export liegen alle im Canvas-Bereich.

Fordere den Agent auf, das Artefakt direkt zu überarbeiten (`mach das Diagramm horizontal`, `füge eine zweite Spalte hinzu`), und Canvas aktualisiert es, ohne eine neue Chat-Blase zu erzeugen.

Der Schritt hat funktioniert, wenn sich der Canvas-Bereich rechts mit dem gerenderten Artefakt öffnet und die Chat-Blase eine kurze Zusammenfassung statt des vollen Inhalts zeigt.

## Fehlerbehebung

- **Der Agent antwortet aus dem falschen Wissen** — der Agent hat Zugriff auf zu viele Ordner. Wechsle zu einem engeren Agent oder lasse den Besitzer des Agents den **Wissen**-Tab einschränken. Die volle Zuordnung liegt in [Agent-Konzepte — Wissen](/de/platform/agents/concepts#knowledge).
- **Der Anhang wurde hochgeladen, aber der Agent ignoriert ihn** — die Datei ist größer als das Kontext-Budget des Modells oder ihr Typ ist nicht in der unterstützten Liste. Probier eine kleinere Datei oder konvertiere zu PDF; [Anhänge](/de/platform/chat/attachments) listet die unterstützten Typen und Limits.
- **Das Mikrofon-Symbol erscheint nicht** — der Browser unterstützt die Web Speech API nicht (ältere Firefox-Builds, manche eingebetteten WebViews) oder die Seite hat keine Mikrofon-Berechtigung. Wechsle zu Chrome, Edge oder Safari und erteile die Berechtigung, wenn du gefragt wirst.
- **Der Canvas-Bereich öffnet sich nicht** — der Output des Agents ist nicht lang genug oder passt zu keinem Artefakt-Format. Frage im Prompt explizit nach einem HTML-, Mermaid- oder Markdown-Artefakt.

## Wo das einsetzt

Dieselbe Fünf-Schritte-Schleife deckt fast die ganze tägliche Chat-Arbeit eines Mitglieds ab: Agent, Kontext, fragen, nachfassen, Artefakte aus der Blase ziehen, wenn sie woanders hingehören. Die Abkürzungen, die das Tempo geben — Drag-and-Drop-Anhänge, Diktat, Agent-Wechsler, Prompt-Bibliothek — liegen alle im Composer; Muskelgedächtnis macht aus der Schleife etwas, das einer Suchleiste über dem Wissen deiner Organisation nahekommt.

Willst du einen passgenaueren Agent als das, was es gibt, führt [Den ersten Agent end-to-end bauen](/de/tutorials/editor/first-agent-end-to-end) durch das Erstellen — dafür braucht es die Redakteur-Rolle. Für die Tastenkürzel, die die Schleife weiter komprimieren, trägt [Chat-Grundlagen — Tastenkürzel](/de/platform/chat/basics#keyboard-shortcuts) die volle Liste.
