---
title: Projektdateien verwalten
description: Lade Referenzdateien hoch, ordne sie, prüfe die Indexierung und unterscheide Löschen vom Verschieben in die Wissensbibliothek.
---

Unter **Wissen** im Projekt liegen Dateien, die dessen Chats abrufen können. Lade eine Referenz einmal hoch und verwende sie in mehreren Projektgesprächen. Zum Hinzufügen, Ordnen oder Entfernen brauchst du Bearbeitungszugriff auf das Projekt.

<Frame caption="Die Dateien gehören zum Projekt. Ihre Statusanzeigen zeigen, ob der Chat ihren Text durchsuchen kann.">

![Der Bereich Wissen im Projekt Website relaunch enthält zwei indexierte Dateien sowie Schaltflächen für neue Ordner und Datei- und Ordner-Uploads.](/images/platform/project-knowledge-files.webp)

</Frame>

## In den passenden Ordner hochladen

1. Öffne das Projekt und wähle **Wissen**.
2. Wähle einen Ordner oder bleibe auf der obersten Ebene.
3. Klicke auf **Datei hinzufügen** oder ziehe Dateien auf die Upload-Fläche.
4. Prüfe, ob jede Datei im gewünschten Ordner erscheint und fertig indexiert wird.

**Neuer Ordner** erstellt einen Ordner auf der obersten Ebene. Mit **Neuer Unterordner** legst du einen Ordner innerhalb eines anderen an. **Ordner hinzufügen** importiert einen Ordner von deinem Gerät und bildet seine Struktur am gewählten Ort nach. Ein Ordner-Upload ist auf 200 Dateien und 200 MB begrenzt. Teile größere Ordner auf und prüfe den Bericht auf übersprungene Dateien.

## Prüfen, ob der Chat die Datei lesen kann

| Status | Bedeutung und Maßnahme |
| --- | --- |
| **In Warteschlange** | Die Datei wartet auf die Verarbeitung. |
| **Wird indexiert…** | Tale bereitet den Text für die Suche vor. |
| **Indexiert** | Der Text ist durchsuchbar. Prüfe eine Antwort anhand der Originaldatei. |
| **Fehlgeschlagen** | Lies verfügbare Fehlerdetails und nutze **Indexierung erneut versuchen**. Wiederholt sich der Fehler, bitte einen Admin um Hilfe. |
| **Nicht indexiert** | Die Datei ist gespeichert, aber nicht durchsuchbar. Nutze **Jetzt indexieren**, sofern angeboten, oder wandle ein Format ohne Textextraktor um. |

Eine Integration kann Dateien ohne Indexierung hochladen. Sie bleiben im Dateibaum sichtbar. Eine unterstützte Textdatei lässt sich auf ausdrückliche Nachfrage direkt lesen; in der Textsuche erscheint sie erst nach der Indexierung.

Organisationsregeln können Datei- und Speichergrenzen weiter einschränken. Versuche bei einem fehlgeschlagenen Upload zuerst eine kleine unterstützte Datei. Ein Admin kann [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits), Speicher und Embedding-Modell prüfen.

## Im Projektchat nach Dateien fragen

Öffne **Chats** in diesem Projekt, starte ein Gespräch und frage nach Dateiname oder Thema. Der Assistent kann Dateien dieses Projekts und zugängliche Dokumente der Wissensbibliothek abrufen. Dateien anderer Projekte erreicht er von hier aus nicht.

Der allgemeine Organisationschat durchsucht keine Projektdateien. Solange sie zum Projekt gehören, stehen sie weder in der Dokumentliste der Organisation noch in deren WebDAV-Bibliothek. Wer sie lesen darf, bestimmt der Projektzugriff. Separate Team-Zuordnungen gibt es bei Projektdateien nicht.

## Gelenkte Dateien mit Prüfverlauf ersetzen

Ein erneuter Upload unter demselben Namen erstellt ein separates Dokument. Ein gleicher Dateiname verknüpft keine Revisionen. Soll eine Freigabe an genau die geprüfte Datei gebunden bleiben, wähle im Zeilenmenü **Als gelenktes Dokument führen**.

Das gelenkte Dokument startet als Entwurf. **Datei ersetzen** aktualisiert einen Entwurf oder öffnet aus einer genehmigten Version den nächsten Entwurf, ohne die genehmigte Version zu verändern. **Zum Review einreichen** friert den Entwurf für den benannten Reviewer ein. [Gelenkte Dokumente](/de/platform/knowledge/documents) erklärt den gesamten Ablauf und die Regeln für Reviewer.

## In die Wissensbibliothek verschieben oder löschen

**Aus Projekt entfernen** verschiebt die Datei in die Wissensbibliothek der Organisation. Die Datei wird dabei nicht gelöscht.

<Warning>

Durch das Entfernen aus dem Projekt wird die Datei für alle Personen der Organisation sichtbar. Verwende diese Aktion nur, wenn du diesen größeren Personenkreis erreichen möchtest. Lies die Bestätigung vor dem Fortfahren.

</Warning>

Soll die Datei vollständig entfernt werden, nutze **Löschen** im Zeilenmenü und lies die Bestätigung. Das Löschen eines Ordners entfernt auch seine Dateien, Unterordner und Sucheinträge. Über den Dateibaum lassen sich diese Aktionen nicht rückgängig machen. Ein Legal Hold oder geschützte gelenkte Dokumente können das Löschen verhindern.

Wird eine Datei in mehreren unabhängigen Projekten gebraucht, eignet sich möglicherweise eine passend freigegebene Kopie in der [Wissensbibliothek](/de/platform/knowledge/documents). Vermeide mehrere widersprüchliche Fassungen derselben Richtlinie.
