---
title: Sprachmodus
description: Sprechen statt Tippen — wie die Schleife läuft, welches Modell Speech-to-Text übernimmt, welches Text-to-Speech, und was die Datenschutzgrenze abdeckt.
---

Der Sprachmodus verwandelt den Composer in ein Mikrofon. Du sprichst, Tale transkribiert, der Agent antwortet in Text, und die Antwort wird laut vorgelesen. Die ganze Schleife ist freihändig — nützlich, wenn du unterwegs bist, fährst (legal), kochst oder schlicht müde vom Tippen bist.

Der Sprechpfad des Composers durchquert zwei Modell-Anbieter (Speech-to-Text, dann Text-to-Speech) und ein bis zwei Agent-Aufrufe dazwischen. Zu wissen, welcher Anbieter welches Stück des Audios hält, ist der Unterschied zwischen „das ist praktisch" und „das ist leichtsinnig" für die Daten deiner Org.

## Wie der Sprachmodus läuft

Tipp auf das Mikrofonsymbol am Composer, und die Aufnahme startet; nochmal tippen stoppt sie. Tale lädt den Audioclip hoch, das Speech-to-Text-Modell transkribiert ihn, und das Transkript wird die nächste Nachricht im Chat — genau, als hättest du sie getippt. Der Agent antwortet in Text; sobald die Antwort fertig ist, routet Tale sie an ein Text-to-Speech-Modell und spielt das Audio zurück. Während die Antwort streamt, beendet **Gestoppt** die Wiedergabe vorzeitig; **Sprachausgabe abspielen** spielt die letzte Antwort erneut ab.

## STT- und TTS-Übergaben

Zwei Modellwahlen zählen, und sie werden separat vom Chat-Modell konfiguriert. **Speech-to-Text** läuft einmal pro gesprochener Nachricht — das Audio wird hochgeladen, transkribiert, und das Transkript ist das, was der Agent sieht. **Text-to-Speech** läuft einmal pro Antwort — Tale teilt die Antwort in Sprachausgabe-Segmente und streamt Audio zurück. Der Agent selbst bleibt unverändert; der Sprachmodus ist ein Wrapper um denselben Composer.

## Stimmen wählen

Jeder Agent kann in seinen Einstellungen eine bevorzugte Stimme festlegen; ohne agent-eigene Wahl nutzt der Sprachmodus die Standardstimme der Org. Stimmen sind an bestimmte TTS-Anbieter gebunden — den Anbieter zu wechseln wechselt die verfügbaren Stimmen. Nutzt ein Chat einen Agent, dessen Stimmen-Anbieter nicht mehr konfiguriert ist, fällt Tale auf die Standardstimme der Org zurück, statt die Antwort scheitern zu lassen.

## Die Datenschutzgrenze

Der aufgezeichnete Audioclip verlässt dein Gerät. Er wird in Tales Speicher hochgeladen, an den konfigurierten Speech-to-Text-Anbieter gesendet, und das Transkript liegt zusammen mit den getippten Nachrichten im Chatverlauf. Das Audio selbst bleibt gemäß der Aufbewahrungspolicy der Org erhalten. Antworten gehen als Klartext an den Text-to-Speech-Anbieter hinaus; die Audio-Antwort wird auf dein Gerät gestreamt und standardmäßig nicht auf der Festplatte gespeichert.

<Warning>

Orgs mit strengen Regeln für Daten außerhalb der Region sollten STT- und TTS-Anbieter in derselben Region wählen wie den Rest des Stacks — siehe [Daten-Residenz](/de/cloud/data-residency).

</Warning>

## Wann Sprache Text schlägt

Sprache ist schneller als Tippen für kurze, gesprächige Fragen und dramatisch langsamer für Code, Listen oder alles, was du herauskopieren würdest. Sprachantworten haben ein Chunk-Limit — lange Antworten brechen mittendrin ab und zeigen einen Hinweis. Greif zur Sprache, wenn die Antwort einmal gehört und vergessen wird; greif zum Text, wenn die Antwort überflogen oder gespeichert werden muss.

## Wann du danach greifst

| Nutz … wenn                                                       | Sprachmodus | Text |
| ----------------------------------------------------------------- | ----------- | ---- |
| Du hast die Hände voll und willst einen schnellen Fakt            | ✓           |      |
| Die Antwort wird eine lange Liste oder ein Codeblock              |             | ✓    |
| Die Antwort des Agents fließt in eine spätere schriftliche Arbeit |             | ✓    |
| Du übst eine Sprache und willst sie hören                         | ✓           |      |

## Wo das hineinpasst

Der Sprachmodus ist eine von drei Eingabeformen am selben Composer: Text (der Standard), Anhänge und Sprache. Die Datenschutz-Geschichte zählt hier am meisten, weil zwei zusätzliche Anbieter die Daten berühren — die nächste Lektüre ist daher [Daten-Residenz](/de/cloud/data-residency) auf Cloud oder [Konfiguration → Anbieter](/de/self-hosted/configuration/providers) auf selbst gehosteten Instanzen, je nachdem, welche Edition du betreibst.
