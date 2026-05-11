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

| Kategorie     | Endungen                                                        | Was die KI tut                                                                                                            |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Bilder**    | `PNG`, `JPEG`, `GIF`, `WebP`                                    | betrachtet den visuellen Inhalt — Layout, Diagramme, Fotos, Text im Bild.                                                 |
| **Dokumente** | `PDF`, `DOCX`, `XLSX`, `PPTX`, `TXT`, `Markdown`                | liest den Textinhalt einschließlich Tabellen und Überschriften.                                                           |
| **Code**      | `JS`, `TS`, `Python` und die meisten gängigen Quellcode-Formate | liest den Quellcode als Text mit Syntax-Bewusstsein.                                                                      |
| **Audio**     | `MP3`, `M4A`, `WAV`, `OGG`, `WebM`-Audio                        | transkribiert die Audiospur und übergibt den Text an den Agent. Die Rohdaten erreichen das Chat-Modell nie.               |
| **Video**     | `MP4`, `MOV`, `MKV`, `WebM`, `AVI`, `MPEG`, `3GP`, `M4V`        | extrahiert die Audiospur, transkribiert sie und übergibt den Text an den Agent. Visueller Inhalt wird **nicht** gesendet. |

### Audio- und Video-Transkription

Wenn du eine Audio- oder Video-Datei anhängst, läuft vor dem Senden der Nachricht eine serverseitige Transkriptions-Pipeline:

1. Die Datei wird nach Opus komprimiert (und bei Bedarf in Chunks zerlegt), damit sie in das Eingabelimit des Transkriptionsmodells passt.
2. Jeder Chunk geht an das von der Organisation konfigurierte Modell mit Tag `transcription` (z. B. OpenAI Whisper oder ein selbst gehosteter Whisper-kompatibler Server wie faster-whisper-server, vLLM oder LocalAI).
3. Das zurückgegebene Transkript wird als Text an die Nachricht angehängt.

Ein Status-Pill am Anhang zeigt den Fortschritt — _Transkribiere…_, _Transkribiert_ oder _Konnte nicht transkribiert werden_. Du kannst die Transkription pro Anhang überspringen oder eine fehlgeschlagene wiederholen. Eine Nachricht mit noch laufender Audio-Transkription kann erst gesendet werden, wenn jeder Anhang transkribiert, übersprungen oder fehlgeschlagen ist.

Damit das funktioniert, muss ein Admin ein Anbieter-Modell mit dem Tag `transcription` konfigurieren — siehe [KI-Anbieter](/de/platform/admin/providers). Transkriptions-Aufrufe werden pro Audio-Minute abgerechnet und im Nutzungs-Ledger neben den Chat-Tokens erfasst.

## Größen- und Mengenbegrenzungen

- **Maximale Dateigröße:** 100 MB pro Datei (Standard). Admins können pro MIME-Typ eine strengere Grenze setzen (z. B. 25 MB für Audio) in der [Upload-Richtlinie](/de/platform/admin/governance#upload-policy).
- **Audio-Dauer:** Audio- und Video-Uploads sind auf 4 Stunden Audio begrenzt. Längere Dateien werden beim Upload abgelehnt — teile die Aufnahme in kürzere Abschnitte.
- **Maximale Dateien pro Nachricht:** 10. Für Massen-Imports nutze stattdessen die [Wissensdatenbank](/de/platform/workspace/knowledge-base).

## Wo Anhänge landen

Im Chat angehängte Dateien bleiben bei der Konversation — sie werden nicht automatisch in die gemeinsame Wissensdatenbank aufgenommen. Wenn du willst, dass die KI eine Datei für spätere Konversationen behält, lade sie separat in die Wissensdatenbank hoch.

Das Löschen einer Konversation löscht auch ihre Anhänge, sofern deine Organisations-[Aufbewahrungsrichtlinie](/de/platform/admin/governance) sie nicht länger aufbewahrt.

## Sicherheit

Uploads werden vor dem Eintreffen beim Modell auf Viren und blockierte MIME-Typen geprüft. Wenn dein Admin [PII-Erkennung](/de/platform/admin/governance) aktiviert hat, werden aus Anhängen extrahierte Texte denselben Regeln unterworfen wie getippte Nachrichten.
