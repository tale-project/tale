---
title: Anhänge
description: Unterstützte Dateitypen, wo Uploads landen, wann Inhalt RAG-indiziert wird und wann er wörtlich in das Prompt eingefügt wird.
---

Anhänge lassen einen Chat auf eine Datei verweisen, ohne dich in einen anderen Tab zu schicken. Du fügst ein, ziehst herein oder wählst **Fotos & Dateien hinzufügen** im Plus-Menü des Chats; die Datei reist mit der Nachricht mit, und Tale routet sie in die richtige Pipeline. Die meisten Dateitypen landen wörtlich im Input des Modells; große oder strukturierte Dateien werden indiziert und ausschnittweise gelesen.

Diese Seite deckt nur den Upload-Mechanismus am Chat ab. Dokumente, die in [Wissen](/de/platform/knowledge/documents) hochgeladen werden, folgen einem separaten Ablauf mit persistenter Indizierung — Chat-Anhänge sind an den Chat gebunden, der sie empfangen hat.

## Ein durchgespielter Upload

Füg ein PDF in den Chat ein. Der Chat zeigt einen Chip mit dem Dateinamen und einem Spinner; der Chip wird zu **Hochgeladen**, sobald die Datei in Tales Speicher gelandet ist. Klick **Nachricht senden**, und der Agent erhält eine extrahierte Textansicht des PDFs inline mit deinem Prompt. Ist die Datei größer als das Inline-Kontextbudget, indiziert Tale sie, und der Agent liest Chunks bei Bedarf über sein Retrieval-Tool.

## Unterstützte Typen

Drei Familien: **Bilder**, **strukturierte Dokumente** (PDF, DOC/DOCX, ODT, XLS/XLSX, PPT/PPTX) und **textartige Dateien** (Plaintext, Markdown, Quellcode, CSV, JSON, YAML). Bilder gehen an das Vision-Modell, das der Chat nutzt; der Modell-Picker muss auf einem vision-fähigen Modell stehen, sonst fällt das Bild stillschweigend weg. Strukturierte Dokumente werden zu Text extrahiert — Diagramme, gescannte Seiten und eingebettete Objekte sind Best-Effort. Textartige Dateien landen wörtlich.

## Wo Uploads leben

Jeder Anhang wird in Tales Objektspeicher abgelegt und an den Chat gebunden, der ihn empfangen hat, und zusätzlich in die Sandbox des Chats unter `/user/uploads/<name>` kopiert. Auf dieser zweiten Kopie arbeiten die `file_read`-, `file_list`- und `run_code`-Tools des Agents: auf den echten Bytes, nicht nur auf der extrahierten Textansicht, die inline mit deinem Prompt mitreist. Den Chat zu löschen verschiebt die Anhänge zusammen mit dem Nachrichtenverlauf in den [Papierkorb](/de/platform/admin/governance/trash); Wiederherstellen bringt sie zurück. Eine separate Bibliothek für Chat-Anhänge gibt es nicht — um ein Dokument über viele Chats zu teilen, lad es in [Wissen](/de/platform/knowledge/documents) hoch und bind es an einen Agent.

## RAG versus wörtlich

Kleine Textdateien und strukturierte Dokumente unter dem Inline-Budget des Agents werden wörtlich eingefügt. Größere werden in Chunks geteilt, eingebettet und indiziert; der Agent ruft die relevanten Chunks zur Antwortzeit ab und zitiert sie. Die Grenze hängt vom Modell ab — Long-Context-Modelle schlucken mehr im Ganzen. Ruft der Agent aus einem Anhang ab, statt ihn ganz zu lesen, zeigen die Zitate auf Chunk-Bereiche in der Originaldatei.

## Wissensdokumente mit @ referenzieren

<Frame caption="Ein getipptes @ öffnet den Wissensdatenbank-Picker über dem Chat.">

![Der Chat zeigt ein getipptes @-Zeichen und den geöffneten Wissensdatenbank-Picker mit drei indexierten Textdokumenten.](/images/platform/chat-mention-picker.webp)

</Frame>

Tippst du `@` in den Chat, öffnet sich ein Picker über das indexierte Wissen der Org — aufgeteilt in einen Abschnitt **Dokumente** und einen Abschnitt **Ordner**. Tipp weiter, um nach Namen zu filtern; `@Datei` heftet ein Dokument unter einem **Wissen**-Chip an, `@Ordner` einen Ordner samt allem darunter Indexierten unter einem **Ordner**-Chip. Beim Senden prüft Tale deinen Zugriff, begrenzt das Retrieval dieser Antwort auf genau die angehefteten Einträge — ein Ordner expandiert zu den Dateien seines Unterbaums — und fügt die relevanten Passagen ein, selbst wenn der Wissensmodus des Agents aus ist, denn eine explizite Erwähnung schlägt die Retrieval-Konfiguration des Agents. Bis zu fünf Einträge, Dokumente und Ordner zusammen, lassen sich pro Nachricht anheften.

Die Chips sind die Quelle der Wahrheit: Löschst du den `@Titel`-Text aus der Nachricht, bleibt der Verweis angeheftet — entfern stattdessen den Chip. Der Picker bietet nur Dokumente an, deren Indexierung abgeschlossen ist und auf die deine Teams Zugriff haben. In einem Projekt-Chat listet er zusätzlich die Dateien und Ordner des Projekts, zuoberst; die Dateien eines Projekts bleiben auf das Projekt begrenzt und tauchen im `@`-Picker eines Chats außerhalb davon nie auf — siehe [Projekt-Dateien verwalten](/de/platform/projects/manage-files). Der Verweis gilt pro Nachricht; eine Nachfrage ohne Erwähnungen fällt auf den normalen Wissens-Scope des Agents zurück.

## Wo das hineinpasst

Anhänge sind der leichtgewichtige, chat-gebundene Weg, eine Datei in eine Antwort zu bringen. Das schwergewichtige, org-gebundene Äquivalent ist [Dokumente](/de/platform/knowledge/documents) — dieselbe Indizierungs-Pipeline, aber an Agents statt an einen einzelnen Chat gebunden. Welche Seite du als Nächstes liest, hängt davon ab, was du vorhast — zählt die Datei einmal, häng sie hier an; wird sie wieder zählen, lad sie in Wissen hoch und lass einen Agent aus jedem Chat darauf verweisen.
