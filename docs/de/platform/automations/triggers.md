---
title: Automatisierungs-Trigger
description: Die drei Wege, auf denen eine Automatisierung von selbst startet — ein Zeitplan, ein Webhook oder ein Plattform-Ereignis — was jeder in den Lauf trägt und warum keiner beim Live-Schalten zerbricht.
---

Ein Trigger ist das, was eine Automatisierung startet, wenn niemand irgendwo klickt. Es gibt genau drei Arten, die Menge ist abgeschlossen, und eine Automatisierung darf mehrere davon gleichzeitig tragen. Das Nützlichste, was du über einen Trigger wissen kannst: Er hängt am **Namen** der Automatisierung und nicht an einer Version. Deshalb macht eine neu live geschaltete Version nie eine Webhook-URL ungültig, auf die ein externes System angewiesen ist, und wirft nie einen Zeitplan weg.

Jeder Trigger startet die live geschaltete Version und läuft im Live-Modus — eine Automatisierung ohne Live-Version lässt sich von ihm also nicht starten. Jeder Trigger trägt einen Ein-Aus-Schalter und hält fest, wann der Scheduler zuletzt auf ihn reagiert hat.

## Die drei Arten

| Art        | Startet die Automatisierung, wenn …                            |
| ---------- | -------------------------------------------------------------- |
| `schedule` | ein Cron-Ausdruck in einer benannten IANA-Zeitzone fällig wird |
| `webhook`  | ein externes System an eine Token-geschützte URL sendet        |
| `event`    | ein benanntes Plattform-Ereignis eintritt                      |

Ein programmatischer Start braucht gar keinen Trigger: ein API-Client mit einem Organisationsschlüssel ruft `POST /api/v1/automations/{name}/runs` auf (oder das MCP-Tool `start_run`), und der Schlüssel selbst ist die Berechtigung — siehe die [API-Referenz](/de/develop/api-reference).

## Zeitpläne

Ein Zeitplan trägt einen Cron-Ausdruck aus fünf Feldern und die IANA-Zeitzone, in der er gelesen wird. Die Felder sind Minute, Stunde, Tag des Monats, Monat und Wochentag, und jedes nimmt ein `*`, eine Zahl, einen Bereich, eine Schrittweite oder eine kommagetrennte Liste davon.

```text
*/15 * * * *     alle fünfzehn Minuten
0 9 * * 1-5      09:00 an Werktagen
0 6 1 * *        06:00 am Ersten des Monats
30 8 1 * 1       08:30 am 1. und an jedem Montag
```

Der Wochentag läuft von 0 bis 7, wobei sowohl 0 als auch 7 Sonntag meinen. Schränkst du sowohl Tag des Monats **als auch** Wochentag ein, feuert ein Tag, der einem von beiden entspricht — dieselbe Regel wie bei crontab, und genau die lässt das letzte Beispiel so lesen, wie es sich verhält.

Die Zeitzone wird als Uhrzeit vor Ort aufgelöst: Ein Zeitplan auf 09:00 in `Europe/Zurich` bleibt über eine Zeitumstellung hinweg bei 09:00, statt zweimal im Jahr um eine Stunde zu wandern. Ein Zeitplan ohne genannte Zeitzone wird in UTC gelesen.

Die Auflösung beträgt eine Minute, und ein Zeitplan ist ein Herzschlag, keine Warteschlange: Nach einer Störung setzt die Automatisierung bei ihrem nächsten Termin ein, statt die verpassten nachzuholen. Ein Zeitplan, dessen Cron-Ausdruck sich nicht lesen lässt, wird übersprungen, statt die übrigen Zeitpläne der Plattform aufzuhalten — seine Zeit des letzten Feuerns rückt dann einfach nicht mehr vor, und das ist das Signal, ihn dir anzusehen.

## Webhooks

Ein Webhook ist eine eingehende URL, geschützt durch ein Token. Beim Anlegen wird das Token erzeugt und einmal angezeigt; gespeichert wird nur sein Hash, sodass die Plattform einen Aufrufer prüfen kann, ohne die URL je rekonstruieren zu können. Jedes System, das dorthin sendet, startet einen Lauf, und der Body der Anfrage wird zur Payload des Laufs.

```bash
curl -X POST https://<dein-tale-host>/api/automations/webhook/<token> \
  -H 'Content-Type: application/json' \
  -d '{"invoiceId": "inv-1"}'
```

Ein erfolgreicher Aufruf wird sofort angenommen und antwortet mit der id des gestarteten Laufs — der Aufrufer wartet also nie darauf, dass die Automatisierung fertig wird. Ein Body, der kein JSON ist, wird als Text durchgereicht statt abgewiesen, denn manche Anbieter senden Formular- oder Klartext-Payloads. Bodies sind auf 256 KB gedeckelt: Ein Webhook nimmt eine Payload entgegen, keinen Upload.

