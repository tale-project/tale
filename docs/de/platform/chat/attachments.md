---
title: Anhänge
description: Unterstützte Dateitypen, wo Uploads landen, wann Inhalt RAG-indiziert wird und wann er wörtlich in das Prompt eingefügt wird.
---

Anhänge erlauben einem Chat, auf eine Datei zu verweisen, ohne den User in einen anderen Tab zu schicken. Du fügst ein, ziehst herein oder klickst den Upload-Knopf am Composer; die Datei reitet mit der Nachricht mit, und Tale routet sie in die richtige Pipeline. Die meisten Dateitypen landen wörtlich im Modell-Input; grosse oder strukturierte Dateien werden indiziert und ausschnittweise gelesen.

Diese Seite deckt nur den Upload-Mechanismus am Composer ab. Dokumente, die in [Wissen](/de/platform/knowledge/documents) hochgeladen werden, folgen einem separaten Ablauf mit persistenter Indizierung — Chat-Anhänge sind an den Chat gebunden, der sie empfangen hat.

## Ein durchgespielter Upload

Füg ein PDF in den Composer ein. Der Composer zeigt einen Chip mit dem Dateinamen und einem Spinner; der Chip wird zu **Uploaded**, sobald die Datei in Tales Speicher gelandet ist. **Nachricht senden** schickt die Nachricht, und der Agent erhält eine extrahierte Textsicht des PDFs inline mit deinem Prompt. Ist die Datei grösser als das Inline-Kontextbudget, indiziert Tale sie, und der Agent liest Chunks bei Bedarf über sein Retrieval-Tool.

## Unterstützte Typen

Drei Familien: **Bilder**, **strukturierte Dokumente** (PDF, DOCX, XLSX, PPTX) und **textartige Dateien** (Plaintext, Markdown, Quellcode, CSV, JSON, YAML). Bilder gehen an das Vision-Modell, das der Chat nutzt; der Modell-Picker muss auf einem vision-fähigen Modell stehen, sonst fällt das Bild stillschweigend weg. Strukturierte Dokumente werden zu Text extrahiert — Diagramme, gescannte Seiten und eingebettete Objekte sind Best-Effort. Textartige Dateien landen wörtlich.

## Wo Uploads leben

Jeder Anhang wird in Tales Objektspeicher abgelegt und an den Chat gebunden, der ihn empfangen hat. Den Chat zu löschen verschiebt die Anhänge zusammen mit der Nachrichtenhistorie in den [Papierkorb](/de/platform/admin/governance/trash); Wiederherstellen bringt sie zurück. Es gibt keine separate „Chat-Anhänge"-Bibliothek — um ein Dokument über viele Chats zu teilen, lad es in [Wissen](/de/platform/knowledge/documents) hoch und bind es an einen Agent.

## RAG versus wörtlich

Kleine Textdateien und strukturierte Dokumente unter dem Inline-Budget des Agents werden wörtlich eingefügt. Grössere werden in Chunks geteilt, eingebettet und indiziert; der Agent ruft die relevanten Chunks zur Antwortzeit ab und zitiert sie. Die Grenze hängt vom Modell ab — Long-Context-Modelle schlucken mehr im Ganzen. Wenn der Agent aus einem Anhang abruft, statt ihn ganz zu lesen, zeigen die Zitate auf Chunk-Bereiche in der Originaldatei.

## Wo das hineinpasst

Anhänge sind der leichtgewichtige, chat-gebundene Weg, eine Datei in eine Antwort zu bringen. Das schwergewichtige, org-gebundene Äquivalent ist [Dokumente](/de/platform/knowledge/documents) — dieselbe Indizierungs-Pipeline, aber an Agents statt an einen einzelnen Chat gebunden. Welche Seite du als Nächstes liest, hängt davon ab, was du vorhast — zählt die Datei einmal, häng sie hier an; wird sie wieder zählen, lad sie in Wissen hoch und lass einen Agent aus jedem Chat darauf verweisen.
