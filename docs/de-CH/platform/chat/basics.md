---
title: Chat-Grundlagen
description: Mit dem KI-Chat Daten erkunden, Dateien anhängen und Agents auswählen.
---

Der KI-Chat ist die wichtigste Oberfläche, um mit Tales KI zu arbeiten. Er ist ein Konversations-Arbeitsbereich, in dem du Fragen stellst, Aktionen anforderst und deine Daten in natürlicher Sprache erkundest.

## Den Chat benutzen

- Zugriff: navigiere in der linken Seitenleiste zu Chat.
- Klicke auf das Plus-Icon in der Toolbar oder drücke `Alt + Ctrl + N` (bzw. `Option + Cmd + N` auf Mac), um eine neue Konversation zu starten.
- Jede Konversation wird in deinem Verlauf gespeichert und kann später gesucht oder umbenannt werden.

## Nachrichten senden

Tippe im Eingabefeld unten. Die Enter-Taste sendet deine Nachricht. Nutze Shift+Enter für einen Zeilenumbruch innerhalb einer Nachricht. Das Eingabefeld wächst beim Tippen automatisch mit.

## Datei-Anhänge

Du kannst an jede Nachricht Dateien anhängen — per Klick auf das Büroklammer-Icon oder per Drag-and-drop ins Chat-Fenster. Unterstützte Dateitypen sind:

- Bilder: PNG, JPEG, GIF, WebP. Der Agent analysiert den Bildinhalt.
- Dokumente: PDF, DOCX, XLSX, PPTX, TXT, Markdown. Der Agent liest den Inhalt.
- Code-Dateien: JS, TS, Python und die meisten gängigen Quellcode-Formate.
- Audio: MP3, M4A, WAV, OGG, WebM. Die Audiospur wird serverseitig transkribiert und der Text an den Agent übergeben.
- Video: MP4, MOV, MKV, WebM, AVI, MPEG, 3GP, M4V. Die Audiospur wird extrahiert, transkribiert und an den Agent übergeben — visueller Inhalt wird nicht gesendet.

Dateien werden vor dem Senden der Nachricht hochgeladen. Während des Uploads zeigt jede Datei einen Lade-Spinner; Audio- und Video-Anhänge zeigen zusätzlich einen Transkriptions-Status, bis die Verarbeitung abgeschlossen ist. Siehe [Chat-Anhänge](/de/platform/chat/attachments) für die vollständige Pipeline.

## Einen Agent auswählen

Der Agent-Selector befindet sich in der unteren linken Ecke des Eingabebereichs als Bot-Icon. Damit wählst du aus, welcher KI-Agent deine Konversation bearbeitet. Standard ist der System-Chat-Agent. Eigene Agents, die dein Team gebaut hat, erscheinen hier ebenfalls.

## Chat-Verlauf

Klicke auf das Uhr-Icon in der Toolbar, um die Verlaufsseitenleiste zu öffnen. Du kannst:

- alle vergangenen Konversationen nach Datum gruppiert durchstöbern;
- eine Konversation öffnen, indem du sie anklickst;
- einen Konversationstitel per Doppelklick inline umbenennen;
- über das Drei-Punkte-Menü eine Konversation umbenennen oder löschen;
- mit `Ctrl+K` (Windows/Linux) oder `Cmd+K` (Mac) über alle Konversationen suchen.

## Was der Chat-Agent kann

Der Standard-Chat-Agent kann Folgendes:

| Tool-Kategorie        | Beispiele                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Wissens-Suche         | Fragen beantworten, die durch deine hochgeladenen Dokumente und gecrawlten Websites gestützt werden |
| Web-Suche             | im Internet nach aktuellen Informationen suchen                                                     |
| Dokument-Verarbeitung | PDF, Word, PowerPoint, Excel und Text-Dateien parsen und analysieren                                |
| Bild-Analyse          | Bilder beschreiben, analysieren oder Informationen daraus extrahieren                               |
| Audio-Transkription   | angehängte Audio- oder Video-Dateien transkribieren, damit der Agent sie zusammenfassen kann        |

## Arena-Modus

Mit Arena-Modus vergleichst du zwei KI-Modelle bei identischem Prompt. Klicke auf das **Schwerter**-Icon in der Eingabe-Toolbar, wähle zwei Modelle und sende eine Nachricht. Beide Modelle antworten parallel in einer geteilten Ansicht. Trage ein Verdikt ein, um festzuhalten, welche Antwort besser war.

