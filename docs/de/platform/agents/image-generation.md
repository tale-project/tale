---
title: Bildgenerierung
description: Bildgenerierung als Agent-Fähigkeit — ein bild-getaggtes Modell wählen, Kosten und wie generierte Bilder in der Antwort auftauchen.
---

Bildgenerierung ist eine Fähigkeit, die ein Agent bekommt, indem er ein bild-getaggtes Modell wählt. Die Antwort des Agents kann generierte Bilder neben dem Text enthalten; der User sieht das Bild inline im Chat, so wie ein Anhang rendert. Diese Seite deckt die Verdrahtung ab.

Die Mechanik hängt vom darunter liegenden Provider ab — Qualität, Kosten und Geschwindigkeit variieren stark. Tales Aufgabe ist, die Fähigkeit für den Agent und den User verfügbar zu machen; die Aufgabe des Providers ist, das Bild zu erstellen.

## Das Modell wählen

Im **Instructions & model**-Tab des Agents zeigt der Modell-Picker Modelle mit dem Tag **Image generation**. Wähl eines als sekundäres Modell, und die Tool-Liste des Agents gewinnt ein Bildgenerierungs-Tool; der Agent kann es während einer Antwort aufrufen, wenn das Modell entscheidet, dass der User ein Bild will. Manche Provider zeigen **Image editing** als separates Tag — wähl das, um den Agent ein angehängtes Bild bearbeiten zu lassen, statt eines von Grund auf zu erzeugen.

## Wie es auftaucht

Wenn der Agent ein Bild generiert, rendert die Antwort das Bild inline neben dem Text des Agents. Beim Hovern erscheint ein kleiner **Bildvorschau**-Chip; ein Klick öffnet die Vorschau in voller Grösse mit den Steuerungen **Vorheriges Bild** und **Nächstes Bild**, falls die Antwort mehr als eines erzeugt hat. Das Bild wird im Objektspeicher des Chats neben Anhängen gespeichert und erbt die Aufbewahrungsregeln des Chats.

## Kosten und Budget

Bildmodelle kosten pro Aufruf mehr als Textmodelle — manchmal das Zehnfache. Die [Policies and limits](/de/platform/admin/governance/policies-and-limits) der Org können Bildkosten pro User, pro Team oder pro Agent deckeln; das Limit zu treffen taucht als Toast auf, und das Bild scheitert beim Rendern. Kosten sind in [Nutzungs-Analyse](/de/platform/admin/governance/usage-analytics) unter derselben Top-Models-Tabelle sichtbar wie die Textmodelle.

## Wo das hineinpasst

Bildgenerierung ist ein zusätzliches Tag am Modell-Picker — der Rest der Form des Agents bleibt gleich. Der Drift-Kandidat hier sind Provider- und Modellnamen; paar diese Seite mit der laufenden Modell-Liste in [Provider](/de/platform/admin/providers), statt dir spezifische Modell-Strings zu merken.
