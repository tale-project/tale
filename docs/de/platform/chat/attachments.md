---
title: Chat-Anhänge
description: Dateien an Chat-Nachrichten anhängen, damit die KI Bilder lesen, Dokumente parsen und Audio oder Video transkribieren kann, bevor sie antwortet.
---

Chat-Anhänge sind Dateien, die du neben einer Nachricht sendest, damit die KI sie im selben Zug analysieren kann. Tale verarbeitet jeden Upload, bevor die Nachricht das Modell erreicht — Bilder und Dokumente werden zu Vision-Tokens oder reinem Text extrahiert, Audio und Video werden serverseitig transkribiert, und das Ergebnis wird an den Nachrichtentext angehängt, sodass der Agent eine zusammenhängende Eingabe sieht. Die Seite ist für jede Rolle im Produkt: Mitglieder hängen Referenzmaterial an eine Frage, Redakteure kuratieren gescannte Dokumente, Entwickler testen Integrationen mit Beispiel-Payloads.

Anhänge leben bei der Konversation, nicht bei der gemeinsamen Wissensdatenbank. Die Pipeline unten zeigt, was wohin geht, die Grössen- und Mengen-Limits, die Aufbewahrungsregeln und den Sicherheits-Scan-Pfad.

## Eine Datei anhängen

Um eine Datei anzuhängen, klicke auf das **Büroklammer**-Icon in der Composer-Toolbar und wähle Dateien vom Gerät, oder zieh die Dateien per Drag-and-drop direkt auf das Chat-Fenster. Die Nachricht geht erst raus, wenn jeder Anhang fertig ist — jede Datei zeigt während des Uploads einen Fortschritts-Spinner, plus einen Transkriptions-Status-Pill für Audio und Video.

## Unterstützte Dateitypen

Die akzeptierten Formate ordnen sich in fünf Kategorien, jede mit eigenem Verarbeitungspfad, bevor die Nachricht das Modell erreicht:

| Kategorie     | Endungen                                                   | Was passiert, bevor das Modell sie sieht                                                                       |
| ------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Bilder**    | `PNG`, `JPEG`, `GIF`, `WebP`                               | Als Vision-Tokens gesendet — das Modell betrachtet Layout, Diagramme, Fotos und Text im Bild.                  |
| **Dokumente** | `PDF`, `DOCX`, `XLSX`, `PPTX`, `TXT`, `Markdown`           | Text- und Tabelleninhalt wird extrahiert; das Modell liest den extrahierten Text, nicht die Binärdatei.        |
| **Code**      | `JS`, `TS`, `Python` und die meisten gängigen Quellformate | Wird als reiner Text mit Syntax-Bewusstsein gelesen.                                                           |
| **Audio**     | `MP3`, `M4A`, `WAV`, `OGG`, `WebM`-Audio                   | Serverseitig transkribiert; nur das Transkript erreicht das Chat-Modell.                                       |
| **Video**     | `MP4`, `MOV`, `MKV`, `WebM`, `AVI`, `MPEG`, `3GP`, `M4V`   | Die Audiospur wird extrahiert, transkribiert und an den Agent übergeben. Visueller Inhalt geht **nicht** raus. |

## Audio- und Video-Transkription

Audio- und Video-Uploads durchlaufen eine serverseitige Transkriptions-Pipeline, bevor das Chat-Modell etwas zu sehen bekommt. Die Pipeline komprimiert die Datei nach Opus und teilt sie in Chunks auf, falls sie das Eingabelimit des Transkriptionsmodells überschreitet, schickt jeden Chunk an das vom Anbieter konfigurierte `transcription`-Modell der Organisation (OpenAI Whisper oder einen selbst gehosteten Whisper-kompatiblen Server wie faster-whisper-server, vLLM oder LocalAI) und hängt das zurückgegebene Transkript als Text an die Nachricht.

Ein Status-Pill am Anhang zeigt den Fortschritt — _Transkribiere…_, _Transkribiert_ oder _Konnte nicht transkribiert werden_. Du kannst die Transkription pro Anhang überspringen oder eine fehlgeschlagene erneut versuchen. Eine Nachricht mit einem ausstehenden Audio-Anhang lässt sich erst senden, wenn jeder Anhang transkribiert, übersprungen oder als fehlgeschlagen markiert ist.

Transkription braucht ein Anbieter-Modell mit Tag `transcription` — Admins konfigurieren das einmalig unter [KI-Anbieter](/de/platform/admin/providers). Transkriptions-Aufrufe werden pro Audio-Minute abgerechnet und im Nutzungs-Ledger neben den Chat-Tokens erfasst.

## Video-Links

