---
title: Dokumente
description: Auf dem Dokumente-Tab laden Redakteure Dateien in die Wissensdatenbank, sehen ihnen beim Indexieren zu und verwalten ihren Lebenszyklus — Upload-Quellen, RAG-Status, Team-Bindung, Ordner und Neuindexierung.
---

Der Dokumente-Tab ist die Dateifläche der Wissensdatenbank. Redakteure laden Dateien hoch, Tale schickt jede durch die Indexierungs-Pipeline — Text extrahieren, chunken, die Chunks einbetten, speichern —, und Agenten, deren Wissens-Umfang das Dokument abdeckt, rufen zur Antwortzeit relevante Passagen ab und zitieren sie. Diese Seite behandelt die Operator-Seite: Hochladen, die Status-Spalte, Team-Bindung, Ordner und den Lebenszyklus eines Dokuments.

<Frame caption="Die Dokumente-Tabelle — Größe, Quelle, RAG-Status und Team-Bindung pro Datei.">

![Der Dokumente-Tab des Wissensbereichs mit drei hochgeladenen Textdateien samt Spalten für Größe, Quelle, RAG-Status und Team.](/images/get-started/documents-list.webp)

</Frame>

## Hochladen

Öffne **Wissen > Dokumente** und klicke auf **Dokumente hochladen** — das Menü bietet **Von deinem Gerät** und **Von Microsoft 365**. Das Upload-Tor akzeptiert die Formate, die den Großteil des Org-Wissens abdecken: PDF, Word (`.doc`, `.docx`), OpenDocument-Text (`.odt`), PowerPoint (`.ppt`, `.pptx`), Excel (`.xls`, `.xlsx`), CSV, reinen Text und Bilder (JPG, PNG, GIF, WEBP). Alles andere wird beim Upload abgewiesen.

Hochladen und Indexieren sind zwei getrennte Tatsachen, und die Spalte **RAG-Status** verfolgt die zweite: **Wird indexiert**, während die Pipeline läuft, **Indexiert**, wenn Agenten den Inhalt abrufen können, **Fehlgeschlagen**, wenn die Pipeline auf einen Fehler lief, und **Neuindexierung nötig**, wenn die gespeicherten Chunks veraltet sind. Moderne Formate indexieren; das alte Office-Trio (`.doc`, `.xls`, `.ppt`) lädt hoch und bleibt herunterladbar, zeigt aber **Nicht indexiert** — Agenten kommen an den Inhalt erst heran, wenn du die Datei im modernen Format neu speicherst.

## Gelenktes Dokument überarbeiten

Nutze ein gelenktes Dokument, wenn die Freigabe mit genau der Datei verknüpft bleiben muss, die der Reviewer gesehen hat. Ersetzt du die Datei im Entwurf, aktualisiert Tale den bestehenden Datensatz; lädst du eine weitere Datei mit demselben Namen hoch, entsteht weiterhin ein separates Dokument.

<Steps>

<Step title="Entwurf erstellen oder öffnen">

Öffne bei einem normalen Upload das Zeilenmenü und klicke auf **Als gelenktes Dokument führen**. Der Datensatz steht danach auf `v1 · Entwurf`. Ist eine Version freigegeben, öffne dasselbe Menü und klicke auf **Neue Revision**, um den nächsten Entwurf anzulegen, ohne den freigegebenen Stand zu ändern.

</Step>

<Step title="Datei im Entwurf ersetzen">

Öffne das Zeilenmenü des Entwurfs und klicke auf **Datei ersetzen**. Wähle eine Datei im selben Format und klicke im Dialog erneut auf **Datei ersetzen**. Dokumentname und Revision bleiben gleich, während Tale die neuen Daten speichert und indexiert; ein Legal Hold blockiert diese Aktion.

<Frame caption="Der Dialog nimmt genau eine Datei im vorhandenen Format des Entwurfs an.">

