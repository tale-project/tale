---
title: Dokumente
description: Lade gemeinsame Referenzdateien hoch, prüfe ihre Suchbarkeit und halte Importe sowie freigegebene Revisionen aktuell.
---

Unter **Wissen > Dokumente** gehören Dateien in die gemeinsame Bibliothek: Richtlinien, Anleitungen, Berichte und Belege. Mitglieder lesen Dokumente innerhalb ihrer Zugriffsrechte. Redakteure und höhere Rollen können sie hochladen und verwalten. Material für ein einzelnes Projekt gehört auf dessen [Wissen-Tab](/de/platform/projects/manage-files).

<Frame caption="Die Dokumentliste verbindet Originaldatei, Herkunft, Indexierungsstatus und Team-Zugriff. Die Ansicht ist auf hochgeladene, indexierte Dateien gefiltert.">

![Der Dokumente-Tab zeigt gemeinsame Dateien mit Größe, Quelle, RAG-Status und Team-Spalten.](/images/get-started/documents-list.webp)

</Frame>

## Vom Gerät hochladen

1. Öffne **Wissen > Dokumente** und den gewünschten Zielordner. Lege bei Bedarf mit **Neuer Ordner** einen an.
2. Wähle **Dokumente hochladen > Von deinem Gerät** und die Dateien.
3. Warte auf den Abschluss des Uploads und suche die Zeilen in der Tabelle.
4. Öffne ein Dokument, um Vorschau und Details zu prüfen. Kontrolliere den **RAG-Status**, bevor du den Assistenten nach seinem Inhalt fragst.

Wähle einen aussagekräftigen Dateinamen. Ein Datum oder eine Revision hilft, Quellen auseinanderzuhalten. Eine weitere Datei mit demselben Namen wird als eigenes Dokument angelegt; sie ersetzt die vorhandene nicht.

## Upload und Suchbarkeit unterscheiden

Eine gespeicherte Datei ist nicht automatisch durchsuchbar. Tale muss zuerst ihren Text auslesen können, um sie für die Wissenssuche zu indexieren.

| Format | Was du erwarten kannst |
| --- | --- |
| PDF mit eingebettetem Text, `.docx`, `.xlsx`, `.pptx`, `.odt`, CSV, reiner Text | Textextraktion und Indexierung werden unterstützt. Prüfe das Ergebnis für die konkrete Datei. |
| Ältere Office-Formate `.doc`, `.xls`, `.ppt` | Speichern und Herunterladen sind möglich. Konvertiere sie zur Indexierung in ein modernes Format. |
| Bilder wie JPG, PNG, GIF, WEBP | Speichern und Herunterladen sind möglich. Der Wissensindex liest daraus keinen Text aus. |
| Gescanntes PDF ohne lesbaren Text | Stelle eine Fassung mit OCR oder Text bereit, wenn der Inhalt durchsuchbar sein soll. |

Wiederholtes Indexieren macht ein nicht unterstütztes Format nicht durchsuchbar. Für Fragen zu einem Bild siehe [Chat-Anhänge](/de/platform/chat/attachments): Ein verfügbares Bildmodell kann es dort direkt lesen.

## Den Indexierungsstatus lesen

| Status | Bedeutung und nächster Schritt |
| --- | --- |
| **In Warteschlange** | Wartet auf einen freien Indexierungsplatz. Eine ausgelastete Bibliothek verarbeitet Dateien nach und nach. |
| **Wird indexiert** | Der Text wird für die Suche vorbereitet. Warte mit der Prüfung der Quelle. |
| **Indexiert** | Die Indexierung ist abgeschlossen. Stelle eine konkrete Frage und öffne den Quellenbeleg. |
| **Neuindexierung nötig** | Der Index ist veraltet. Nutze **Indexierung erneut versuchen** neben der Statusanzeige. |
| **Fehlgeschlagen** | Lies den Fehler, behebe die Ursache und versuche es erneut. |
| **Nicht unterstützt** | Dieser Dateiinhalt lässt sich nicht indexieren: etwa bei einem ungeeigneten Format, leerem oder unlesbarem Text oder einer beschädigten PDF-Datei. Öffne die Statusanzeige für die Ursache. |
| **Nicht indexiert** | Es liegt kein abgeschlossener Index vor. Prüfe die Datei und starte die Indexierung, wenn angeboten. |

Unterbrochene Vorgänge werden im Hintergrund wieder aufgenommen oder melden einen Fehler mit Wiederholungsoption. Bleibt der Status stehen, gib einem Administrator Dokumentname und Fehlermeldung. Er kann Indexierungsdienste und Embedding-Konfiguration prüfen. Fehlgeschlagene und nicht unterstützte Dateien belegen weiterhin Speicher, bis du sie entfernst.

