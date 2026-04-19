---
title: Chat-Anhänge
description: Hänge Dateien an Chat-Nachrichten, damit die KI Bilder, Dokumente und Code lesen kann.
---

Du kannst an jede Chat-Nachricht Dateien anhängen, damit der KI-Agent sie gemeinsam mit deiner Frage analysieren kann. Anhänge werden vor dem Senden der Nachricht verarbeitet und ihr Inhalt in die Konversation eingebunden.

## Wie du anhängst

- Klicke auf das **Büroklammer**-Icon in der Chat-Toolbar und wähle Dateien von deinem Gerät aus.
- Oder ziehe Dateien per Drag-and-drop direkt auf das Chat-Fenster.

Du kannst mehrere Dateien gleichzeitig anhängen. Jede Datei zeigt während des Uploads einen Fortschritts-Spinner; die Nachricht wird erst gesendet, sobald jeder Anhang bereit ist.

## Unterstützte Dateitypen

| Kategorie     | Endungen                                                  | Was die KI tut                                                            |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Bilder**    | PNG, JPEG, GIF, WebP                                      | betrachtet den visuellen Inhalt — Layout, Diagramme, Fotos, Text im Bild. |
| **Dokumente** | PDF, DOCX, XLSX, PPTX, TXT, Markdown                      | liest den Textinhalt einschließlich Tabellen und Überschriften.           |
| **Code**      | JS, TS, Python und die meisten gängigen Quellcode-Formate | liest den Quellcode als Text mit Syntax-Bewusstsein.                      |

## Größen- und Mengenbegrenzungen

- **Maximale Dateigröße:** 100 MB pro Datei.
- **Maximale Dateien pro Nachricht:** 10. Für Massen-Imports nutze stattdessen die [Wissensdatenbank](/de/use/workspace/knowledge-base).

## Wo Anhänge landen

Im Chat angehängte Dateien bleiben bei der Konversation — sie werden nicht automatisch in die gemeinsame Wissensdatenbank aufgenommen. Wenn du willst, dass die KI eine Datei für spätere Konversationen behält, lade sie separat in die Wissensdatenbank hoch.

Das Löschen einer Konversation löscht auch ihre Anhänge, sofern deine Organisations-[Retention-Richtlinie](/de/admin/governance) sie nicht länger aufbewahrt.

## Sicherheit

Uploads werden vor dem Eintreffen beim Modell auf Viren und blockierte MIME-Typen geprüft. Wenn dein Admin [PII-Erkennung](/de/admin/governance) aktiviert hat, werden aus Anhängen extrahierte Texte denselben Regeln unterworfen wie getippte Nachrichten.
