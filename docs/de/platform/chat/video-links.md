---
title: Videolinks
description: Füg eine Video-URL in den Chat ein, und Tale liest ihr Transkript für den Agent ein — unterstützte Plattformen, wie das Einlesen abläuft und was jeder Fehlerzustand bedeutet.
---

Füg einen Videolink in den Composer ein, und Tale holt das Transkript des Videos, damit der Agent es lesen, zitieren und daraus antworten kann — kein manueller Download, kein Kopieren und Einfügen eines Transkripts. So bringst du einen Vortrag, ein Tutorial oder ein aufgezeichnetes Meeting am schnellsten in eine Antwort.

Diese Seite behandelt den Videolink-Chip im Chat-Composer. Willst du Dateien statt Links einfügen, siehe [Anhänge](/de/platform/chat/attachments).

## Ein durchgespieltes Beispiel

Füg eine YouTube-URL in den Composer ein. Tale erkennt sie als Videolink und setzt unter die Nachricht einen Chip mit dem Titel des Videos und einem Spinner. Hinter dem Chip holt Tale die Untertitel (oder, wenn es keine gibt, die Audiospur, die es transkribiert), indiziert das Transkript und schaltet den Chip auf **Bereit**. Klick **Nachricht senden**, und der Agent antwortet aus dem Transkript und zitiert die Passagen, die er genutzt hat. Ein langes Video wird im Hintergrund weiter indiziert; der Chip zeigt seinen Fortschritt, und das Transkript wird durchsuchbar, sobald die Indizierung abgeschlossen ist.

## Unterstützte Plattformen

Tale liest Links von **YouTube** (inklusive `youtu.be`, `m.youtube.com` und Music), **Vimeo**, **Dailymotion**, **Twitch** und **Bilibili** ein. Ein Link zu einem anderen Host bleibt als gewöhnlicher Text in deiner Nachricht stehen — es erscheint kein Chip. Nur öffentliche Videos funktionieren; alles hinter einem Login, einer Paywall oder einer Regionssperre lässt sich nicht abrufen.

## Was Tale extrahiert

Tale bevorzugt die Untertitel der Plattform, wenn es sie gibt — sie sind exakt und günstig abzurufen. Hat ein Video keine Untertitel, lädt Tale die Audiospur herunter und transkribiert sie per Spracherkennung, sodass auch ein Video ohne Untertitel zu einem durchsuchbaren Transkript wird. So oder so wird das Ergebnis wie jedes andere Wissen indiziert: Der Agent ruft die relevanten Passagen zur Antwortzeit ab, und die Zitate verweisen zurück auf das Transkript.

## Fehlerzustände

Der Chip wird rot, wenn das Einlesen nicht abgeschlossen werden kann, mit einer kurzen Begründung:

<AccordionGroup>

<Accordion title="Die Plattform hat automatisierten Zugriff blockiert">

Video-Plattformen — YouTube am aggressivsten — fordern Anfragen von einem Server statt von einem persönlichen Gerät mit einer „Bist du ein Mensch?"-Abfrage heraus. Trifft das Tales Abruf, meldet der Chip, dass die Plattform den Zugriff verhindert hat. Versuch es in einer Minute erneut (die Blockade ist oft vorübergehend) oder probier dasselbe Video auf einer anderen Plattform. Wer selbst hostet, kann diese Blockaden reduzieren — siehe [unten](#fuer-betreiber-die-selbst-hosten).

</Accordion>

<Accordion title="Zu viele Anfragen">

Die Plattform drosselt Tales Abrufe. Warte einen Moment und nutze das **Erneut versuchen** des Chips; aufeinanderfolgende Abrufe aus derselben Bereitstellung sind die übliche Ursache.

</Accordion>

<Accordion title="Video nicht verfügbar">

Das Video ist privat, gelöscht, alters- oder regionsbeschränkt, oder die URL ist ungültig. Tale kann nur ein öffentliches Video einlesen; für ein gesperrtes gibt es keinen Umweg.

</Accordion>

</AccordionGroup>

Jeder fehlgeschlagene Chip trägt ein **Erneut versuchen**, und ein erneuter Versuch ist unbedenklich — Tale indiziert ein bereits erfolgreiches Video nie doppelt.

## Für Betreiber, die selbst hosten

Eine verwaltete **Cloud**-Bereitstellung übernimmt die Anti-Bot-Maßnahmen für dich. Hostest du selbst und läuft das Einlesen von Videos immer wieder gegen die Bot-Abfrage, bringt die Bereitstellung standardmäßig einen Proof-of-Origin-Token-Provider mit, und du kannst als Eskalation einen Egress-Proxy oder einen vorgewärmten Session-Pool ergänzen. Die Konfiguration steht unter [Video-Ingestion](/de/self-hosted/configuration/video-ingestion).

## Wo das hineinpasst

Videolinks sind der chat-gebundene Weg, eine Antwort in einer Aufzeichnung zu verankern — so wie [Anhänge](/de/platform/chat/attachments) sie in einer Datei verankern. Beide speisen das Retrieval des Agents; keiner bleibt über den Chat hinaus bestehen. Damit das Transkript eines Videos über Chats hinweg wiederverwendbar wird, kopier den eingelesenen Text in ein [Wissen](/de/platform/knowledge/documents)-Dokument.
