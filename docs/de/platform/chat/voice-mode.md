---
title: Sprachmodus
description: Sprechen statt Tippen — wie aus einer Aufnahme eine Nachricht wird, wie eine Antwort vorgelesen wird und welche Anbieter das Audio unterwegs berühren.
---

Der Sprachmodus verwandelt die Eingabezeile in ein Mikrofon. Du sprichst, die Aufnahme wird zu deiner nächsten Nachricht transkribiert, der Agent antwortet in Text, und diese Antwort kann laut vorgelesen werden. Die Schleife ist freihändig, was viel wert ist, wenn du unterwegs bist, kochst oder müde vom Tippen — und sie durchquert zwei Sprachanbieter, was du wissen solltest, bevor die Daten deiner Organisation dort hindurchlaufen.

Diese Seite beschreibt beide Hälften der Runde und die Grenze, die das Audio überschreitet. Am Chat selbst ändert sich nichts: Sprache ist eine Hülle um denselben Nachrichtenfluss, den [Chat-Grundlagen](/de/platform/chat/basics) beschreibt.

## Sprache zu Text

Starte die Aufnahme über das Mikrofon in der Eingabezeile und sprich; auf demselben Weg beendest du sie. Die Aufnahme wandert nach oben, ein Speech-to-Text-Modell transkribiert sie, und das Transkript wird zur nächsten Nachricht im Chat — genau so, als hättest du sie getippt. Du kannst das Transkript vor dem Absenden lesen, und das zählt: Ein Transkriptionsfehler ist von einer schlecht formulierten Frage nicht mehr zu unterscheiden, sobald der Agent geantwortet hat.

Die Transkription läuft einmal pro gesprochener Nachricht. Was der Agent bekommt, ist Text; Audio erreicht das Chat-Modell nie.

## Text zu Sprache

Ob eine Antwort vorgelesen wird, entscheidest du in der Eingabezeile, für den Zug, den du gerade absendest. Schalte die Sprachausgabe ein, und die zurückkommende Antwort geht an ein Text-to-Speech-Modell und wird abgespielt, während sie eintrifft; lässt du sie aus, landet die Antwort als Text wie jede andere. Die Wiedergabe lässt sich vorzeitig stoppen, und die letzte Antwort lässt sich erneut abspielen, ohne die Frage zu wiederholen.

<Note>

Die Sprachausgabe ist ein Bedienelement der Eingabezeile und keine gespeicherte Einstellung. Es gibt keine Stimme, die an einem Agent hängt, und keine organisationsweite Vorgabe, die für dich entscheidet — der Zug, den du gerade sendest, ist der ganze Geltungsbereich der Wahl. Das bewahrt dich davor, dass eine freihändige Sitzung dir ins Großraumbüro folgt.

</Note>

## Wer welchen Teil hält

Zwei Modellwahlen zählen hier, und keine davon ist das Modell im Modell-Picker. Speech-to-Text läuft vor dem Agent-Zug, auf dem Audio. Text-to-Speech läuft danach, auf der fertigen Antwort. Der Agent dazwischen bleibt unverändert — dieselben Instructions, dieselben Tools, derselbe Kontext-Vertrag.

Beide richtet ein, wer die Anbieter der Organisation verwaltet. Ist kein Sprachanbieter eingerichtet, haben die Sprach-Bedienelemente nichts zum Aufrufen, und die Lösung ist ein angebundener Anbieter, nicht eine Änderung im Chat.

## Die Datenschutzgrenze

Die Aufnahme verlässt dein Gerät. Sie wandert in Tales Speicher, geht an den Speech-to-Text-Anbieter, den die Organisation eingerichtet hat, und das entstehende Transkript bleibt im Chat-Verlauf neben den getippten Nachrichten — durchsuchbar, exportierbar und denselben Aufbewahrungsregeln unterworfen wie alles andere im Chat. Für das Audio selbst gilt die Aufbewahrungsrichtlinie der Org.

Antworten gehen als reiner Text an den Text-to-Speech-Anbieter, und das zurückkommende Audio streamt auf dein Gerät, statt gespeichert zu werden.

<Warning>

Organisationen mit strengen Regeln zur Datenlokalität sollten Sprachanbieter in derselben Region wählen wie den Rest des Stacks — für Audio und Transkript gelten dieselben Regeln wie für jeden anderen Nachrichteninhalt. Siehe [Datenresidenz](/de/cloud/data-residency).

</Warning>

## Wann Sprache den Text schlägt

Sprache ist schneller als Tippen bei kurzen, gesprächigen Fragen und deutlich langsamer bei allem, was du hinterher kopieren würdest. Eine gesprochene Antwort hörst du einmal; eine geschriebene lässt sich überfliegen, zitieren und einfügen.

| Nimm … wenn                                            | Sprache | Text |
| ------------------------------------------------------ | ------- | ---- |
| Du die Hände voll hast und schnell etwas wissen willst | ✓       |      |
| Die Antwort eine lange Liste oder ein Code-Block wird  |         | ✓    |
| Die Antwort in eine spätere Schreibarbeit einfließt    |         | ✓    |
| Du eine Sprache übst und sie hören willst              | ✓       |      |

## Wo das hineinpasst

Sprache ist eine von drei Eingabeformen derselben Eingabezeile: Tippen, [Anhänge](/de/platform/chat/attachments) und Sprechen. Der Datenschutz wiegt hier am schwersten, weil zwei zusätzliche Anbieter die Daten berühren — welche Seite du als Nächstes liest, hängt darum von deiner Edition ab: [Datenresidenz](/de/cloud/data-residency) in der Cloud oder [Anbieter](/de/self-hosted/configuration/providers), wenn du Tale selbst betreibst und die Sprachanbieter genauso wählst wie die Chat-Modelle.
