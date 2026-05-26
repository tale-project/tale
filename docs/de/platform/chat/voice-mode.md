---
title: Sprachmodus
description: Sprechen statt tippen — wie die Hin-und-zurück-Schleife läuft, welches Modell Speech-to-Text macht, welches Text-to-Speech, und was die Datenschutzgrenze abdeckt.
---

Der Sprachmodus verwandelt den Composer in ein Mikrofon. Du sprichst, Tale transkribiert, der Agent antwortet in Text, und die Antwort wird laut zurückgelesen. Die ganze Schleife ist freihändig — nützlich, wenn du läufst, fährst (legal), kochst oder schlicht müde vom Tippen bist.

Der Sprechpfad des Composers überquert zwei Modell-Anbieter (Speech-to-Text, dann Text-to-Speech) und ein oder zwei Agent-Aufrufe dazwischen. Zu wissen, welcher Anbieter welches Stück des Audios hält, ist der Unterschied zwischen „das ist bequem" und „das ist leichtsinnig" für die Daten deiner Org.

## Wie der Sprachmodus läuft

Tipp auf das Mikrofonsymbol am Composer, und die Aufnahme startet; nochmal tippen stoppt sie. Tale lädt den Audioclip hoch, das Speech-to-Text-Modell transkribiert ihn, und das Transkript wird die nächste Nachricht im Chat — genau, als hättest du sie getippt. Der Agent antwortet in Text; sobald die Antwort fertig ist, routet Tale sie an ein Text-to-Speech-Modell und spielt die Audio zurück. Während die Antwort streamt, beendet **Stopped** die Wiedergabe früh; **Play voice output** spielt die letzte Antwort erneut.

## STT- und TTS-Übergaben

Zwei Modellwahlen zählen, und sie werden separat vom Chat-Modell konfiguriert. **Speech-to-Text** läuft einmal pro gesprochener Nachricht — die Audio wird hochgeladen, transkribiert, und das Transkript ist das, was der Agent sieht. **Text-to-Speech** läuft einmal pro Antwort — Tale teilt die Antwort in Sprachausgabe-Segmente und streamt Audio zurück. Der Agent selbst ist unverändert; der Sprachmodus ist ein Wrapper um denselben Composer.

## Stimmen wählen

Jeder Agent kann in seinen Einstellungen eine bevorzugte Stimme festsetzen; ohne agent-spezifische Wahl nutzt der Sprachmodus die Org-Default-Stimme. Stimmen sind an bestimmte TTS-Anbieter gebunden — den Anbieter wechseln wechselt die verfügbaren Stimmen. Nutzt ein Chat einen Agent, dessen Stimmen-Anbieter nicht mehr konfiguriert ist, fällt Tale auf die Org-Default-Stimme zurück, statt die Antwort scheitern zu lassen.

## Die Datenschutzgrenze

Der aufgezeichnete Audioclip verlässt dein Gerät. Er wird auf Tales Speicher hochgeladen, an den konfigurierten Speech-to-Text-Anbieter gesendet, und das Transkript wird zusammen mit den getippten Nachrichten in der Chathistorie aufbewahrt. Die Audio selbst wird gemäss der Aufbewahrungspolicy der Org aufbewahrt. Antworten gehen als Plaintext an den Text-to-Speech-Anbieter; die Audio-Antwort wird auf dein Gerät gestreamt und standardmässig nicht auf Disk gespeichert. Orgs mit strengen Daten-aus-der-Region-Regeln sollten STT- und TTS-Anbieter in derselben Region wählen wie den Rest des Stacks — siehe [Daten-Residenz](/de/cloud/data-residency).

## Wann Sprache Text schlägt

Sprache ist schneller als Tippen für kurze, konversationelle Fragen und dramatisch langsamer als Tippen für Code, Listen oder alles, was du herauskopieren würdest. Sprachantworten haben ein Chunk-Limit — lange Antworten brechen mittendrin ab und zeigen einen Hinweis. Greif zur Sprache, wenn die Antwort einmal gehört und vergessen wird; greif zum Text, wenn die Antwort überflogen oder gespeichert werden muss.

## Wann du danach greifst

| Nutz … wenn                                                        | Sprachmodus | Text |
| ------------------------------------------------------------------ | ----------- | ---- |
| Du hast die Hände voll und willst einen schnellen Fakt             | ✓           |      |
| Die Antwort wird eine lange Liste oder ein Codeblock               |             | ✓    |
| Die Antwort des Agents informiert eine spätere schriftliche Arbeit |             | ✓    |
| Du übst eine Sprache und willst sie hören                          | ✓           |      |

## Wo das hineinpasst

Der Sprachmodus ist eine von drei „Eingabe-Formen" am selben Composer: Text (Default), Anhänge und Sprache. Die Datenschutz-Geschichte zählt hier am meisten, weil zwei zusätzliche Anbieter die Daten berühren, also ist die Seite, die du als Nächstes lesen solltest, [Daten-Residenz](/de/cloud/data-residency) auf Cloud oder [Konfiguration → Provider](/de/self-hosted/configuration/providers) auf self-hosted, je nachdem, welche Edition du betreibst.
