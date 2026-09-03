---
title: Dokumente
description: Auf dem Dokumente-Tab laden Redakteure Dateien in die Wissensdatenbank, sehen ihnen beim Indexieren zu und verwalten ihren Lebenszyklus — Upload-Quellen, RAG-Status, Team-Bindung, Ordner und Neuindexierung.
---

Der Dokumente-Tab ist die Dateifläche der Wissensdatenbank. Redakteure laden Dateien hoch, Tale schickt jede durch die Indexierungs-Pipeline — Text extrahieren, chunken, die Chunks einbetten, speichern —, und Agenten, deren Wissens-Umfang das Dokument abdeckt, rufen zur Antwortzeit relevante Passagen ab und zitieren sie. Diese Seite behandelt die Operator-Seite: Hochladen, die Status-Spalte, Team-Bindung, Ordner und den Lebenszyklus eines Dokuments.

<Frame caption="Die Dokumente-Tabelle — Größe, Quelle, RAG-Status und Team-Bindung pro Datei.">

![Der Dokumente-Tab des Wissensbereichs mit drei hochgeladenen Textdateien samt Spalten für Größe, Quelle, RAG-Status und Team.](/images/get-started/documents-list.webp)

</Frame>

## Hochladen

Öffne **Wissen > Dokumente** und klicke auf **Dokumente hochladen** — das Menü bietet **Von deinem Gerät**, **Von Microsoft 365** und **Von Google Drive**. Das Upload-Tor akzeptiert die Formate, die den Großteil des Org-Wissens abdecken: PDF, Word (`.doc`, `.docx`), OpenDocument-Text (`.odt`), PowerPoint (`.ppt`, `.pptx`), Excel (`.xls`, `.xlsx`), CSV, reinen Text und Bilder (JPG, PNG, GIF, WEBP). Alles andere wird beim Upload abgewiesen.

Hochladen und Indexieren sind zwei getrennte Tatsachen, und die Spalte **RAG-Status** verfolgt die zweite: **Wird indexiert**, während die Pipeline läuft, **Indexiert**, wenn Agenten den Inhalt abrufen können, **Fehlgeschlagen**, wenn die Pipeline auf einen Fehler lief, und **Neuindexierung nötig**, wenn die gespeicherten Chunks veraltet sind. Moderne Formate indexieren; das alte Office-Trio (`.doc`, `.xls`, `.ppt`) lädt hoch und bleibt herunterladbar, zeigt aber **Nicht indexiert** — Agenten kommen an den Inhalt erst heran, wenn du die Datei im modernen Format neu speicherst.

## Gelenktes Dokument überarbeiten

Nutze ein gelenktes Dokument, wenn die Freigabe mit genau der Datei verknüpft bleiben muss, die der Reviewer gesehen hat. Ersetzt du die Datei im Entwurf, aktualisiert Tale den bestehenden Datensatz; lädst du eine weitere Datei mit demselben Namen hoch, entsteht weiterhin ein separates Dokument.

<Steps>

<Step title="Gelenktes Dokument wählen">

Öffne bei einem normalen Upload das Zeilenmenü und klicke auf **Als gelenktes Dokument führen**. Der Datensatz steht danach auf `v1 · Entwurf`. Ein freigegebenes Dokument bietet **Datei ersetzen** und **Neue Revision**. Nutze **Neue Revision** nur, wenn du den nächsten Entwurf ohne Ersatzdatei brauchst.

</Step>

<Step title="Aktuelle Datei ersetzen">

Öffne das Zeilenmenü eines Entwurfs oder freigegebenen Dokuments und klicke auf **Datei ersetzen**. Wähle eine Datei im selben Format. Ein Entwurf behält seine Revision. Bei einem freigegebenen Dokument erhält Tale die freigegebene Version vN und öffnet Entwurf vN+1 erst, wenn das Ersetzen abgeschlossen ist; brichst du ab oder schlägt der Upload fehl, bleibt vN freigegeben. Ein Legal Hold blockiert beide Wege.

<Frame caption="Der Dialog nimmt genau eine Datei im vorhandenen Format des Datensatzes an.">