## Ein Indexierungsproblem beheben

Klicke auf **Fehlgeschlagen** oder **Nicht unterstützt**, um die Erklärung zu lesen. Entscheidend für die Abhilfe ist die Ursache, nicht allein die Dateiendung.

| Ursache | Nächster Schritt |
| --- | --- |
| Nicht unterstütztes Format oder Bild | Konvertiere die Quelle in ein unterstütztes Dokument mit lesbarem Text. Ein Bild-Upload allein führt keine OCR für die Wissenssuche aus. |
| Leerer Text oder gescannte PDF-Datei ohne Textebene | Ergänze den fehlenden Inhalt oder stelle eine OCR-verarbeitete Fassung bereit. Nur Leerzeichen und Zeilenumbrüche zählen ebenfalls als leer. |
| Binärdaten mit einer Textdateiendung | Exportiere lesbaren Text, möglichst in UTF-8. Das Umbenennen einer Binärdatei in `.txt` konvertiert sie nicht. |
| PDF-Datei lässt sich nicht auslesen | Prüfe, ob sich das Original öffnen lässt. Entferne einen Kennwortschutz, soweit erlaubt, oder exportiere eine neue PDF-Datei. Bei beschädigten Office-Dateien kann stattdessen ein allgemeiner Indexierungsfehler erscheinen; prüfe das Original vor weiteren Versuchen. |
| Ein Zugangsschlüssel oder eine Datenschutzregel blockiert die Indexierung | Entferne die Zugangsdaten aus der Quelle oder lass einen Administrator die gemeldete Richtlinie prüfen. Lade danach das korrigierte Material hoch oder versuche es nach der Konfigurationskorrektur erneut. |
| Embedding-Modell fehlt oder der Anbieter lehnt das Konto ab | Ein Administrator muss das Modell unter **Einstellungen > Datenresidenz** konfigurieren oder Schlüssel, Modellzugriff, Tarif beziehungsweise Guthaben beim Anbieter korrigieren. Versuche es danach erneut. |
| Vorübergehender Fehler beim Anbieter oder Indexierungsdienst | Hintergrundaufträge wiederholen vorübergehende Fehler. Bleibt der Fehler bestehen, gib einem Administrator Dokumentname und Meldung. Nach der Reparatur nutze **Indexierung erneut versuchen**. |
| Suchindex wird neu aufgebaut oder Reparatur fehlgeschlagen | Der Neuaufbau kann automatisch abschließen. Scheitert die Reparatur, muss der Betreiber die Wissensdatenbank reparieren oder wiederherstellen, bevor ein neuer Versuch hilft. |

Bei **Nicht unterstützt** gibt es keine Wiederholungsaktion: Dieselben Dateiinhalte würden wieder scheitern. Auch bei **Fehlgeschlagen** kann zuerst eine Änderung an Quelle oder Konfiguration nötig sein. Anwendungen unterscheiden die Fälle anhand von `indexing.errorCode`; die [API-Referenz](/de/develop/api-reference) führt die stabilen Codes auf.

<Frame caption="Der Statusdialog erklärt, dass dieses Dokument keinen indexierbaren Text enthält. Ergänze lesbaren Inhalt vor dem erneuten Upload.">

![Der englische Statusdialog meldet ein leeres Dokument oder einen Scan ohne Textebene und empfiehlt eine lesbare Textversion.](/images/platform/document-indexing-unsupported.webp)

</Frame>

## Festlegen, wer das Dokument lesen kann

Bibliotheksdokumente sind standardmäßig **Organisationsweit** zugänglich. Begrenze den Zugriff über **Team zuweisen** im Zeilenmenü auf die gewählten Teams. Diese Beschränkungen gelten auch bei der Wissenssuche. Ein Agent kann unzugängliche Dokumente nicht über die Suche sichtbar machen.

Auf der obersten Bibliotheksebene siehst du Ordner und Dokumente, die keinem Ordner zugeordnet sind. Öffne einen Ordner, um seinen Inhalt zu sehen. Ein dort abgelegtes Dokument erscheint nicht zusätzlich als Dateizeile auf der obersten Ebene.

Ordner gliedern die Bibliothek. Prüfe den Zugriff in der Zelle **Teams** und die Herkunft in der Spalte **Quelle**. Projektdateien haben einen eigenen Zugriffsbereich und erscheinen nicht hier. Der [Wissensüberblick](/de/platform/knowledge/overview) hilft bei der Wahl des Ablageorts.

