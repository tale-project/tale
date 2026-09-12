---
title: Automatisierungs-Trigger
description: Die drei Wege, auf denen eine Automatisierung von selbst startet — ein Zeitplan, ein Webhook oder ein Plattform-Ereignis — was jeder in den Lauf trägt und warum keiner beim Live-Schalten zerbricht.
---

Ein Trigger ist das, was eine Automatisierung startet, wenn niemand irgendwo klickt. Es gibt genau drei Arten, die Menge ist abgeschlossen, und eine Automatisierung trägt genau einen Trigger — bindest du eine andere Art, ersetzt sie den bisherigen, und wer einen Webhook durch einen Zeitplan oder ein Event ersetzt, widerruft die URL des Webhooks auf der Stelle (das Speichern sagt es, und keine spätere Webhook-Bindung bringt diese URL zurück). Das Nützlichste, was du über einen Trigger wissen kannst: Er hängt am **Namen** der Automatisierung und nicht an einer Version. Deshalb macht eine neu live geschaltete Version nie eine Webhook-URL ungültig, auf die ein externes System angewiesen ist, und wirft nie einen Zeitplan weg.

Jeder Trigger startet die live geschaltete Version und läuft im Live-Modus — eine Automatisierung ohne Live-Version lässt sich von ihm also nicht starten. Jeder Trigger trägt einen Ein-Aus-Schalter und führt zwei eigene Aufzeichnungen: den letzten Lauf, den er gestartet hat, und das letzte Mal, dass er fällig war und nichts gestartet hat — mit dem Grund, damit eine Automatisierung, die nicht läuft, dir sagt, warum.

## Die drei Arten

| Art        | Startet die Automatisierung, wenn …                            |
| ---------- | -------------------------------------------------------------- |
| `schedule` | ein Cron-Ausdruck in einer benannten IANA-Zeitzone fällig wird |
| `webhook`  | ein externes System an eine Token-geschützte URL sendet        |
| `event`    | ein benanntes Plattform-Ereignis eintritt                      |

Ein programmatischer Start braucht keinen Trigger. Für Projektarbeit ruft ein API-Client `POST /api/v1/projects/{id}/automations/{name}/runs` auf. Eine Automatisierung ohne Projektbindungen kann er auch ohne Projekt über `POST /api/v1/automations/{name}/runs` starten. Sein API-Schlüssel und seine Projektrechte berechtigen zum Aufruf. Das MCP-Tool `start_run` bietet einen weiteren Zugang; die [API-Referenz](/de/develop/api-reference) erklärt die Regeln.

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

Die Auflösung beträgt eine Minute, und ein Zeitplan ist ein Herzschlag, keine Warteschlange: Nach einer Störung setzt die Automatisierung bei ihrem nächsten Termin ein, statt die verpassten nachzuholen. Ein Cron, der ein Datum nennt, das kein Kalender hat — `0 0 30 2 *`, oder der 31. in einem Monat mit dreißig Tagen —, wird beim Speichern abgelehnt; ein Zeitplan, der sich binden lässt, ist also einer, der fällig wird. Erweist sich ein gespeicherter Ausdruck trotzdem als unlesbar (etwa eine Zeitzone, die die Plattform nicht mehr kennt), überspringt der Scheduler ihn, statt die übrigen Zeitpläne der Plattform aufzuhalten, vermerkt das Überspringen am Trigger als `unusable_cron` und lässt ihn in Ruhe, bis du ihn bearbeitest. Die Zeit des letzten Feuerns eines Zeitplans rückt nur vor, wenn tatsächlich ein Lauf gestartet ist; ein Zeitplan, der fällig wird, während nichts live ist, vermerkt stattdessen `not_deployed`, und einer, dessen Live-Version die Eingabe des Laufs ablehnt, vermerkt `start_refused` — lies den Trigger, und du weißt, welcher Fall es ist.

## Webhooks