![Der Dialog „Datei ersetzen" für ein gelenktes Textdokument mit einer Dateiauswahl für dasselbe Format und dem Hinweis, dass freigegebene Versionen im Verlauf bleiben.](/images/platform/controlled-document-replace-file.webp)

</Frame>

</Step>

<Step title="Revision prüfen und einreichen">

Öffne die Dokumentvorschau und prüfe, ob sie die Ersatzdatei zeigt. Öffne dann das Zeilenmenü und klicke auf **Zum Review einreichen**. Die Auswahl bietet nur Mitglieder an, die das Dokument auch öffnen können — eine Projekt-Datei verlangt Bearbeitungszugriff auf das Projekt — und nie dich selbst: Nur der Reviewer, den du benennst, kann freigeben oder Änderungen anfordern, jedes Review ist also ein zweites Augenpaar. Der Entwurf bleibt während der Entscheidung für genau diese Datei gesperrt; der Reviewer wird über die Glocke und per E-Mail benachrichtigt, und die Entscheidung kommt auf demselben Weg zu dir zurück — eine Änderungsanforderung trägt das Feedback des Reviewers, das der Einreichen-Dialog vor deinem nächsten Anlauf ebenfalls zeigt.

</Step>

</Steps>

## Import aus Microsoft 365

**Von Microsoft 365** steht immer im Upload-Menü. Beim ersten Mal bittet Tale dich, OneDrive und SharePoint für den Import in Dokumente zu autorisieren. Meldet der Dialog, dass der Import noch nicht eingerichtet ist, hinterlegt zuerst ein Org-Admin die OAuth-App unter **Einstellungen > Connectors > OAuth-Apps** (oder der Betreiber registriert eine im Deployment) — meldet sich deine Organisation über Microsoft Entra ID an, lässt sich dort die SSO-App-Registrierung übernehmen, statt eine neue zu registrieren. Danach wählst du Dateien oder Ordner unter **Mein OneDrive** oder **SharePoint-Websites** und einen Import-Modus. **Einmaliger Import** holt die Dateien einmal — sie verhalten sich wie Uploads von der Festplatte. **Synchronisierungsimport** hält die Auswahl synchron: neue Dateien im OneDrive-Ordner erscheinen bei einem späteren Sync-Lauf, geänderte Dateien werden neu indexiert, und an der Quelle gelöschte Dateien verschwinden aus dem Workspace. Beide Modi erhalten die Ordnerstruktur deiner Auswahl. Die Synchronisierung deckt persönliche OneDrive-Ordner ab — eine SharePoint-Auswahl importiert immer einmalig. Enthält ein Ordner mehr Elemente, als ein Import auflisten kann, lehnt der Dialog ihn ab, statt ihn nur teilweise zu importieren — importiere die Unterordner einzeln oder nutze den Synchronisierungsimport.

Um die Synchronisierung zu beenden — bei einem ganzen synchronisierten Ordner oder einer einzelnen synchronisierten Datei — öffne das Menü der Zeile und klicke auf **Synchronisierung beenden**; die importierten Dokumente bleiben im Workspace und werden nicht mehr aktualisiert. Auch das Löschen eines synchronisierten Ordners oder einer einzelnen Datei beendet die Synchronisierung. In allen Fällen bleiben die Dateien in OneDrive unberührt.

## Import aus Google Drive

**Von Google Drive** steht immer im Upload-Menü. Beim ersten Mal bittet Tale dich, Google Drive für den Import in Dokumente zu autorisieren. Meldet der Dialog, dass der Import noch nicht eingerichtet ist, hinterlegt zuerst ein Org-Admin die OAuth-App unter **Einstellungen > Connectors > OAuth-Apps** (oder der Betreiber registriert eine im Deployment). Danach wählst du Dateien oder Ordner in Mein Drive und den Importmodus. **Einmaliger Import** bringt die Dateien einmal hinein — sie verhalten sich wie Uploads vom Gerät. **Synchronisierungsimport** hält die Auswahl aktuell: neue Dateien im Drive-Ordner erscheinen beim nächsten Sync-Lauf, geänderte Dateien werden neu indexiert, und am Quellort gelöschte Dateien verlassen den Workspace. Beide Modi bewahren die Ordnerstruktur deiner Auswahl. Native Google Docs, Tabellen und Präsentationen werden übersprungen — exportiere sie zuerst als PDF oder Office-Format, wenn du sie in Dokumente brauchst.

Um die Synchronisierung zu beenden — bei einem ganzen synchronisierten Ordner oder einer einzelnen synchronisierten Datei — öffne das Menü der Zeile und klicke auf **Synchronisierung beenden**; die importierten Dokumente bleiben im Workspace und werden nicht mehr aktualisiert. Auch das Löschen eines synchronisierten Ordners oder einer einzelnen Datei beendet die Synchronisierung. In allen Fällen bleiben die Dateien in Google Drive unberührt.

Über **Google Drive trennen** im Kopf des Import-Dialogs widerrufst du die Freigabe; verbinde erneut, wenn du weitere Dateien importieren willst.

## Team-Bindung, Ordner, Quellen

Jede Zeile trägt eine Zelle **Teams** — standardmäßig **Organisationsweit**, oder die Teams, die du über **Team zuweisen** im Zeilenmenü wählst. Ein team-gebundenes Dokument ist für Mitglieder und Agenten außerhalb des Teams unsichtbar; das ist der Zugriffshebel der Wissensdatenbank. Projekt-Dateien liegen ganz außerhalb dieses Modells: Der **Wissen**-Tab eines Projekts hält Dateien, die auf dieses eine Projekt begrenzt sind, und sie tauchen weder in dieser Bibliothek noch in ihrer Team-Bindung auf — siehe [Dateien verwalten](/de/platform/projects/manage-files).

**Neuer Ordner** hält große Bibliotheken navigierbar, und Connectors bringen ihre eigene Struktur mit: Dokumente aus einem OneDrive-, SharePoint- oder Google-Drive-Sync landen unter Sync-Ordnern und zeigen ihre Herkunft in der Spalte **Quelle**, was Zitate bis ins Quellsystem nachvollziehbar hält.

<Warning>

Das Löschen eines Ordners löscht jede Datei und jeden Unterordner darin endgültig. Das Löschen eines OneDrive- oder Google-Drive-Sync-Ordners entfernt auch dessen Auto-Sync-Konfiguration und -Historie — nie aber die Dateien in OneDrive oder Google Drive selbst.

</Warning>

## Neu indexieren und löschen

**Neu indexieren** (Zeilenmenü) lässt die Pipeline erneut über die gespeicherte Datei laufen — der richtige Zug nach einem Indexierungsfehler oder wenn ein Dokument **Neuindexierung nötig** zeigt. **Löschen** entfernt das Dokument und seine indexierten Chunks; die Bestätigung sagt es unumwunden — die Aktion lässt sich nicht rückgängig machen. Dieselbe Datei erneut hochzuladen bringt den Inhalt als frisches Dokument zurück. Ein gelenktes Dokument lässt sich nicht mehr löschen, sobald irgendeine Version freigegeben wurde — im Review, freigegeben oder mit offenem nächsten Entwurf zeigt der Menüeintrag stattdessen **Geschütztes gelenktes Dokument**, und ein Ordner mit so einem Datensatz verweigert das Ordner-Löschen genauso. Der freigegebene Stand ist ein aufbewahrtes Dokument; genau dafür gibt es den Lebenszyklus.

Jedes Dokument zeigt einen Status: **In Warteschlange** (wartet — eine ausgelastete Organisation indexiert einige Dateien gleichzeitig, der Rest reiht sich ein), **Wird indexiert**, **Indexiert**, **Fehlgeschlagen** oder **Nicht unterstützt** (ein Altformat wie `.doc`/`.ppt`/`.xls`, das sich problemlos speichern und herunterladen lässt, aber keinen Text-Extraktor hat und daher nie für die Suche indexiert wird). Ein durch ein Zeitlimit oder einen Backend-Neustart unterbrochener Indexierungsvorgang erholt sich innerhalb weniger Minuten von selbst — er wird wiederholt oder als **Fehlgeschlagen** mit Wiederholen-Option markiert, nie steckengelassen. Wenn deine Organisation ein Speicher-Kontingent pro Nutzer durchsetzt, zählen fehlgeschlagene und nicht unterstützte Dateien weiterhin dagegen, bis sie gelöscht werden — Platz schaffen heißt also, nicht mehr benötigte Dateien zu entfernen.

Ein Klick auf ein Dokument öffnet die Vorschau, mit einer Seitenleiste für Größe, Quelle, RAG-Status, Teams, hochladende Person und Änderungsdatum — der schnellste Weg zu prüfen, worauf ein Zitat wirklich zeigt.

## Dokumente gegenüber strukturierten Daten

Dokumente sind die unstrukturierte Hälfte der Wissensdatenbank. Ist der Inhalt eine Liste gleichartiger Dinge mit denselben Feldern — Kontakte, Produkte, Zulieferer —, dient ein typisierter Datensatz den Agenten besser als ein hochgeladenes Tabellenblatt: exakte Werte statt abgerufener Passagen. Die Entscheidungsregeln stehen in [Strukturierte Daten](/de/platform/knowledge/structured-data).

## Wo das hingehört

Dokumente sind die meistgenutzte Ecke der Wissensdatenbank — die meisten Zitate in den meisten Antworten zeigen hierher. Die Abrufseite — wie der Wissens-Umfang eines Agenten entscheidet, was er durchsucht — ist [Agent-Wissen](/de/platform/agents/knowledge); die faktengroße Schwesterfläche sind die [Wissenseinträge](/de/platform/knowledge/knowledge-entries), die dieselbe Pipeline dokumentweise nutzen.
