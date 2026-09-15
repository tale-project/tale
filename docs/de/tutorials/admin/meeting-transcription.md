---
title: Ein Besprechungsprotokoll durchsuchbar machen
description: Ein geprüftes Transkript ins passende Projekt importieren, die Indexierung prüfen und wiederkehrende Übernahmen vorbereiten.
---
Mache ein exportiertes Besprechungstranskript zur Projektquelle, die sich im Chat abfragen lässt. Beginne mit einer geprüften Textdatei und kontrolliere Zugriff und Indexierung, bevor du die Übernahme automatisierst. Du brauchst Bearbeitungsrechte im Zielprojekt und die Erlaubnis, das Transkript mit dessen Mitgliedern zu teilen.

Tale enthält weder einen eigenen Meetily-Konnektor noch einen überwachten Transkriptordner. Exportiere aus deinem Transkriptionswerkzeug und nutze anschließend den Dokumentupload oder die API von Tale. Diese Anleitung beginnt nach der Transkription; sie zeichnet keine Besprechung auf und richtet kein Transkriptionswerkzeug ein.

## Das Transkript vorbereiten

Exportiere lesbaren Text, für den ersten Test am besten als `.txt`. Prüfe Namen, Sprecherzuordnung, wichtige Zahlen und Entscheidungen anhand der Besprechungsaufzeichnung. Automatische Transkripte können gerade die Details falsch erkennen, auf die sich andere später verlassen.

Wähle einen eindeutigen Namen wie `2026-09-14-projektbesprechung.txt`. Nenne Datum, Thema und Teilnehmende auch im Text. Entferne Inhalte, die nicht für die Projektmitglieder bestimmt sind. Für den Textimport musst du die Audiodatei nicht hochladen.

## Den Leserkreis wählen

Lade das Transkript im Projektreiter **Wissen** hoch, wenn es zu diesem Projekt gehört. Die Projektmitgliedschaft steuert den Zugriff; die Suche erfolgt aus den Chats dieses Projekts. Nutze **Wissen > Dokumente** nur, wenn es unter dem passenden Teamzugriff zum Organisationswissen gehören soll.

Prüfe den Leserkreis vor dem Upload. Eine Projektdatei erscheint nicht automatisch in der Dokumentbibliothek der Organisation oder im Chat eines anderen Projekts.

## Hochladen und kontrollieren

1. Öffne das Zielprojekt und wähle **Wissen**.
2. Wähle den Zielordner und lade das Transkript über **Datei hinzufügen** hoch.
3. Öffne die Datei und prüfe Titel und lesbaren Inhalt.
4. Warte vor dem Suchtest auf **Indexiert**. **In Warteschlange** und **Wird indexiert** bedeuten, dass die Datei noch vorbereitet wird.

<Frame caption="Prüfe in der Projektdateiliste den Ablageort und den Indexierungsstatus.">

![Der Projektreiter Wissen zeigt hochgeladene Dateien mit ihrem Indexierungsstatus.](/images/platform/project-knowledge-files.webp)

</Frame>

Prüfe bei **Fehlgeschlagen** den Fehler und nutze nach der Behebung **Indexierung erneut versuchen**. Bei **Nicht indexiert** kannst du, sofern angeboten, **Jetzt indexieren** wählen. Anhaltende Fehler erfordern möglicherweise eine Prüfung von Speicher, Textextraktion und Embedding-Anbieter durch einen Admin. [Projektdateien verwalten](/de/platform/projects/manage-files) erklärt Status und Grenzen.

## Die Suche im Projekt prüfen

Öffne einen Chat im selben Projekt. Frage nach einem konkreten, zuvor geprüften Detail, etwa: „Wer hat in der Besprechung vom 14. September den nächsten Entwurf übernommen?“ Öffne die zitierte Quelle und vergleiche die Antwort mit dem Original. Ein abgeschlossener Upload beweist noch keine funktionierende Suche; eine Antwort ersetzt den Quellenvergleich nicht.

Prüfe bei vertraulichen Transkripten die Anbieterwege: Die Indexierung kann Text an einen Embedding-Anbieter senden, die Beantwortung gefundene Passagen an ein Chatmodell. Eine lokale Transkription hält diese späteren Schritte nicht automatisch lokal. Lass beide Wege vom Admin oder Betreiber prüfen.

## Die Übernahme wiederholbar machen

Für gelegentliche Besprechungen reicht die Upload-Checkliste. Für regelmäßige Übernahmen kann ein Entwickler die [Projektupload-API](/de/develop/api-reference) oder einen [Automatisierungs-Webhook](/de/tutorials/developer/trigger-automation-via-webhook) mit einer eigens eingerichteten Importautomatisierung nutzen. Ein Webhook startet diese Automatisierung; allein speichert er kein Transkript.

Die Integration muss das Projekt auswählen, doppelte Zustellungen vermeiden, die Indexierung anfordern und deren Ergebnis prüfen. Projektdateien aus der REST-API überspringen die Indexierung standardmäßig; beim Verknüpfen fordert `skipRagIndexing: false` sie an. Ein gleicher Dateiname erzeugt keine Revision. Nutze für geprüfte Versionsverläufe den vorgesehenen Ersetzungsablauf.
