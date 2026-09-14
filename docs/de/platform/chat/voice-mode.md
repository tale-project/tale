---
title: Sprachmodus
description: Diktiere eine Nachricht, prüfe den Text vor dem Senden und höre Antworten bei verfügbarer Sprachausgabe an.
---

Mit Diktat sprichst du eine Nachricht ein, statt sie zu tippen. Die Sprachausgabe liest eine Antwort des Assistenten vor. Beides lässt sich getrennt nutzen: Ein Diktat braucht keine vorgelesene Antwort, und zum Zuhören ist kein Mikrofonzugriff nötig.

## Diktieren und die Nachricht prüfen

1. Klicke am Mikrofon des Nachrichtenfelds auf **Diktat starten**.
2. Erlaube bei Nachfrage den Mikrofonzugriff im Browser und sprich deutlich.
3. Klicke auf **Diktat stoppen**. Wird serverseitig transkribiert, warte auf den Abschluss.
4. Lies und korrigiere den Text im Nachrichtenfeld, besonders Namen, Zahlen und Termine. Sende ihn, wenn er stimmt.

Das Diktat ergänzt Text im Nachrichtenfeld; es sendet die Nachricht nicht automatisch. Das Senden beendet ein laufendes Diktat. Das Chat-Modell erhält den Text, den du abschickst.

Tale nutzt zuerst die Spracherkennung des Browsers, sofern verfügbar. Andernfalls kann es die Aufnahme über das Transkriptionsmodell der Organisation verarbeiten. Ist keiner der Wege verfügbar, fehlt das Mikrofon oder zeigt einen Hinweis zur Einrichtung. Die Browser-Spracherkennung kann einen Dienst des Browseranbieters nutzen. Gehe deshalb nicht von Offline-Verfügbarkeit aus.

## Eine Antwort anhören

Aktiviere **Sprachmodus** im Nachrichtenfeld, um Antworten im aktuellen Chat anzuhören. Ein Text-to-Speech-Modell erzeugt Audio aus der Antwort. Mit der Wiedergabeaktion an der Antwort kannst du stoppen oder erneut abspielen. Der geschriebene Text bleibt zum Nachprüfen verfügbar.

Eine Organisationsrichtlinie kann die Sprachausgabe ausblenden. Eine deaktivierte Aktion kann auch bedeuten, dass kein geeignetes Sprachmodell verfügbar ist. Ein Administrator prüft die [KI-Provider](/de/platform/admin/providers). Die Wahl eines anderen Chat-Modells richtet keinen Sprachprovider ein.

Die Einstellung in einem vorhandenen Chat gilt für dieses Gespräch. In einem neuen Chat wird damit auch der Standard für spätere Chats gesetzt. Projektagenten haben keine eigene Stimmeneinstellung.

## Probleme mit Sprache beheben

| Symptom | Was du prüfen kannst |
| --- | --- |
| Das Mikrofon startet nicht | Mikrofonberechtigung des Browsers, gewähltes Eingabegerät und mögliche Nutzung durch eine andere App. |
| Wörter fehlen oder stimmen nicht | Hintergrundgeräusche verringern und den Text vor dem Senden korrigieren. |
| Die Server-Transkription schlägt fehl | Erneut versuchen, solange die fehlgeschlagene Aufnahme verfügbar ist, oder verwerfen und tippen. |
| Die Antwort ist bereit, aber stumm | Lautstärke und Wiedergabeerlaubnis des Browsers prüfen, dann die Antwort abspielen. |
| Eine Konfigurationsmeldung erscheint | Einen Administrator Sprachmodell und Zugangsdaten prüfen lassen. |

Eine fehlgeschlagene Server-Transkription hält die Aufnahme zur Wiederholung im Speicher der aktuellen Seite. Beim Verlassen oder Neuladen kann sie verloren gehen. Sie ist kein gespeicherter Audioanhang. Nutze [Anhänge](/de/platform/chat/attachments), wenn du eine vorhandene Aufnahme hochladen möchtest.

## Den Weg der Audiodaten verstehen

Beim Browserdiktat verarbeitet der Sprachdienst des Browsers die Aufnahme. Der alternative Serverweg sendet sie zur Transkription mit dem konfigurierten Provider an Tale. Dieser Diktatweg legt sie nicht als Dokument ab. Sobald du den Text sendest, gehört er zum Chatverlauf.

Die Sprachausgabe sendet den Antworttext an den eingerichteten Sprachprovider und streamt das Audio zur Wiedergabe. Enthält die Antwort Informationen aus einer beschränkt zugänglichen Quelle, gehören auch diese zum Sprachauftrag. Administratoren sollten Sprachdienste passend zu den [Anforderungen an die Datenresidenz](/de/cloud/data-residency) wählen.
