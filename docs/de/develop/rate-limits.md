---
title: Rate-Limits
description: REST- und MCP-Rate-Limits — die Buckets, die 429-Antwort mit ihrem Retry-After und wie du wiederholst, ohne es schlimmer zu machen.
---

Die API limitiert mit Token-Buckets, die am Schlüsselinhaber hängen — dem Benutzer, als der dein API-Schlüssel handelt. Ein Budget gehört so immer einem erkennbaren Aufrufer, und kein Netzwerk-Header kann ein frisches prägen: Bursts gehen durch, Dauerfeuer antwortet **429**. Jeder Schlüssel, den ein Benutzer erstellt, zieht aus dem Budget dieses Benutzers; eine Worker-Flotte, die ein eigenes Budget braucht, bekommt einen eigenen Maschinenbenutzer. Ein Schlüssel, der sich nicht authentifizieren lässt, wird stattdessen pro Quell-IP gedrosselt (20 Anfragen pro Minute, Burst 40) — Fremde ziehen also nie aus dem Budget eines Schlüsselinhabers, und eine Anfrage ohne Schlüssel kostet gar nichts. Die Budgets sind so bemessen, dass eine normale Connector sie nie sieht — wenn ein bisher gesunder Client 429 zu treffen beginnt, fehlt fast immer ein Backoff oder eine Schleife läuft heiß, nicht die Kapazität.

Lies das, wenn du einen Client verdrahtest, der die API nach Zeitplan oder unter Last aufruft.

## Die Buckets

| Oberfläche                                                                                                                        | Budget              | Burst |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----- |
| Lesen und CRUD — jeder `/api/v1`-Endpoint, der unten nicht steht, einschließlich `POST /api/v1/mcp`                               | 120 Anfragen / Min. | 200   |
| Arbeit starten — Projektläufe (`POST /api/v1/projects/{id}/automations/{name}/runs`), Nachrichten (`POST /api/v1/projects/{id}/threads/{threadId}/messages`) und Aufgaben (`POST /api/v1/projects/{id}/tasks/{taskId}/start`), außerdem Automatisierungsläufe und Threadnachrichten ohne Projekt | 20 Anfragen / Min. | 40 |
| Der Projekt-Upload-Fluss — der Upload-Handoff und das Datei-Binden (`POST .../uploads` und `POST .../files`)                      | 240 Anfragen / Min. | 300   |
| Eingehende Webhook-Zustellungen (`POST /api/automations/webhook/{token}` und die Projektform) — pro Absenderadresse, belastet, bevor das Token geprüft wird | 120 Anfragen / Min. | 240 |
| Dieselben Zustellungen, pro verifiziertem Trigger                                                                                  | 20 Anfragen / Min.  | 40    |

Der zweite Bucket ist mit Absicht klein: jede dieser Anfragen kostet einen ganzen durablen Lauf oder einen Modell-Turn, keinen Datenbank-Read — und der Webhook-Bucket pro Trigger ist es aus demselben Grund; die Webhook-Tür trägt keinen Schlüssel, also hängen ihre Budgets an der Adresse des Absenders und am Trigger, den das Token nennt (die [Webhooks-Seite](/de/develop/webhooks) hat das Vokabular dieser Tür). Der dritte ist mit Absicht geräumig: eine Datei kostet hier mindestens zwei Aufrufe — Handoff holen, Datei binden — das Budget deckt also die ganze Choreografie. Jede Anfrage zählt zusätzlich gegen das allgemeine Budget — es ist die Tür — ein Arbeit-startender oder Upload-POST zieht also aus zwei Spuren zugleich, und die engere bestimmt; plane gegen sie. Ein Token-Bucket füllt sich kontinuierlich — die Burst-Kapazität schluckt einen Stapel, danach gilt die Dauerrate.

Manche Schreibzugriffe durchlaufen zusätzlich dieselben Budgets pro Benutzer oder Organisation wie ihre Zwillinge in der App — ein Aufgaben-Kommentar, eine Ordner-Änderung — und antworten jenseits davon mit derselben 429.

## Die 429

Eine Überschreitung antwortet mit dem gewöhnlichen Fehlerumschlag der API, plus einem `Retry-After`-Header, der die Wartezeit in ganzen Sekunden nennt (aufgerundet):

```json
{ "error": "RATE_LIMITED", "code": "RATE_LIMITED", "data": { "retryAfterMs": 1500 } }
```

`code` ist der Wert, auf den du verzweigst, wie überall im [Fehlermodell](/de/develop/api-reference); bei dieser einen Ablehnung wiederholt `error` ihn, statt einen Satz zu tragen, weil dieselbe 429 auch die In-App-Türen bedient, deren Clients `error` lesen. Der Body nennt die Wartezeit in Millisekunden als `data.retryAfterMs`; die Kopfzeile `Retry-After` rundet sie auf ganze Sekunden auf. Aus `1500` Millisekunden wird zum Beispiel `Retry-After: 2`.

Warte mindestens `Retry-After`, bevor du es erneut versuchst. Restbudget-Zähler gibt es keine — darüber hinaus backe blind zurück: starte bei einer Sekunde, verdopple pro aufeinanderfolgendem 429, deckle bei sechzig, und füge Jitter hinzu, damit parallele Worker nicht im Gleichschritt wiederholen. Weil ein Lauf-Start mit **202** antwortet, bevor die Arbeit passiert, ist eine verlorene Antwort der Normalfall, kein Randfall: benenne den Start mit `Idempotency-Key` und wiederhole ihn — die Wiederholung antwortet mit dem Lauf, den der erste Versuch gestartet hat, markiert mit `duplicate: true`, statt einen zweiten zu starten (die Regeln stehen in der [API-Referenz](/de/develop/api-reference)).

## Wo das hingehört

Die [API-Referenz](/de/develop/api-reference) nennt die 429 im Fehlermodell und zeigt hierher. Braucht dein Workload wirklich mehr, als die Budgets erlauben, bündle auf deiner Seite — `POST /api/v1/contacts/bulk` existiert genau dafür — oder strecke den Zeitplan; die Buckets gelten pro Schlüsselinhaber — Traffic auf mehrere Schlüssel desselben Benutzers zu verteilen ändert nichts. Eine Integration, die wirklich ein eigenes Budget braucht, bekommt einen eigenen Maschinenbenutzer.