Zwei Abweisungen lohnt es sich zu erkennen. Ein unbekanntes Token und ein Token eines ausgeschalteten Triggers antworten absichtlich gleich, damit niemand die Plattform danach abklopfen kann, welche Tokens existieren. Eine Automatisierung ohne live geschaltete Version antwortet stattdessen mit einem Konflikt — das sagt dir, dass die URL in Ordnung ist und das Live-Schalten fehlt.

<Warning>

Das Token in der URL ist die Zugangsberechtigung. Wer die URL hat, kann die Automatisierung starten. Bewahre sie auf wie ein Passwort, gib sie nur über einen sicheren Kanal weiter, und lösche den Trigger, um sie zu widerrufen — das Token lässt sich danach nicht wiederherstellen.

</Warning>

## Ereignisse

Ein Ereignis-Trigger benennt ein Plattform-Ereignis und feuert, sobald dieses Ereignis in der Organisation eintritt. Die Payload des Ereignisses wird zur Eingabe des Laufs — das ist die Art, zu der du greifst, wenn die Automatisierung auf etwas reagieren soll, das die Plattform gerade selbst getan hat.

<Note>

Ein Ereignis, das aus dem Lauf einer Automatisierung stammt, feuert nie Trigger. Eine Automatisierung, die einen Datensatz schreibt, der ein Ereignis auslöst, das dieselbe Automatisierung startet, wäre eine endlose Schleife, die keine Begrenzung pro Lauf stoppen kann — deshalb weist die Plattform schon bei der Zustellung ab.

</Note>

## Was jede Art in den Lauf trägt

Die Eingabe, die eine Automatisierung erhält, sagt, welche Art sie gestartet hat — ein einzelnes Dokument kann also mehr als einen Trigger bedienen und sich am Unterschied verzweigen.

| Art        | Die Eingabe des Laufs                                        |
| ---------- | ------------------------------------------------------------ |
| `schedule` | Die Trigger-Art und der Termin, für den er gefeuert hat      |
| `webhook`  | Die Trigger-Art und der gesendete Body als Payload           |
| `event`    | Die Trigger-Art, der Name des Ereignisses und dessen Payload |

Ein per API gestarteter Lauf trägt genau den `input`, den der Aufrufer gesendet hat.

Deklarier die erwartete Form im `inputs`-Schema des Dokuments, und die Referenz darauf wird geprüft, bevor die Automatisierung überhaupt läuft.

## Live-Schalten stört sie nicht

Weil ein Trigger die Automatisierung benennt statt eine Version, überlebt die ganze Menge jedes Live-Schalten und jedes Zurückrollen. Gib einem Partner eine Webhook-URL, schalte elf weitere Versionen live, roll zweimal zurück — diese URL funktioniert weiter und trifft jeweils das, was gerade live ist.

Umgekehrt gilt dasselbe: Einen Trigger anzulegen, zu ändern oder zu entfernen ändert nichts am Dokument und nichts an seinen Versionen. Trigger und Versionen sind zwei unabhängige Dinge an derselben Automatisierung.

## Einen ausschalten, ohne ihn zu verlieren

Jeder Trigger hat einen Schalter, und ihn auszuschalten ist der Weg, eine Automatisierung zu stoppen, ohne etwas aufzugeben. Ein ausgeschalteter Zeitplan wird nicht mehr fällig, eine ausgeschaltete Webhook-URL wird nicht mehr angenommen, und ein ausgeschalteter Ereignis-Trigger passt nicht mehr — während die Zeile, ihre Konfiguration und die gesamte Lauf-Historie der Automatisierung genau dort bleiben, wo sie waren. Schalt ihn wieder ein, und er nimmt seine Arbeit auf.

Einen Trigger zu löschen ist die endgültige Fassung desselben Schritts, und bei einem Webhook widerrufst du damit zugleich die URL. Greif zum Schalter, wenn du eine Pause willst, und zum Löschen, wenn die Zugangsberechtigung weg soll.

## Wo das hingehört

Drei Arten, ein Verhalten: Jede startet die live geschaltete Version im Live-Modus, jede hält fest, wann sie zuletzt gefeuert hat, und jede lässt sich pausieren, ohne verloren zu gehen — und keine kümmert es, wie oft du seitdem live geschaltet hast. [Automatisierungskonzepte](/de/platform/automations/concepts) erklärt, warum die Bindung an den Namen das möglich macht; [Ausführungsprotokolle](/de/platform/automations/execution-logs) zeigt die Läufe, die deine Trigger erzeugt haben, und welcher jeden gestartet hat.
