---
title: Webhooks
description: Eingehende Webhook-Trigger — poste an eine Token-URL und eine deployte Automatisierung läuft. Token-Handhabung, Rotation, Idempotenz und die Antwortcodes.
---

Ein Webhook-Trigger macht aus einem POST deines Systems einen Lauf einer deployten Automatisierung — kein API-Schlüssel, kein SDK, nur eine URL, die Tale beim Binden des Triggers erzeugt. Das ist die richtige Naht, wenn der Aufrufer ein Drittprodukt ist — ein Zahlungsanbieter, ein Formular-Tool, ein CI-Job — das nur einen HTTP-Request an eine URL feuern kann, die du ihm gibst.

Lies das, wenn du ein externes System verdrahtest, das Automatisierungen starten soll. Für Aufrufe, bei denen du einen Wert zurückwillst oder einen API-Schlüssel hast, ist die [API-Referenz](/de/develop/api-reference) die synchrone Hälfte.

## Ein Trigger, durchgespielt

Binde einen Webhook-Trigger an eine Automatisierung — im Editor der Automatisierung oder mit `PUT /api/v1/automations/{name}/triggers` und `{"kind": "webhook"}` — und Tale antwortet einmalig mit dem Token der Trigger-URL. Danach kann jedes System einen Lauf starten:

Wähle die URL passend zum gewünschten Lauf. Für einen Projektlauf verwendest du wie im Beispiel `/api/projects/{id}/automations/webhook/{token}`. Die Automatisierung muss in diesem aktiven Projekt installiert sein; Projekt und Token müssen zur selben Organisation gehören. Das Token berechtigt zum Aufruf, kann aber kein ungebundenes Projekt auswählen. Für einen Lauf ohne Projekt verwendest du `/api/automations/webhook/{token}` mit einer Automatisierung ohne Projektbindungen. Eine gebundene Automatisierung verweigert diese globale URL mit **400**. Der Abfrageparameter `projectId` ergibt auf beiden URLs **400**. Der Anfrageinhalt des Anbieters geht als Daten an die Automatisierung und wählt kein Projekt aus.

```bash
curl -sS -X POST "https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
# → 202 { "runId": "..." }
```

Der Lauf erhält `{ "trigger": "webhook", "payload": <body> }`. Lies die Bestell-ID aus dem Beispiel über `input.payload.orderId`. Ein definiertes `inputs`-Schema beschreibt dieses umschließende Objekt. Ein Body, der kein JSON ist, wird als Text durchgereicht statt abgewiesen — manche Anbieter senden reinen Text — und alles über 256 KB wird mit **413** abgelehnt — die Grenze zählt Bytes, während der Body eintrifft, eine zu große Zustellung wird also abgewiesen statt gepuffert. Polle den Lauf wie jeden anderen über `GET /api/v1/projects/{id}/runs/{runId}` mit einem API-Schlüssel, oder schau ihm im Produkt zu. Einen Lauf ohne Projekt liest du stattdessen mit `GET /api/v1/runs/{runId}`. Ein Projektlauf verlangt seine Projekt-URL und einen API-Schlüssel mit Leserechten auf dieses Projekt.

Das vollständige Antwortvokabular:

- **202** `{ "runId": "..." }` — der Lauf ist gestartet.
- **202** `{ "runId": "...", "duplicate": true }` — eine erneute Zustellung einer bereits angenommenen; `runId` ist der Lauf, den die erste gestartet hat, einen zweiten gibt es nicht.
- **400** — ungültiger Projektbezug, ein archiviertes oder ungebundenes Projekt, eine gebundene Automatisierung an der globalen URL, ein Abfrageparameter `projectId` oder eine Eingabe, die nicht zum `inputs`-Schema passt. Es startet kein Lauf.
- **404** — unbekanntes, deaktiviertes oder vertipptes Token. Die Antwort unterscheidet die Fälle nie — wer rät, lernt nichts.
- **409** `{ "error": "automation has no deployed version" }` — deploye eine Version, deren Tests bestehen, und derselbe Aufruf läuft.
- **413** — der Body übersteigt 256 KB.