Ein Webhook ist eine eingehende URL, geschützt durch ein Token. Beim Anlegen wird das Token erzeugt und einmal angezeigt; gespeichert wird nur sein Hash, sodass die Plattform einen Aufrufer prüfen kann, ohne die URL je rekonstruieren zu können. Jedes System, das dorthin sendet, startet einen Lauf, und der Body der Anfrage wird zur Payload des Laufs.

```bash
curl -X POST "https://<dein-tale-host>/api/projects/<projectId>/automations/webhook/<token>" \
  -H 'Content-Type: application/json' \
  -d '{"invoiceId": "inv-1"}'
```

Ein erfolgreicher Aufruf wird sofort angenommen und antwortet mit der id des gestarteten Laufs — der Aufrufer wartet also nie darauf, dass die Automatisierung fertig wird. Ein Body, der kein JSON ist, wird als Text durchgereicht statt abgewiesen, denn manche Anbieter senden Formular- oder Klartext-Payloads. Bodies sind auf 256 KiB (262.144 Bytes) gedeckelt: Ein Webhook nimmt eine Payload entgegen, keinen Upload.

Zustellungen sind idempotent, denn jeder Anbieter liefert mindestens einmal — eine langsame Antwort, eine abgerissene Verbindung oder ein Klick auf _erneut zustellen_ schickt dieselbe Zustellung noch einmal. Eine Anfrage, die ihre Zustellung benennt (`Idempotency-Key`, das `webhook-id` der Standard Webhooks, `X-GitHub-Delivery` und die anderen gängigen Anbieter-Header), bleibt 24 Stunden bekannt: Eine Wiederholung mit derselben ID antwortet mit dem Lauf, den die erste gestartet hat, markiert mit `duplicate: true`, statt einen zweiten zu starten. Eine Anfrage ohne ID erkennt die Plattform am Body — ein byteidentischer Body an dieselbe URL innerhalb von zwei Minuten ist dieselbe Zustellung. Unterschiedliche Zustellungen laufen jede für sich; können sich deine Payloads innerhalb von zwei Minuten legitim wiederholen, schick eine ID mit. Die vollständige Header-Liste und die Antwortformen stehen unter [Webhooks](/de/develop/webhooks).

Die Beispiel-URL benennt das Projekt des Laufs. Die Automatisierung muss in diesem aktiven Projekt installiert sein, in derselben Organisation wie das Token. Das Token kann kein anderes Projekt auswählen: Ein Projekt, in dem es nicht laufen kann — eines, das nicht existiert, archiviert ist oder in dem die Automatisierung nicht installiert ist —, antwortet **403** `AUTOMATION_PROJECT_FORBIDDEN`, eine Ablehnung für alle drei, damit eine geleakte URL deine Projekt-ids nicht abtasten kann. Für eine Automatisierung ohne Projektbindungen startet `/api/automations/webhook/{token}` einen Lauf ohne Projekt; eine gebundene Automatisierung antwortet dort mit **409** `AUTOMATION_PROJECT_SCOPE_REQUIRED` — nimm ihre Projekt-URL. Ein Abfrageparameter `projectId` antwortet **400** `INVALID_QUERY`. Zustellungs-IDs und identische Inhalte gelten jeweils pro Projekt-URL. Einen Projektlauf liest du über `/api/v1/projects/{id}/runs/{runId}` mit einem API-Schlüssel, der auf das Projekt zugreifen darf.

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

Drei Arten, ein Verhalten: Jede startet die live geschaltete Version im Live-Modus, jede hält den letzten Lauf fest, den sie gestartet hat, und das letzte Mal, dass sie ohne einen fällig war, und jede lässt sich pausieren, ohne verloren zu gehen — und keine kümmert es, wie oft du seitdem live geschaltet hast. [Automatisierungskonzepte](/de/platform/automations/concepts) erklärt, warum die Bindung an den Namen das möglich macht; [Ausführungsprotokolle](/de/platform/automations/execution-logs) zeigt die Läufe, die deine Trigger erzeugt haben, und welcher jeden gestartet hat.