Siehe [Arena mode](/de/platform/chat/arena-mode) für alle Details.

## Canvas

Wenn die KI lauffähiges HTML, ein SVG, ein Mermaid-Diagramm, ein Markdown-Dokument oder ein Code-Snippet erzeugt, legt sie ein **Artefakt** an, das als Karte in der Artefakte-Leiste über dem Chat erscheint und automatisch im Canvas-Bereich aufgeht. Canvas bietet Live-Vorschau, Quellcode-Bearbeitung und Export. Die KI kann das Artefakt über mehrere Schritte direkt überarbeiten — kleine Korrekturen erfordern keine erneute Generierung des ganzen Dokuments.

Siehe [Canvas](/de/platform/workspace/canvas) für alle Details.

## Prompt-Bibliothek

Speichere und nutze Prompt-Vorlagen in deiner ganzen Organisation wieder. Öffne die Prompt-Bibliothek aus der Chat-Toolbar, um gespeicherte Prompts zu durchsuchen und einzufügen. Du kannst auch jede Chat-Nachricht direkt aus der Konversation als Prompt-Vorlage speichern.

Siehe [Prompt library](/de/platform/workspace/prompt-library) für alle Details.

## Recherche-Plan

Bei mehrstufigen Fragen, die Planung verlangen — breite Recherche, Vergleiche über viele Quellen, Zusammenfassungen aus mehreren Dokumenten und dem Web — zerlegt der Agent die Aufgabe in einen **Recherche-Plan** und arbeitet ihn Schritt für Schritt ab. Der Plan öffnet sich automatisch als Seitenbereich, sobald der Agent in der Konversation den ersten Todo ausgibt; du kannst ihn anpinnen oder über die Leiste am rechten Rand des Chats schliessen.

Jeder Todo zeigt einen Status (offen, läuft, erledigt, fehlgeschlagen), eine einzeilige Zusammenfassung und die Quellen, die der Agent für diesen Schritt erfasst hat — Treffer aus der Wissensdatenbank, abgerufene Web-Seiten und Ergebnisse aus Integrationen. Der Plan aktualisiert sich live, sobald ein Schritt abgeschlossen ist, sodass du die Argumentationskette des Agents mitliest, statt am Ende auf eine lange Antwort zu warten.

Du kannst eingreifen, ohne den Lauf abzubrechen:

- **Schritt einklappen**, um die Quellenliste zu verbergen, wenn sie lang wird.
- **Umpriorisieren** mit einer Folge-Nachricht — der Agent passt verbleibende Todos auf Basis deines Feedbacks an.
- **Stoppen** mit dem normalen Stop-Button am Composer — Teilergebnisse bleiben im Thread, und die Anzahl fehlgeschlagener Todos steht oben im Plan.

Der Recherche-Plan ist schreibgeschützt — du bearbeitest Todos nicht direkt. Steuere den Lauf über reguläre Chat-Nachrichten.

## Tastaturkürzel

| Aktion                          | Windows / Linux  | macOS              |
| ------------------------------- | ---------------- | ------------------ |
| Neuer Chat                      | `Alt + Ctrl + N` | `Option + Cmd + N` |
| Chats durchsuchen               | `Ctrl + K`       | `Cmd + K`          |
| Verlaufsseitenleiste umschalten | `Ctrl + H`       | `Cmd + H`          |

## Wo das hingehört

Der Chat ist die Eingangstür für alles, was Tales KI kann — dieselben Agents, dasselbe Wissen, dieselben Tools, die der Rest der Plattform nutzt, sind über den Composer erreichbar. Die meisten Nutzer leben in dieser einen Seite; der Rest der Plattform liest sich entweder als _wie du den Chat besser machst_ (Wissen kuratieren, Agents bauen) oder als _wann der Chat nicht die richtige Oberfläche ist_ (Automatisierungen für unbeobachtete Arbeit, die API für Skripte).

Um den Chat für dein Team nützlicher zu machen, ist der nächste Schritt meist ein passgenauer Agent — siehe [Agent-Konzepte](/de/platform/agents/concepts) für das mentale Modell, dann [Den ersten Agent end-to-end bauen](/de/tutorials/editor/first-agent-end-to-end) für die Anleitung.