![Der Dialog „Datei ersetzen" für ein gelenktes Textdokument mit einer Dateiauswahl für dasselbe Format und dem Hinweis, dass freigegebene Versionen im Verlauf bleiben.](/images/platform/controlled-document-replace-file.webp)

</Frame>

</Step>

<Step title="Revision prüfen und einreichen">

Öffne die Dokumentvorschau und prüfe, ob sie die Ersatzdatei zeigt. Öffne dann das Zeilenmenü und klicke auf **Zum Review einreichen**. Der Entwurf bleibt während der Entscheidung für genau diese Datei gesperrt.

</Step>

</Steps>

## Import aus Microsoft 365

**Von Microsoft 365** importiert aus OneDrive oder SharePoint statt von der Festplatte: wähle Dateien oder Ordner und entscheide dich für einen Import-Modus. **Einmaliger Import** holt die Dateien einmal — sie verhalten sich wie Uploads von der Festplatte. **Synchronisierungsimport** hält die Auswahl synchron: neue Dateien im OneDrive-Ordner erscheinen bei einem späteren Sync-Lauf, geänderte Dateien werden neu indexiert, und an der Quelle gelöschte Dateien verschwinden aus dem Workspace. Beide Modi erhalten die Ordnerstruktur deiner Auswahl. Die Synchronisierung deckt persönliche OneDrive-Ordner ab — eine SharePoint-Auswahl importiert immer einmalig.

Um die Synchronisierung zu beenden — bei einem ganzen synchronisierten Ordner oder einer einzelnen synchronisierten Datei — öffne das Menü der Zeile und klicke auf **Synchronisierung beenden**; die importierten Dokumente bleiben im Workspace und werden nicht mehr aktualisiert. Auch das Löschen eines synchronisierten Ordners oder einer einzelnen Datei beendet die Synchronisierung. In allen Fällen bleiben die Dateien in OneDrive unberührt.

## Team-Bindung, Ordner, Quellen

Jede Zeile trägt eine Zelle **Teams** — standardmäßig **Organisationsweit**, oder die Teams, die du über **Team zuweisen** im Zeilenmenü wählst. Ein team-gebundenes Dokument ist für Mitglieder und Agenten außerhalb des Teams unsichtbar; das ist der Zugriffshebel der Wissensdatenbank. Projekt-Dateien liegen ganz außerhalb dieses Modells: Der **Wissen**-Tab eines Projekts hält Dateien, die auf dieses eine Projekt begrenzt sind, und sie tauchen weder in dieser Bibliothek noch in ihrer Team-Bindung auf — siehe [Dateien verwalten](/de/platform/projects/manage-files).

**Neuer Ordner** hält große Bibliotheken navigierbar, und Connectors bringen ihre eigene Struktur mit: Dokumente aus einem OneDrive- oder SharePoint-Sync landen unter Sync-Ordnern und zeigen ihre Herkunft in der Spalte **Quelle**, was Zitate bis ins Quellsystem nachvollziehbar hält.

<Warning>

Das Löschen eines Ordners löscht jede Datei und jeden Unterordner darin endgültig. Das Löschen eines OneDrive-Sync-Ordners entfernt auch dessen Auto-Sync-Konfiguration und -Historie — nie aber die Dateien in OneDrive selbst.

</Warning>

## Neu indexieren und löschen

**Neu indexieren** (Zeilenmenü) lässt die Pipeline erneut über die gespeicherte Datei laufen — der richtige Zug nach einem Indexierungsfehler oder wenn ein Dokument **Neuindexierung nötig** zeigt. **Löschen** entfernt das Dokument und seine indexierten Chunks; die Bestätigung sagt es unumwunden — die Aktion lässt sich nicht rückgängig machen. Dieselbe Datei erneut hochzuladen bringt den Inhalt als frisches Dokument zurück.

Jedes Dokument zeigt einen Status: **In Warteschlange** (wartet — eine ausgelastete Organisation indexiert einige Dateien gleichzeitig, der Rest reiht sich ein), **Wird indexiert**, **Indexiert**, **Fehlgeschlagen** oder **Nicht unterstützt** (ein Altformat wie `.doc`/`.ppt`/`.xls`, das sich problemlos speichern und herunterladen lässt, aber keinen Text-Extraktor hat und daher nie für die Suche indexiert wird). Ein durch ein Zeitlimit oder einen Backend-Neustart unterbrochener Indexierungsvorgang erholt sich innerhalb weniger Minuten von selbst — er wird wiederholt oder als **Fehlgeschlagen** mit Wiederholen-Option markiert, nie steckengelassen. Wenn deine Organisation ein Speicher-Kontingent pro Nutzer durchsetzt, zählen fehlgeschlagene und nicht unterstützte Dateien weiterhin dagegen, bis sie gelöscht werden — Platz schaffen heißt also, nicht mehr benötigte Dateien zu entfernen.

Ein Klick auf ein Dokument öffnet die Vorschau, mit einer Seitenleiste für Größe, Quelle, RAG-Status, Teams, hochladende Person und Änderungsdatum — der schnellste Weg zu prüfen, worauf ein Zitat wirklich zeigt.

## Dokumente gegenüber strukturierten Daten

Dokumente sind die unstrukturierte Hälfte der Wissensdatenbank. Ist der Inhalt eine Liste gleichartiger Dinge mit denselben Feldern — Kontakte, Produkte, Zulieferer —, dient ein typisierter Datensatz den Agenten besser als ein hochgeladenes Tabellenblatt: exakte Werte statt abgerufener Passagen. Die Entscheidungsregeln stehen in [Strukturierte Daten](/de/platform/knowledge/structured-data).

## Wo das hingehört

Dokumente sind die meistgenutzte Ecke der Wissensdatenbank — die meisten Zitate in den meisten Antworten zeigen hierher. Die Abrufseite — wie der Wissens-Umfang eines Agenten entscheidet, was er durchsucht — ist [Agent-Wissen](/de/platform/agents/knowledge); die faktengroße Schwesterfläche sind die [Wissenseinträge](/de/platform/knowledge/knowledge-entries), die dieselbe Pipeline dokumentweise nutzen.
