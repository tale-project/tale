---
title: Wissenseinträge
description: Wissenseinträge sind kleine Fakten mit Themen-Schlüssel in der Wissensdatenbank — aus dem Chat mit menschlicher Freigabe erfasst oder von Hand hinzugefügt — mit einer aktiven Version pro Thema und vollem Versionsverlauf.
---

Wissenseinträge sind die Faktenfläche der Wissensdatenbank. Wo ein Dokument eine ganze Datei trägt, trägt ein Eintrag einen kleinen, haltbaren Fakt — „Der Laden öffnet um 9“, „Das Rückgabefenster beträgt 3 Tage“ —, abgelegt unter einem Themennamen. Einträge fahren auf derselben Indexierungs-Pipeline wie Dokumente, jeder Agent mit passendem Umfang ruft sie also ab und zitiert sie wie jede andere Quelle; besonders macht sie, wie sie hereinkommen und wie Korrekturen ersetzen, was sie korrigieren.

<Frame caption="Der Wissenseinträge-Tab — Thema, Inhalt, Quelle und Indexierungsstatus pro Fakt.">

![Der Wissenseinträge-Tab mit drei von Hand hinzugefügten Fakten, jeder mit dem Quellen-Tag Manuell und dem Status-Badge Indexiert.](/images/platform/knowledge-entries-list.webp)

</Frame>

## Woher Einträge kommen

**Aus dem Chat, mit deiner Freigabe.** Agenten mit aktiviertem Wissens-Schreib-Tool können vorschlagen, einen Fakt zu speichern, den du im Chat genannt oder korrigiert hast. Der Vorschlag erscheint als Karte im Chat — **In Wissensdatenbank speichern**, mit dem Thema und dem vollen Inhalt; existiert das Thema bereits, wird die Karte zu **Wissensdatenbank aktualisieren** und warnt, dass die Freigabe den bestehenden Eintrag ersetzt. Nichts landet, bevor du auf **Genehmigen** klickst; **Ablehnen** verwirft den Vorschlag.

<Note>

Das Tool ist standardmäßig aus — aktiviere es pro Agent in den Tool-Einstellungen des Agenten. Ein Agent kann nie in das geteilte Wissen der Org schreiben, ohne dass ein Mensch den exakten Text abgesegnet hat.

</Note>

**Von Hand.** Klicke unter **Wissen > Wissenseinträge** auf **Eintrag hinzufügen**. Gib ein **Thema** (bis zu 120 Zeichen — kurz und stabil, wie eine Überschrift) und den **Inhalt** als Markdown (bis zu 8000 Zeichen), so geschrieben, dass er ohne umgebendes Gespräch verständlich ist. Die Spalte **Quelle** hält die zwei Herkünfte auseinander: **Chat** oder **Manuell**.

## Eine aktive Version pro Thema

Themen sind der Dedup-Schlüssel: Ein freigegebener Chat-Vorschlag für ein bestehendes Thema oder eine Bearbeitung ersetzt die aktive Version, statt eine zweite daneben zu stellen — die Wissensdatenbank serviert nie zwei Versionen desselben Fakts. Einen neuen Eintrag unter einem bestehenden Thema anzulegen wird mit einem Duplikat-Fehler abgewiesen; bearbeite stattdessen den bestehenden Eintrag.

Ersetzte Versionen gehen nicht verloren. Öffne einen Eintrag für seine Details — Indexierungsstatus, letzte Aktualisierung und den **Versionsverlauf** mit jeder abgelösten Version und dem Zeitpunkt der Ablösung. Nur die aktive Version ist für den Abruf indexiert; der Verlauf existiert für Audit und Nachschlagen.

## Bearbeiten, Indexieren, Löschen

Bearbeiten erzeugt eine neue aktive Version und indexiert im Hintergrund neu — das **Status**-Badge fällt kurz in die Indexierung und kehrt zu **Indexiert** zurück, sobald die Suche den neuen Text aufgenommen hat. Löschen entfernt den ganzen Eintrag: Die Bestätigung warnt, dass er auch aus der Wissensdatenbank verschwindet, Agenten ihn also nicht mehr finden, und dass sich die Aktion nicht rückgängig machen lässt. War der Fakt richtig, füge ihn neu hinzu.

## Wo das hingehört

Wissenseinträge schließen die Schleife zwischen Gesprächen und der Wissensdatenbank: Eine einmal im Chat gemachte Korrektur wird ein Fakt, den jeder Agent abruft — ein Mensch gibt den exakten Wortlaut frei, und eine aktive Version pro Thema garantiert, dass der alte Fakt verschwindet, sobald der neue landet. Für die dateiförmige Hälfte lies [Dokumente](/de/platform/knowledge/documents); wie Agenten binden und abrufen, steht in [Agent-Wissen](/de/platform/agents/knowledge).