## Aus Microsoft 365 oder Google Drive importieren

Wähle **Von Microsoft 365** oder **Von Google Drive** unter **Dokumente hochladen**. Verbinde beim ersten Mal dein Konto und erlaube den Import. Meldet Tale eine fehlende Einrichtung, muss ein Administrator den Dienst unter [Connectoren](/de/platform/admin/connectors) konfigurieren.

Wähle Dateien oder Ordner und anschließend den Importmodus:

| Modus | Ergebnis |
| --- | --- |
| **Einmaliger Import** | Kopiert die Auswahl einmal und erhält die Ordnerstruktur. Spätere Änderungen an der Quelle ändern die Kopie nicht. |
| **Synchronisierungsimport** | Hält die unterstützte Auswahl aktuell. Neue Dateien folgen bei einem späteren Abgleich; Änderungen werden neu indexiert; an der Quelle gelöschte Dateien verschwinden aus dem Abbild. |

In der Bibliothek zeigt die Spalte **Quelle**, woher eine Datei stammt. Eine importierte Datei trägt das Logo von OneDrive, SharePoint oder Google Drive. Kreispfeile neben dem Logo bedeuten, dass ein Synchronisierungsimport die Datei aktuell hält; sie stehen auch beim synchronisierten Ordner selbst. Durchgestrichene Kreispfeile stehen für einen einmaligen Import. Hochgeladene Dateien, von einem Agenten oder einer Automatisierung geschriebene Dateien, Wissenseinträge und API-Importe zeigen jeweils ein eigenes Symbol. Zeigst du auf ein Symbol, erscheint die Quelle als Text.

Ein neuer Ordnerabgleich kann auch einen früheren Import umordnen. Ist dieselbe Quelldatei bereits in Tale vorhanden, übernimmt die Synchronisierung dieses Dokument und verschiebt es in den passenden Sync-Ordner — selbst wenn der Inhalt unverändert ist. Entscheidend ist die Identität der Quelldatei, nicht nur ihr Name. Gibt es keinen Zielordner für den Abgleich, bleibt die bisherige Ablage erhalten.

Bei Microsoft 365 stehen **Mein OneDrive** und **SharePoint-Websites** zur Wahl. Die Synchronisierung unterstützt persönliche OneDrive-Ordner; SharePoint wird einmalig importiert. Wähle bei Google Drive aus Mein Drive. Native Google Docs, Tabellen und Präsentationen werden übersprungen. Exportiere sie zuerst als PDF oder Office-Dateien.

Ist ein Ordner zu groß für eine vollständige Auflistung, lehnt Tale den Import ab. Wähle kleinere Unterordner oder nutze die Synchronisierung, soweit unterstützt. Wird der ausgewählte Quellordner oder die Quelldatei gelöscht, entfernt Tale das Abbild und beendet die Synchronisierung.

Eine Synchronisierung läuft etwa alle 15 Minuten über das Konto des Mitglieds, das sie eingerichtet hat. Eine an der Quelle hinzugefügte Datei erscheint innerhalb dieses Zeitfensters in ihrem Ordner und wird dann wie ein Upload indexiert. Erreicht ein Durchlauf die Quelle nicht, ersetzt die Zelle **Quelle** der Ordnerzeile die Kreispfeile durch ein rotes Warnzeichen mit dem Hinweis **Sync-Fehler** — oder durch einen roten gezogenen Stecker mit dem Hinweis **Neu verbinden**, wenn die Microsoft-365- oder Google-Drive-Verbindung dieses Mitglieds abgelaufen ist. Das Symbol öffnet die Ursache, den Beginn der Fehlschläge und das Konto, über das die Synchronisierung läuft; die bisher synchronisierten Dateien bleiben erhalten. Das Mitglied wird außerdem über die Glocke und per E-Mail benachrichtigt: bei einer abgelaufenen Verbindung sofort, sonst sobald die Synchronisierung eine Stunde lang fehlschlägt. Verbindet es das Konto erneut — der Dialog bietet das diesem Mitglied an —, läuft die Synchronisierung beim nächsten Durchlauf weiter. Jedes Mitglied, das Dokumente importieren darf, kann stattdessen einen neuen Synchronisierungsimport desselben Elements starten und die Synchronisierung über das eigene Konto übernehmen. Der Hinweis verschwindet mit dem nächsten erfolgreichen Durchlauf.