Du kannst auch eine Video-URL direkt in den Composer einfügen — Tale holt dann das Transkript oder die Audio-Spur von der Quellplattform, bevor die Nachricht rausgeht. Die akzeptierte Host-Liste ist alles, was `yt-dlp` erkennt — YouTube, Vimeo, Bilibili, TikTok und so weiter. Füg die URL ein, und ein Chip erscheint im Anhang-Bereich, während der Server Untertitel lädt oder Audio extrahiert.

Der Ablauf probiert den günstigsten Weg zuerst: Gibt es vom Uploader bereitgestellte oder automatisch erzeugte Untertitel, lädt Tale diese und überspringt die Audio-Extraktion komplett. Wenn keine brauchbaren Untertitel existieren, wird die Audio-Spur extrahiert und durch dieselbe Whisper-Pipeline geschickt wie ein Datei-Upload. So oder so zeigt der Chip den Live-Status — _Lese Video-Infos_, _Lade Untertitel_, _Extrahiere Audio_, _Transkribiere_, dann _Bereit_ — und das Transkript wird zu einem normalen Anhang an der Ausgangs-Nachricht.

Wichtige Limits und Verhaltensregeln:

- **Längenbegrenzung:** Dasselbe 4-Stunden-Limit wie bei Datei-Uploads greift, sobald die Plattform die Video-Dauer meldet. Längere Videos werden abgelehnt, bevor Audio extrahiert wird.
- **Ein Link, ein Chip:** Playlists werden abgelehnt — füg einen einzelnen Video-Link ein.
- **Pro-Organisation-Parallelität:** Maximal drei Videos werden gleichzeitig pro Organisation verarbeitet. Ein viertes löst einen Inline-Fehler aus.
- **Erneuter Versuch nach Rate-Limit:** Wenn die Quellplattform uns drosselt (Bot-Erkennung), bleibt der Chip für eine 15-minütige Wartezeit, bevor ein erneuter Versuch erlaubt ist.
- **Fehlgeschlagener Chip blockiert Senden:** Wenn ein Video-Chip im Fehlzustand ist, bleibt der Senden-Button deaktiviert — zuerst erneut versuchen oder Chip entfernen, damit der Agent nicht nach einem Transkript gefragt wird, das nie angekommen ist.

Transkripte aus Video-Links werden in `<untrusted_source>`-Marker eingebettet, bevor der Agent sie sieht — Uploader-kontrollierter Untertitel-Text und Titel werden als Daten behandelt, nie als Anweisungen. Die Quell-URL bleibt am Chip und im Transkript-Header sichtbar, damit du und der Agent die Herkunft verifizieren könnt. Das Einfügen von Links unterliegt den [Nutzungsbedingungen](/de/legal/terms-of-service) — du bestätigst, dass du das Recht hast, das Video zu verarbeiten, und akzeptierst die Bedingungen der Quellplattform beim Einfügen.

## Grössen- und Mengen-Limits

Die Standard-Obergrenzen für Anhänge pro Nachricht:

- **Pro Datei:** 100 MB standardmäßig. Admins können pro MIME-Typ eine niedrigere Obergrenze setzen (zum Beispiel 25 MB für Audio) in der [Upload-Richtlinie](/de/platform/admin/governance#upload-policy).
- **Audio-Dauer:** Audio- und Video-Uploads sind auf 4 Stunden Audio begrenzt. Längere Dateien werden beim Upload abgelehnt — teile die Aufnahme in kürzere Abschnitte.
- **Dateien pro Nachricht:** 10. Für Massen-Aufnahme ist die [Wissensdatenbank](/de/platform/workspace/knowledge-base) die richtige Oberfläche — sie indiziert den Inhalt einmal, und jeder Agent in der Organisation kann ihn durchsuchen.

## Was nach der Verarbeitung mit der Datei passiert

Im Chat angehängte Dateien bleiben bei der Konversation — sie wandern nicht automatisch in die gemeinsame Wissensdatenbank. Eine Konversation zu löschen, löscht auch ihre Anhänge, sofern die [Aufbewahrungsrichtlinie](/de/platform/admin/governance) deiner Organisation sie nicht länger hält.

## Sicherheit und PII

Jeder Upload wird auf Viren und blockierte MIME-Typen geprüft, bevor er das Modell erreicht. Hat deine Organisation die [PII-Erkennung](/de/platform/admin/governance) aktiviert, wird aus Anhängen extrahierter Text denselben Regeln unterworfen wie getippte Nachrichten — markierte Entitäten werden redigiert, bevor der Agent die Eingabe sieht.

## Wo das einsetzt

Anhänge sind der Einmal-Pfad: eine Datei, die die KI in dieser Konversation sehen soll und danach vergessen darf. Für Dateien, die die KI über Konversationen hinweg abrufen können soll, indiziert die [Wissensdatenbank](/de/platform/workspace/knowledge-base) den Inhalt einmal, und jeder Agent in der Organisation kann ihn durchsuchen. Beide Pfade nutzen dieselbe Parsing-Pipeline; der Unterschied ist die Lebensdauer und das Publikum.
