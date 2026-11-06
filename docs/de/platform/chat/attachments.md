---
title: Fragen zu Dateien und Bildern stellen
description: Hänge Dokumente, Bilder oder Aufnahmen an einen Chat an und prüfe, wann der Assistent ihre Inhalte verwenden kann.
---

Hänge eine Datei an, wenn sie für das aktuelle Gespräch gebraucht wird. Der Assistent erhält Bilder, ruft Text aus unterstützten Dokumenten ab und liest Transkripte von Aufnahmen. Sollen mehrere Chats dieselben Dateien nutzen, lade sie in ein [Projekt](/de/platform/projects/manage-files) oder die [Wissensbibliothek](/de/platform/knowledge/documents) hoch.

## Einen Anhang hinzufügen

Öffne das `+`-Menü neben dem Nachrichtenfeld und wähle **Fotos & Dateien hinzufügen**. Du kannst Dateien auch auf das Nachrichtenfeld ziehen oder einen Screenshot hineinkopieren. Eine Nachricht kann bis zu zehn Dateien enthalten.

Bilder erscheinen als Vorschaubilder, andere Dateien als benannte Chips. Der Chip eines Dokuments zeigt **Wird gelesen…**, während Tale es liest – das dauert wenige Sekunden –, danach seine Größe: Der Assistent kann es lesen, während Tale es im Hintergrund für die Suche indexiert. Nur ein sehr großes Dokument zeigt stattdessen den Fortschritt der Indexierung, wie weiter unten beschrieben. Prüfe die Dateinamen vor dem Senden. Entferne einen vorbereiteten Anhang über dessen Entfernen-Schaltfläche, wenn er nicht zur Nachricht gehören soll.

Nach dem Senden ändert **Nachricht bearbeiten** den Text in einer neuen Version des Gesprächs und behält die ursprünglichen Anhänge bei. Du musst sie nicht erneut hochladen.

<Frame caption="Ein vorbereitetes Dokument zeigt seinen Namen und seine Größe: Es kann mit deiner Frage gesendet werden.">

![Über dem Nachrichtenfeld steht ein angehängtes Dokument mit seiner Dateigröße und einer Schaltfläche zum Entfernen.](/images/platform/chat-document-attachment.webp)

</Frame>

Formuliere, wonach der Assistent suchen soll, etwa: „Lies die Gesprächsnotiz und liste Entscheidungen, Verantwortliche und fehlende Fristen auf.“ Eine Datei allein erklärt noch nicht, was du damit vorhast.

Wenn du Audio oder Video anhängen möchtest, prüft Tale, ob die Organisation ein verfügbares Transkriptionsmodell hat. Verhindert die Prüfung den Upload, erklärt ein Dialog das Problem und zeigt die für dich verfügbaren Schritte zur Behebung. Diese Dateien werden vor der Übertragung abgewiesen; andere unterstützte Dateien aus derselben Auswahl lassen sich weiterhin hochladen. Schließe den Dialog, um weiterzuschreiben, öffne den Einstellungslink, wenn du Zugriff hast, oder bitte einen Admin, die [Modelle](/de/platform/admin/governance/content-models) zu prüfen.

## Verstehen, was beim Modell ankommt

| Anhang | Verwendeter Inhalt | Darauf achten |
| --- | --- | --- |
| Bild oder eingefügter Screenshot | Das Bild selbst, sofern das Modell Bilder verarbeiten kann. | Wähle ein bildfähiges Modell und achte auf lesbaren Text. Tale verkleinert ein Bild über 1 MB vor dem Hochladen auf höchstens 2 MB, das größte Bild, das ein Modell zu sehen bekommt. Ein animiertes GIF wird nie verkleinert: Ist es größer als 2 MB, bekommt das Modell nur seinen Namen, und das Nachrichtenfeld sagt es dir. |
| PDF, modernes Office-Dokument oder unterstützte Textdatei | Den Text des Dokuments, den der Assistent mit seinen Abrufwerkzeugen liest: aus dem Suchindex oder, solange das Dokument noch indexiert wird, aus dem Text, den Tale beim Hochladen gelesen hat. | Prüfe den Leseschritt in der Antwort. Eine PDF-, Word-, PowerPoint- oder OpenDocument-Datei über 50 MiB, eine Tabelle über 20 MiB, eine Textdatei über 4 MiB oder eine Datei mit mehr als etwa vier Millionen Zeichen Text kann erst gelesen werden, wenn sie indexiert ist. |
| Audio- oder Videodatei | Ein Texttranskript. | Ein Admin muss die Transkription einrichten. Prüfe Namen, Zahlen und Fachbegriffe anhand der Aufnahme. |
| Alte Office-Datei ohne Textextraktor | Den Dateinamen, ohne durchsuchbaren Dokumenttext. | Speichere sie als `.docx`, `.xlsx` oder `.pptx` und hänge diese Kopie an. |

Der Assistent erhält außerdem Dateityp und Größe jedes Anhangs und kann Fragen dazu beantworten, ohne die Datei zu lesen.