Über **Synchronisierung beenden** im Zeilenmenü bleiben die importierten Dateien erhalten, ohne weiter aktualisiert zu werden. Das Löschen des importierten Elements beendet die Synchronisierung ebenfalls. Die Originale in OneDrive oder Google Drive bleiben unberührt. **Google Drive trennen** im Importdialog widerruft die Verbindung; verbinde dich für weitere Importe erneut.

## Gelenktes Dokument überarbeiten

Nutze ein gelenktes Dokument, wenn die Freigabe mit genau der Datei verknüpft bleiben muss, die der Reviewer gesehen hat. Ersetzt du die Datei im Entwurf, aktualisiert Tale den bestehenden Datensatz; lädst du eine weitere Datei mit demselben Namen hoch, entsteht weiterhin ein separates Dokument.

<Steps>

<Step title="Gelenktes Dokument wählen">

Öffne bei einem normalen Upload das Zeilenmenü und klicke auf **Als gelenktes Dokument führen**. Der Datensatz steht danach auf `v1 · Entwurf`. Ein freigegebenes Dokument bietet **Datei ersetzen** und **Neue Revision**. Nutze **Neue Revision** nur, wenn du den nächsten Entwurf ohne Ersatzdatei brauchst.

</Step>

<Step title="Aktuelle Datei ersetzen">

Öffne das Zeilenmenü eines Entwurfs oder freigegebenen Dokuments und klicke auf **Datei ersetzen**. Wähle eine Datei im selben Format. Ein Entwurf behält seine Revision. Bei einem freigegebenen Dokument erhält Tale die freigegebene Version vN und öffnet Entwurf vN+1 erst, wenn das Ersetzen abgeschlossen ist; brichst du ab oder schlägt der Upload fehl, bleibt vN freigegeben. Ein Legal Hold blockiert beide Wege.

<Frame caption="Der Dialog nimmt genau eine Datei im vorhandenen Format des Datensatzes an.">

![Der Dialog „Datei ersetzen“ für ein gelenktes Textdokument mit einer Dateiauswahl für dasselbe Format und dem Hinweis, dass freigegebene Versionen im Verlauf bleiben.](/images/platform/controlled-document-replace-file.webp)

</Frame>

</Step>

<Step title="Revision prüfen und einreichen">

Öffne die Dokumentvorschau und prüfe, ob sie die Ersatzdatei zeigt. Öffne dann das Zeilenmenü und klicke auf **Zum Review einreichen**. Die Auswahl bietet nur Mitglieder an, die das Dokument auch öffnen können — eine Projekt-Datei verlangt Bearbeitungszugriff auf das Projekt — und nie dich selbst: Nur der Reviewer, den du benennst, kann freigeben oder Änderungen anfordern, jedes Review ist also ein zweites Augenpaar.

Der Entwurf bleibt während der Entscheidung für genau diese Datei gesperrt; der Reviewer wird über die Glocke und per E-Mail benachrichtigt, und die Entscheidung kommt auf demselben Weg zu dir zurück — eine Änderungsanforderung trägt das Feedback des Reviewers, das der Einreichen-Dialog vor deinem nächsten Anlauf ebenfalls zeigt.

Kann der Reviewer nicht mehr entscheiden — er hat die Organisation verlassen, wurde deaktiviert oder hat den Zugriff auf das Dokument verloren —, öffne das Zeilenmenü und klicke auf **Reviewer wechseln**: Die offene Anfrage geht an das Mitglied, das du benennst, und der Datensatz bleibt für dieselbe Datei gesperrt.

</Step>

</Steps>

## Vor dem Löschen die Inhalte prüfen

**Löschen** entfernt das Dokument und seinen indexierten Inhalt. Die Bestätigung erläutert die Folgen. Sichere eine Kopie, wenn du die Datei später brauchst. Ein erneuter Upload erzeugt ein neues Dokument.

<Warning>

Das Löschen eines Ordners entfernt seine Dateien und Unterordner endgültig. Bei einem synchronisierten Ordner werden auch Sync-Konfiguration und Verlauf entfernt. Die Originale in Microsoft 365 oder Google Drive bleiben unberührt.

</Warning>

Ein gelenktes Dokument mit einer freigegebenen Version ist vor dem Löschen geschützt, auch während der Vorbereitung eines späteren Entwurfs. Das Menü zeigt **Geschütztes gelenktes Dokument**. Ein Ordner mit einem solchen Dokument lässt sich ebenfalls nicht löschen. Auch ein Legal Hold kann Änderungen oder Löschungen sperren. Lass die konkrete Beschränkung von einem Administrator prüfen, statt sie durch doppelte Uploads zu umgehen.
