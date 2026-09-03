---
title: Wissenseinträge
description: Wissenseinträge sind kleine Fakten mit Themen-Schlüssel in der Wissensdatenbank — von Hand oder über die API hinzugefügt — mit einer aktiven Version pro Thema und vollem Versionsverlauf.
---

Wissenseinträge sind die Faktenfläche der Wissensdatenbank. Wo ein Dokument eine ganze Datei trägt, trägt ein Eintrag einen kleinen, haltbaren Fakt — „Der Laden öffnet um 9“, „Das Rückgabefenster beträgt 3 Tage“ —, abgelegt unter einem Themennamen. Einträge fahren auf derselben Indexierungs-Pipeline wie Dokumente, jeder Agent mit passendem Umfang ruft sie also ab und zitiert sie wie jede andere Quelle; besonders macht sie, wie sie hereinkommen und wie Korrekturen ersetzen, was sie korrigieren.

<Frame caption="Der Wissenseinträge-Tab — Thema, Inhalt, Quelle und Indexierungsstatus pro Fakt.">

![Der Wissenseinträge-Tab mit drei von Hand hinzugefügten Fakten, jeder mit dem Quellen-Tag Manuell und dem Status-Badge Indexiert.](/images/platform/knowledge-entries-list.webp)

</Frame>

## Woher Einträge kommen

**Nicht aus dem Chat.** Die frühere Version ließ einen Agenten einen Fakt aus einem Gespräch als Karte **In Wissensdatenbank speichern** vorschlagen, die du freigegeben hast. Diese Karte gibt es in dieser Version nicht: Der Chat-Assistent hat kein Schreib-Tool und schlägt nichts zum Speichern vor, kein Agent schreibt also überhaupt in das geteilte Wissen der Organisation. Ein Eintrag, dessen **Quelle** **Chat** zeigt, stammt aus der früheren Version; neue Einträge kommen von Hand oder über den Knowledge-Entries-Endpoint der REST-API.

<Note>

Einen Wissens-Schreib-Schalter pro Agent gibt es nicht einzuschalten. Ein Fakt landet in der Wissensdatenbank, weil ein Mensch ihn eingetippt oder ein Programm ihn über die API angelegt hat — nie, weil ein Modell beschlossen hat, sich etwas zu merken.

</Note>

**Von Hand.** Klicke unter **Wissen > Wissenseinträge** auf **Eintrag hinzufügen**. Gib ein **Thema** (bis zu 120 Zeichen — kurz und stabil, wie eine Überschrift) und den **Inhalt** als Markdown (bis zu 8000 Zeichen), so geschrieben, dass er ohne umgebendes Gespräch verständlich ist. Die Spalte **Quelle** hält die zwei Herkünfte auseinander: **Chat** oder **Manuell**.

## Eine aktive Version pro Thema

Themen sind der Dedup-Schlüssel: Eine Bearbeitung ersetzt die aktive Version, statt eine zweite daneben zu stellen — die Wissensdatenbank serviert nie zwei Versionen desselben Fakts. Einen neuen Eintrag unter einem bestehenden Thema anzulegen wird mit einem Duplikat-Fehler abgewiesen; bearbeite stattdessen den bestehenden Eintrag.

Ersetzte Versionen gehen nicht verloren. Öffne einen Eintrag für seine Details — Indexierungsstatus, letzte Aktualisierung und den **Versionsverlauf** mit jeder abgelösten Version und dem Zeitpunkt der Ablösung. Nur die aktive Version ist für den Abruf indexiert; der Verlauf existiert für Audit und Nachschlagen.

## Bearbeiten, Indexieren, Löschen

Bearbeiten erzeugt eine neue aktive Version und indexiert im Hintergrund neu — das **Status**-Badge fällt kurz in die Indexierung und kehrt zu **Indexiert** zurück, sobald die Suche den neuen Text aufgenommen hat. Löschen entfernt den ganzen Eintrag: Die Bestätigung warnt, dass er auch aus der Wissensdatenbank verschwindet, Agenten ihn also nicht mehr finden, und dass sich die Aktion nicht rückgängig machen lässt. War der Fakt richtig, füge ihn neu hinzu.

## Wo das hingehört

Wissenseinträge sind die kleinste Einheit der Wissensdatenbank: Ein einmal notierter Fakt wird etwas, das jede Bahn abruft, und eine aktive Version pro Thema garantiert, dass der alte Fakt verschwindet, sobald der neue landet. Für die dateiförmige Hälfte lies [Dokumente](/de/platform/knowledge/documents); wie Agenten binden und abrufen, steht in [Agent-Wissen](/de/platform/agents/knowledge).