Unterstützter Upload und Textextraktion sind zwei verschiedene Dinge. Eine sichtbare Datei im Chat bedeutet nicht automatisch, dass der Assistent ihren Inhalt lesen kann. Die Prüfung auf Zugangsdaten und die Datenschutzrichtlinie (PII) deiner Organisation gelten für einen Anhang genauso wie für den Suchindex: Ein Dokument, das sie ablehnen, kann nicht gelesen werden, auch nicht von Code, den der Assistent ausführt, und eine Richtlinie, die personenbezogene Daten maskiert, maskiert sie auch in dem, was der Assistent liest.

## Während der Verarbeitung senden

Werden beim Senden noch Dokumente gelesen oder Aufnahmen oder Videolinks verarbeitet, stellt Tale die Nachricht zurück und sendet sie, sobald sie bereit sind. Ein Dokument zu lesen dauert wenige Sekunden: Die Nachricht wartet nicht auf seinen Suchindex. Ausgenommen ist ein Dokument, das zu groß ist, um vor seiner Indexierung gelesen zu werden – eine PDF-, Word-, PowerPoint- oder OpenDocument-Datei über 50 MiB, eine Tabelle über 20 MiB, eine Textdatei über 4 MiB oder eine Datei mit mehr als etwa vier Millionen Zeichen Text: Es hält die Nachricht zurück, bis seine Indexierung abgeschlossen ist, und sein Chip zeigt den Fortschritt. Die wartende Nachricht erscheint über dem Eingabefeld. Brich sie dort ab, wenn du die Frage ändern möchtest; ihr Text kehrt ins Feld zurück.

Füge einen kopierten, unterstützten Videolink in das Nachrichtenfeld ein, um einen Anhang zu erstellen. Eine von Hand eingegebene URL bleibt gewöhnlicher Nachrichtentext. Tale lädt zuerst Untertitel. Sind keine verfügbar, transkribiert es die Audiospur und stellt dem Assistenten den Text bereit. Sprechen laut Untertiteln zwei Personen gleichzeitig, behält das Transkript die Worte beider. Das Einfügen eines Links bleibt auch ohne Transkriptionsmodell möglich, da nutzbare Untertitel kein solches Modell benötigen. Fügst du einen Link vor dem Senden in einem bestehenden Chat erneut ein, verwendet der Chat den Anhang wieder, den er dafür schon hat, auch wenn du den Link zwischendurch in einem anderen Chat eingefügt hast; jeder Chat behält seinen eigenen. Ein fehlgeschlagener oder entfernter Anhang wird nicht wiederverwendet, ebenso wenig einer, der vor mehr als einem Tag hinzugefügt wurde. Schlägt der Link fehl, versuche es erneut oder entferne ihn vor dem Senden. Kann Tale einen Link nicht entfernen, erscheint sein Chip wieder und eine Meldung nennt den Grund. Der Link bleibt angehängt, bis das Entfernen gelingt.

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
| Das Nachrichtenfeld meldet ein Bild größer als 2 MB | Das Modell bekommt nur den Namen dieses Bildes. Hänge eine kleinere Kopie an, oder ein PNG oder JPEG statt eines animierten GIFs. |
| Die Verarbeitung schlägt fehl | Versuche den Upload erneut. Scheitert auch eine kleine unterstützte Datei, sollte ein Admin je nach Fehlermeldung Speicher, Indexierung oder Transkription prüfen. |
| Der Assistent kennt den Namen, aber nicht den Inhalt | Prüfe Format und Verarbeitungsstatus. Wandle alte Dateien in ein unterstütztes modernes Format um. |
| Ein Dokument zeigt **Nicht lesbar** | Die Prüfung auf Zugangsdaten oder die Datenschutzrichtlinie (PII) deiner Organisation lehnt seinen Inhalt ab. Entferne das Passwort, den Schlüssel oder die personenbezogenen Daten aus der Datei und hänge sie erneut an, oder frag einen Admin nach der Richtlinie. |
| Ein Dokument zeigt **Kein lesbarer Text** oder **Lässt sich nicht öffnen** | Tale hat in der Datei keinen Text gefunden: Sie ist leer, ein Scan ohne Textebene, beschädigt oder mit einem Passwort geschützt. Hänge eine Kopie mit Textebene und ohne Passwort an. |
| Die Antwort erfindet Details aus einer Aufnahme | Vergleiche das Transkript mit der Aufnahme und liefere den korrigierten Abschnitt nach. |
| Eine wartende Nachricht wird nicht gesendet | Prüfe den Status aller Anhänge einschließlich Videolinks. Entferne fehlerhafte Einträge oder versuche sie erneut. |
| Ein entfernter Videolink erscheint wieder | Tale konnte ihn nicht entfernen; die eingeblendete Meldung nennt den Grund. Der Link bleibt angehängt. Entferne ihn erneut, sobald die Ursache behoben ist, etwa wenn deine Verbindung wieder steht oder nachdem du dich neu angemeldet hast. |

Unter [Fragen im Chat stellen](/de/platform/chat/basics) erfährst du, wie du Quellen prüfst und das Gespräch fortsetzt.
