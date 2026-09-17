---
title: Fragen zu Dateien und Bildern stellen
description: Hänge Dokumente, Bilder oder Aufnahmen an einen Chat an und prüfe, wann der Assistent ihre Inhalte verwenden kann.
---

Hänge eine Datei an, wenn sie für das aktuelle Gespräch gebraucht wird. Der Assistent erhält Bilder, ruft Text aus unterstützten Dokumenten ab und liest Transkripte von Aufnahmen. Sollen mehrere Chats dieselben Dateien nutzen, lade sie in ein [Projekt](/de/platform/projects/manage-files) oder die [Wissensbibliothek](/de/platform/knowledge/documents) hoch.

## Einen Anhang hinzufügen

Öffne das `+`-Menü neben dem Nachrichtenfeld und wähle **Fotos & Dateien hinzufügen**. Du kannst Dateien auch auf das Nachrichtenfeld ziehen oder einen Screenshot hineinkopieren. Eine Nachricht kann bis zu zehn Dateien enthalten.

Bilder erscheinen als Vorschaubilder, andere Dateien als benannte Chips mit Verarbeitungsstatus. Prüfe die Dateinamen vor dem Senden. Entferne einen vorbereiteten Anhang über dessen Entfernen-Schaltfläche, wenn er nicht zur Nachricht gehören soll.

<Frame caption="Ein vorbereitetes Dokument zeigt vor dem Senden seinen Namen und den Verarbeitungsstatus.">

![Über dem Nachrichtenfeld steht ein angehängtes Dokument mit seinem Verarbeitungsstatus und einer Schaltfläche zum Entfernen.](/images/platform/chat-document-attachment.webp)

</Frame>

Formuliere, wonach der Assistent suchen soll, etwa: „Lies die Gesprächsnotiz und liste Entscheidungen, Verantwortliche und fehlende Fristen auf.“ Eine Datei allein erklärt noch nicht, was du damit vorhast.

Bei Audio- und Videodateien prüft das Nachrichtenfeld, ob die Organisation ein verfügbares Transkriptionsmodell hat. Fehlt die Einrichtung oder ist das ausgewählte Modell nicht verfügbar, werden diese Dateien vor dem Upload abgewiesen. Andere unterstützte Dateien aus derselben Auswahl lassen sich weiterhin hochladen. Öffne den angezeigten Einstellungslink, wenn du Zugriff hast, oder bitte einen Admin, die [Modelle](/de/platform/admin/governance/content-models) zu prüfen.

## Verstehen, was beim Modell ankommt

| Anhang | Verwendeter Inhalt | Darauf achten |
| --- | --- | --- |
| Bild oder eingefügter Screenshot | Das Bild selbst, sofern das Modell Bilder verarbeiten kann. | Wähle ein bildfähiges Modell und achte auf lesbaren Text. |
| PDF, modernes Office-Dokument oder unterstützte Textdatei | Text, den der Assistent über seine Abrufwerkzeuge lesen kann. | Warte auf die Verarbeitung und prüfe den Leseschritt in der Antwort. |
| Audio- oder Videodatei | Ein Texttranskript. | Ein Admin muss die Transkription einrichten. Prüfe Namen, Zahlen und Fachbegriffe anhand der Aufnahme. |
| Alte Office-Datei ohne Textextraktor | Den Dateinamen, ohne durchsuchbaren Dokumenttext. | Speichere sie als `.docx`, `.xlsx` oder `.pptx` und hänge diese Kopie an. |

Unterstützter Upload und Textextraktion sind zwei verschiedene Dinge. Eine sichtbare Datei im Chat bedeutet nicht automatisch, dass der Assistent ihren Inhalt lesen kann.

## Während der Verarbeitung senden

Sind Dokumente oder Aufnahmen beim Senden noch in Verarbeitung, stellt Tale die Nachricht zurück und sendet sie, sobald die Dateien bereit sind. Die wartende Nachricht erscheint über dem Eingabefeld. Brich sie dort ab, wenn du die Frage ändern möchtest; ihr Text kehrt ins Feld zurück.

Füge einen kopierten, unterstützten Videolink in das Nachrichtenfeld ein, um einen Anhang zu erstellen. Eine von Hand eingegebene URL bleibt gewöhnlicher Nachrichtentext. Tale lädt zuerst Untertitel. Sind keine verfügbar, transkribiert es die Audiospur und stellt dem Assistenten den Text bereit. Das Einfügen eines Links bleibt auch ohne Transkriptionsmodell möglich, da nutzbare Untertitel kein solches Modell benötigen. Schlägt der Link fehl, versuche es erneut oder entferne ihn vor dem Senden.

Ein Modellwechsel gilt für neue Transkriptionen; bereits verarbeitete Anhänge behalten ihr vorhandenes Transkript. Lädst du dieselben Bytes erneut hoch, wird die fertige Transkription für dasselbe Ziel wiederverwendet. Bei einem anderen Zielanbieter oder Zielmodell wird die Aufnahme erneut transkribiert.

## Den richtigen Ablageort wählen

Chat-Anhänge gehören zu diesem Gespräch. Sie landen nicht automatisch in der Wissensbibliothek und sind nicht in anderen Chats verfügbar. Beim Wechsel des Gesprächs werden vorbereitete Anhänge entfernt. Prüfe deshalb die Chips erneut, wenn du den Chat wechselst.

Eine neu erzeugte Antwort verwendet die gespeicherten Anhänge der ursprünglichen Nachricht. Soll der Assistent eine andere Dateiversion lesen, sende die neue Datei und benenne ausdrücklich die gewünschte Version.

<Tip>

Lege ein Briefing oder eine Richtlinie für wiederkehrende Fragen einmal im passenden Projekt ab. Starte weitere Chats dort, statt jedes Mal eine neue Kopie hochzuladen.

</Tip>

## Probleme mit Anhängen beheben

| Beobachtung | Maßnahme |
| --- | --- |
| Das gewählte Modell kann das Bild nicht lesen | Wähle ein bildfähiges Modell. Auto berücksichtigt passende Bildmodelle. Sind keine verfügbar, bitte einen Admin um die Einrichtung. |
| Die Verarbeitung schlägt fehl | Versuche den Upload erneut. Scheitert auch eine kleine unterstützte Datei, sollte ein Admin je nach Fehlermeldung Speicher, Indexierung oder Transkription prüfen. |
| Der Assistent kennt den Namen, aber nicht den Inhalt | Prüfe Format und Verarbeitungsstatus. Wandle alte Dateien in ein unterstütztes modernes Format um. |
| Die Antwort erfindet Details aus einer Aufnahme | Vergleiche das Transkript mit der Aufnahme und liefere den korrigierten Abschnitt nach. |
| Eine wartende Nachricht wird nicht gesendet | Prüfe den Status aller Anhänge einschließlich Videolinks. Entferne fehlerhafte Einträge oder versuche sie erneut. |

Unter [Fragen im Chat stellen](/de/platform/chat/basics) erfährst du, wie du Quellen prüfst und das Gespräch fortsetzt.
