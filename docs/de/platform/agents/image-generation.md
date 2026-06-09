---
title: Bildgenerierung
description: Bildgenerierung als Agent-Fähigkeit — jeder Assistent kann ein Bild inline erstellen, wenn ein Bildmodell konfiguriert ist, wie generierte Bilder auftauchen und was sie kosten.
---

Jeder Assistent in Tale kann Bilder generieren. Bitte ihn, etwas zu erstellen, zu zeichnen oder zu gestalten, und er erzeugt das Bild inline — so wie ein Anhang in der Antwort rendert, ohne separaten Modus, in den du erst wechseln musst. Das funktioniert, sobald ein Bildgenerierungs-Modell konfiguriert ist; diese Seite deckt die Verdrahtung ab.

Die Mechanik hängt vom darunter liegenden Provider ab — Qualität, Kosten und Geschwindigkeit variieren stark. Tales Aufgabe ist, die Fähigkeit für den Agent und den User verfügbar zu machen; die Aufgabe des Providers ist, das Bild zu erstellen.

## Jeden Assistenten um ein Bild bitten

Jeder Assistent hat ein Bild-Tool, zu dem er greift, wenn du ihn bittest, ein Bild, Logo oder eine Illustration zu erstellen. Der Assistent ruft das Tool auf, das Bild rendert inline, und sein Text legt sich darum, so wie um einen hochgeladenen Anhang. Weil das Tool bei jedem Assistenten dabei ist, erledigt auch der **Auto**-Assistent eine Bildanfrage — du musst nicht erst einen spezialisierten Agent wählen.

Das Bild stammt vom Bildgenerierungs-Modell der Org — dem, das ein Admin unter [Provider](/de/platform/admin/providers) eingerichtet und mit **Image generation** getaggt hat. Pro Agent gibt es nichts zu konfigurieren. Hat die Org kein solches Modell, sagt dir der Assistent, dass Bildgenerierung nicht verfügbar ist, statt zu raten — so erkennt ein Admin, dass er eines hinzufügen muss.

## Wie es auftaucht

Wenn der Agent ein Bild generiert, rendert die Antwort das Bild inline neben dem Text des Agents. Beim Hovern erscheint ein kleiner **Bildvorschau**-Chip; ein Klick öffnet die Vorschau in voller Grösse mit den Steuerungen **Vorheriges Bild** und **Nächstes Bild**, falls die Antwort mehr als eines erzeugt hat. Das Bild wird im Objektspeicher des Chats neben Anhängen gespeichert und erbt die Aufbewahrungsregeln des Chats.

## Kosten und Budget

Bildmodelle kosten pro Aufruf mehr als Textmodelle — manchmal das Zehnfache. Die [Policies and limits](/de/platform/admin/governance/policies-and-limits) der Org können Bildkosten pro User, pro Team oder pro Agent deckeln; das Limit zu treffen taucht als Toast auf, und das Bild scheitert beim Rendern. Kosten sind in [Nutzungs-Analyse](/de/platform/admin/governance/usage-analytics) unter derselben Top-Models-Tabelle sichtbar wie die Textmodelle.

## Wo das hineinpasst

Bildgenerierung hängt an einer Sache — einem Modell mit dem Tag **Image generation** in der Org — und von da aus kann jeder Assistent ein Bild inline erzeugen, der **Auto**-Assistent eingeschlossen. Der Drift-Kandidat hier sind Provider- und Modellnamen; paar diese Seite mit der laufenden Modell-Liste in [Provider](/de/platform/admin/providers), statt dir spezifische Modell-Strings zu merken.
