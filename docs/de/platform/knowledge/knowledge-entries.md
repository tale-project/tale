---
title: Wissenseinträge
description: Wissenseinträge sind kleine, themen-basierte Fakten, die Nutzer zur Wissensdatenbank beitragen — mit Genehmigung aus dem Chat erfasst oder manuell hinzugefügt. Diese Seite behandelt, woher Einträge kommen, die Eine-Live-Version-pro-Thema-Regel und wie du sie verwaltest.
---

Wissenseinträge sind die Fakten-Oberfläche der Wissensdatenbank. Wo ein Dokument eine ganze Datei trägt, trägt ein Wissenseintrag einen kleinen, dauerhaften Fakt — „der Laden öffnet um 9", „die Rückgabefrist ist 3 Tage" — unter einem Themen-Namen. Einträge kommen aus zwei Quellen: Ein Agent kann während eines Chats einen vorschlagen, wenn du Informationen bestätigst oder korrigierst (du genehmigst ihn auf einer Karte, bevor irgendetwas gespeichert wird), und Redakteure können einen manuell im Tab **Wissenseinträge** hinzufügen. In beiden Fällen landet der Eintrag in derselben Indexierungs-Pipeline wie ein Dokument, sodass jeder Agent, der die Wissensdatenbank durchsucht, ihn abrufen und zitieren kann.

Diese Seite behandelt die Verwaltungsseite: woher Einträge kommen, die Eine-Live-Version-pro-Thema-Regel, die verhindert, dass Korrekturen neben den Fakten weiterleben, die sie korrigiert haben, und wie du Einträge hinzufügst, bearbeitest und löschst.

## Woher Einträge kommen

**Aus dem Chat, mit deiner Genehmigung.** Agents mit aktiviertem `knowledge_write`-Tool können vorschlagen, einen Fakt zu speichern, den du im Gespräch genannt oder korrigiert hast. Der Vorschlag erscheint als Genehmigungs-Karte im Chat mit dem Thema, dem vollständigen Inhalt und — wenn das Thema bereits existiert — einem Hinweis, dass die Genehmigung den aktuellen Eintrag ersetzt. Nichts erreicht die Wissensdatenbank, bevor du auf **Genehmigen** klickst; **Ablehnen** verwirft den Vorschlag. Das Tool ist standardmässig aus — aktivier es pro Agent in den Tool-Einstellungen des Agents unter der Documents-Gruppe. Das ist Absicht: Ein Agent kann nie ins geteilte Wissen der Organisation schreiben, ohne dass ein Mensch den exakten Text abgesegnet hat.

**Manuell.** Um einen Eintrag von Hand hinzuzufügen, öffne **Wissen > Wissenseinträge** und klick auf **Eintrag hinzufügen**. Gib ihm ein Thema (bis 120 Zeichen — kurz und stabil, wie eine Überschrift) und den Inhalt als Markdown (bis 8000 Zeichen), so formuliert, dass er ohne umgebendes Gespräch verständlich ist. Manuelle Einträge überspringen die Genehmigungs-Karte — du bist der Mensch in der Schleife.

## Eine Live-Version pro Thema

Themen sind der Dedup-Schlüssel. Wer auf ein Thema schreibt, das bereits einen Eintrag hat — ob aus dem Chat oder per Bearbeitung — ersetzt die Live-Version, statt eine zweite hinzuzufügen; die Wissensdatenbank liefert also nie zwei Versionen desselben Fakts. Der Themen-Abgleich ignoriert Gross-/Kleinschreibung und überflüssige Leerzeichen: „Öffnungszeiten" und „öffnungszeiten" sind dasselbe Thema.

Ersetzte Versionen gehen nicht verloren. Jeder Eintrag behält seinen Versionsverlauf — klick auf eine Zeile, um den Eintrag zu öffnen, und klapp eine ersetzte Version auf, um zu sehen, was sie sagte und wann sie ersetzt wurde. Nur die Live-Version ist für den Abruf indexiert; ersetzte Versionen existieren nur für Audit und Nachschlagen.

## Wie Einträge Agents erreichen

Hinter jedem Eintrag sitzt ein kleines Markdown-Dokument im Dokumenten-Hub, im reservierten Ordner **Knowledge entries**. Dieses Hintergrund-Dokument fährt durch exakt dieselbe Indexierungs-Pipeline wie eine hochgeladene Datei — extrahieren, chunken, einbetten, speichern — weshalb die Eintragsliste pro Zeile das vertraute Indexierungsstatus-Badge zeigt. Ein frisch gespeicherter Eintrag zeigt kurz `Indexierung`; sobald er auf `Indexiert` umspringt, rufen Agents, deren Wissens-Umfang das Hintergrund-Dokument einschliesst, ihn ab und zitieren ihn wie jede andere Quelle.

Weil das Hintergrund-Dokument ein reguläres Dokument ist, funktioniert die Agent-Bindung unverändert: Ein Agent mit Zugriff auf die ganze Bibliothek sieht jeden Eintrag, und ein Agent mit Zugriff auf spezifische Ordner sieht Einträge nur, wenn der Knowledge-entries-Ordner im Umfang liegt. Einträge gelten organisationsweit — eine Per-Team-Skopierung auf Einträgen selbst gibt es in dieser Version nicht.

## Bearbeiten und Löschen

Um einen Eintrag zu bearbeiten, öffne sein Zeilen-Menü und klick auf **Bearbeiten**. Speichern erzeugt eine neue Live-Version und verschiebt die vorherige in den Versionsverlauf; das Hintergrund-Dokument wird im Hintergrund neu indexiert, sodass Suchergebnisse den neuen Text aufnehmen, sobald das Status-Badge wieder `Indexiert` zeigt. Das Umbenennen des Themas nimmt den Versionsverlauf mit.

Um einen Eintrag zu löschen, öffne sein Zeilen-Menü und klick auf **Löschen**. Das Löschen entfernt den ganzen Eintrag — Live-Version, Verlauf, das Hintergrund-Dokument und die indexierten Chunks — sodass Agents den Fakt nicht mehr finden können. Es gibt kein Rückgängig; war der Fakt richtig, füg ihn neu hinzu. Das Löschen des Hintergrund-Dokuments im Dokumente-Tab hat denselben Effekt: Der Eintrag wird ebenfalls entfernt, damit die zwei Ansichten nie auseinanderlaufen.

## Wo das hingehört

Wissenseinträge schliessen die Schleife zwischen Gesprächen und der Wissensdatenbank: Eine einmal im Chat gemachte Korrektur wird zu einem Fakt, den jeder Agent abruft — mit einem Menschen, der den exakten Wortlaut genehmigt, und einer Live-Version pro Thema, die garantiert, dass der alte Fakt verschwindet, wenn der neue landet. Für die datei-förmige Hälfte der Wissensdatenbank lies [Dokumente](/de/platform/knowledge/documents); dafür, wie ein Agent an Wissen bindet und zur Antwort-Zeit darüber abruft, lies [Agent-Wissen](/de/platform/agents/knowledge).