## Das Token ist die Berechtigung

Es gibt keine Signatur und keinen Authorization-Header: das Token in der URL ist die ganze Berechtigung — behandle die URL wie ein Passwort. Tale speichert nur einen Hash und vergleicht in konstanter Zeit; der Klartext existiert genau einmal, in der Antwort, die ihn erzeugt hat.

URL verloren oder geleakt? Rotiere sie — `PUT /api/v1/automations/{name}/triggers` mit `{"kind": "webhook", "rotateToken": true}` erzeugt ein frisches Token und antwortet es einmalig; die alte URL stirbt sofort. Das Lösen des Triggers (`DELETE .../triggers` oder im Editor) widerruft sie ganz; die Versionen und die Laufhistorie der Automatisierung bleiben.

## Idempotenz und Wiederholungen

Der Endpunkt erkennt wiederholte Zustellungen. Die Erkennung gilt jeweils für den Trigger und das Projekt seiner URL: Dieselbe Zustellungs-ID kann in jedem installierten Projekt einen Lauf starten. Auch vor einer gespeicherten Duplikatantwort prüft Tale, ob die Projektbindung noch besteht und das Projekt aktiv ist. Zwei Dinge identifizieren eine Zustellung:

- **Eine Zustellungs-ID, die du mitschickst.** Der erste dieser Header, der vorhanden ist, zählt: `Idempotency-Key`, `X-Idempotency-Key`, das `webhook-id` der Standard Webhooks, `X-GitHub-Delivery`, `X-Gitlab-Event-UUID`, `X-Shopify-Webhook-Id`, `Linear-Delivery`, `X-Atlassian-Webhook-Identifier`, `X-Request-UUID` (Bitbucket), `I-Twilio-Idempotency-Token`, `X-Webhook-Id`. Eine Wiederholung mit derselben ID innerhalb von 24 Stunden antwortet **202** mit dem ursprünglichen Lauf und `"duplicate": true` — egal, was im Body steht.
- **Der Anfrageinhalt selbst.** Ohne ID-Kopfzeile gilt ein byteidentischer Inhalt an derselben URL innerhalb von zwei Minuten als dieselbe Zustellung. Danach ist er eine neue. Ein Heartbeat, der alle paar Minuten denselben Inhalt sendet, startet also weitere Läufe.

```bash
curl -sS -X POST "https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345-paid" \
  -d '{ "orderId": "12345", "status": "paid" }'
# → 202 { "runId": "run_a" }
# dieselbe Anfrage noch einmal, beliebig oft, in den nächsten 24 Stunden:
# → 202 { "runId": "run_a", "duplicate": true }
```

Wiederholen ist von deiner Seite damit sicher: Wiederhole Timeouts und Nicht-2xx-Antworten mit Backoff, halte die Zustellungs-ID über alle Versuche stabil und behandle jedes **202** als angenommen — `duplicate: true` sagt dir, dass der frühere Versuch schon gelandet war. Die Antwort sagt, ob der Lauf _gestartet_ ist, nicht ob er gelungen ist; verfolge ihn über `GET /api/v1/projects/{id}/runs/{runId}`. Ein **409** wird nicht gemerkt: Deploye eine Version und schick die Zustellung noch einmal.

## Wo das hingehört

Der Webhook ist der Weg hinein ohne Schlüssel; alles andere läuft über einen API-Schlüssel. Die [Trigger-Seite](/de/platform/automations/triggers) behandelt die Produktseite — Zeitpläne, Events und Webhooks, wie der Automatisierungs-Editor sie zeigt. Die [API-Referenz](/de/develop/api-reference) behandelt das Starten von Läufen mit Schlüssel (`POST /api/v1/projects/{id}/automations/{name}/runs`) — die bessere Naht, wenn der Aufrufer dein eigener Code ist.
