---
title: Bildgenerierung
description: Bildgenerierung ist ein Tool, das du jedem Agenten gewähren kannst — generate_image liefert ein Bild direkt in der Antwort, auf einem pro Zug gewählten Modell.
---

Bildgenerierung ist in Tale ein Tool und keine Art von Agent. Jeder Agent, dem `generate_image` gewährt ist, kann ein Bild direkt in der Antwort liefern: Du bittest ihn, etwas zu erstellen, zu zeichnen oder zu entwerfen, das Modell ruft das Tool auf, und das Bild erscheint in der Antwort wie ein Anhang. Es gibt keinen Modus, in den du vorher wechseln müsstest, und keine besondere Persona, die du auswählen müsstest.

Diese Seite behandelt dieses Tool — was es tut, wie du es gewährst oder vorenthältst, wie das Ergebnis im Gespräch landet und was es kostet. Die Mechanik darunter gehört dem Provider: Qualität, Preis und Tempo gehen zwischen Bildmodellen weit auseinander.

## Das Tool generate_image

`generate_image` nimmt genau eines entgegen — einen Prompt, der das gewünschte Bild beschreibt. Dieser Prompt steht für sich, denn das Bildmodell sieht das Gespräch nie: Der Agent faltet alles, was du zu Stil, Stimmung, Bildaufbau und Farbe gesagt hast, in diese eine Beschreibung. Das Ergebnis kommt als Datei zurück, erscheint direkt in der Antwort, und der Text des Agenten legt sich darum.

Weil es ein gewöhnliches Tool ist, gilt hier alles, was für den Rest der Tool-Oberfläche gilt. Das Modell entscheidet aus der gewährten Liste heraus, wann es aufruft, Aufruf und Ergebnis erscheinen im Gespräch wie jeder andere Tool-Aufruf, und ein Agent ohne diese Gewährung kommt gar nicht daran.

## Gewähren oder vorenthalten

Öffne den Tab **Tools** des Agenten und gewähre `generate_image` dort, wo Bilder zur Aufgabe gehören; lass es aus bei einem Agenten, der nur in Text antworten soll. Mehr ist nicht einzustellen — keine Bild-Option pro Agent, keine reine Bild-Persona und kein Typ, auf den du einen Agenten umschalten müsstest.

Das Modell hinter dem Bild kommt von derselben Stelle wie jedes andere Modell: Wer die Nachricht abschickt, wählt es im Composer, statt dass der Agent eines festnagelt. Bietet in einer Organisation kein Provider etwas Bildfähiges an, kommt eine klare Absage statt einer Vermutung zurück — das ist der Hinweis für eine Administratorin, unter [Provider](/de/platform/admin/providers) eines hinzuzufügen.

## Wie das Bild in der Antwort landet

Das erzeugte Bild erscheint neben dem Text des Agenten und öffnet sich in voller Größe, wenn du es anklickst. Die Datei liegt bei den Anhängen des Gesprächs und folgt denselben Aufbewahrungsregeln; ein erzeugtes Bild ist damit genauso dauerhaft — und genauso löschbar — wie alles, was du selbst in diesen Chat hochgeladen hast.

Weil das Bild über einen Tool-Aufruf entsteht, lässt es sich auch wie einer nachvollziehen: Im Aufruf steht der Prompt, den das Modell tatsächlich abgeschickt hat, und das ist meist der schnellste Weg herauszufinden, warum ein Bild anders aussieht als gedacht.

## Kosten und Budget

Bildmodelle kosten pro Aufruf mehr als Textmodelle, manchmal um eine Größenordnung. Die [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) der Organisation deckeln die Ausgaben pro Person, pro Team und pro Agent; ist ein Deckel erreicht, erscheint das im Chat, statt dass ein Bild entsteht. Die Ausgaben tauchen in der [Nutzungsanalyse](/de/platform/admin/governance/usage-analytics) in denselben Tabellen auf wie die Textnutzung.

## Wo das hingehört

Bildgenerierung ist ein Eintrag auf einer Liste, und genau darum geht es: Ein Agent, der zeichnen soll, bekommt `generate_image`, ein Agent, der das nicht soll, bekommt es nicht, und kein Teil der Persona muss um Bilder herum umgebaut werden. Was hier am ehesten veraltet, sind Provider- und Modellnamen — halte dich lieber an die laufende Liste unter [Provider](/de/platform/admin/providers) als an gemerkte Modell-IDs, und für den Rest des Katalogs an [Agent-Tools](/de/platform/agents/tools).
