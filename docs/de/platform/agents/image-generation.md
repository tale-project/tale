---
title: Bildgenerierung
description: Bildgenerierung als Agenten-Fähigkeit — Inline-Bilder in der Antwort jedes Assistenten, das Tool Bild generieren, der dedizierte Bildagenten-Typ und was das kostet.
---

Jeder Assistent in Tale kann Bilder generieren. Bitte ihn, etwas zu erstellen, zu zeichnen oder zu gestalten, und er erzeugt das Bild inline, so wie ein Anhang in der Antwort erscheint — es gibt keinen separaten Modus, in den du erst wechseln musst. Das funktioniert, sobald der Workspace ein Bildgenerierungs-Modell konfiguriert hat; diese Seite deckt die Verdrahtung ab.

Die Mechanik hängt vom darunterliegenden Anbieter ab — Qualität, Kosten und Geschwindigkeit variieren stark. Tales Aufgabe ist, die Fähigkeit dem Agent und dem User zugänglich zu machen; die Aufgabe des Anbieters ist, das Bild zu erstellen.

## Jeden Assistenten um ein Bild bitten

Jeder Assistent trägt ein Bild-Tool, zu dem er greift, wenn du ihn um ein Bild, ein Logo oder eine Illustration bittest. Der Assistent ruft das Tool auf, das Bild erscheint inline, und sein Text legt sich um das Ergebnis wie um einen hochgeladenen Anhang. Weil das Tool mit jedem Assistenten ausgeliefert wird, bedient auch der **Auto**-Assistent eine Bild-Anfrage — du musst nicht erst einen spezialisierten Agent wählen.

Das Bild kommt vom Bildgenerierungs-Modell des Workspace — dem, das ein Admin unter [Anbieter](/de/platform/admin/providers) eingerichtet und mit **Bildgenerierung** getaggt hat. Pro Agent gibt es nichts zu konfigurieren. Hat der Workspace kein solches Modell, sagt dir der Assistent, dass Bildgenerierung nicht verfügbar ist, statt zu raten — so weiß ein Admin, dass eines fehlt.

## Die dedizierten Bild-Oberflächen

Jenseits des Inline-Tools existieren zwei schwerere Formen. Im Agenten-Editor ist das Tool selbst **Bild generieren** unter der Kategorie **Bilder** des Tools-Tabs — entferne den Haken bei einem Agent, der nie Bilder erzeugen soll. Und der Typ eines Agents (auf dem Tab **Allgemein**) lässt sich auf **Bildgenerierung** setzen, was jede Nachricht direkt an ein Bildmodell leitet — die Form hinter dem Katalog-Agent **Bildgenerator**, der Bilder aus Text-Prompts generiert und bearbeitet. Greif zum dedizierten Typ, wenn der ganze Job des Agents Bildarbeit ist; lass allen anderen das Inline-Tool.

## Wie es erscheint

Generiert der Agent ein Bild, erscheint es inline neben dem Text des Agents. Hovern zeigt einen kleinen **Bildvorschau**-Chip; Klicken öffnet die Vorschau in voller Größe, mit den Reglern **Vorheriges Bild** und **Nächstes Bild**, wenn die Antwort mehr als eines erzeugt hat. Das Bild liegt im Objektspeicher des Chats neben den Anhängen und erbt die Aufbewahrungsregeln des Chats.

## Kosten und Budget

Bildmodelle kosten pro Aufruf mehr als Textmodelle — manchmal das Zehnfache. Die [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) der Organisation können Bildkosten pro User, pro Team oder pro Agent deckeln; ein erreichtes Limit erscheint als Meldung, und das Bild wird nicht gerendert. Die Kosten siehst du in der [Nutzungsanalyse](/de/platform/admin/governance/usage-analytics), in derselben Top-Models-Tabelle wie die Textmodelle.

## Wo das hingehört

Bildgenerierung hängt an einem einzigen Ding — einem Modell mit dem Tag **Bildgenerierung** im Workspace — und von da an kann jeder Assistent inline ein Bild erzeugen, den **Auto**-Assistenten eingeschlossen. Der Drift-Kandidat hier sind Anbieter- und Modellnamen; leg diese Seite neben die laufende Modell-Liste unter [Anbieter](/de/platform/admin/providers), statt dir konkrete Modell-Strings zu merken.
