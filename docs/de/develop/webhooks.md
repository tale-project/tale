---
title: Webhooks
description: Eingehende Webhook-Trigger — poste an eine Token-URL und eine deployte Automatisierung läuft. Token-Handhabung, Rotation, Idempotenz und die Antwortcodes.
---

Ein Webhook-Trigger macht aus einem POST deines Systems einen Lauf einer deployten Automatisierung — kein API-Schlüssel, kein SDK, nur eine URL, die Tale beim Binden des Triggers erzeugt. Das ist die richtige Naht, wenn der Aufrufer ein Drittprodukt ist — ein Zahlungsanbieter, ein Formular-Tool, ein CI-Job — das nur einen HTTP-Request an eine URL feuern kann, die du ihm gibst.

Lies das, wenn du ein externes System verdrahtest, das Automatisierungen starten soll. Für Aufrufe, bei denen du einen Wert zurückwillst oder einen API-Schlüssel hast, ist die [API-Referenz](/de/develop/api-reference) die synchrone Hälfte.

## Ein Trigger, durchgespielt

Binde einen Webhook-Trigger an eine Automatisierung — im Editor der Automatisierung oder mit `PUT /api/v1/automations/{name}/triggers` und `{"kind": "webhook"}` — und Tale antwortet einmalig mit dem Token der Trigger-URL. Danach kann jedes System einen Lauf starten:

```bash
curl -sS -X POST "https://your-host.example.com/api/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
# → 202 { "runId": "..." }
```

Der Body wird zum Input des Laufs. Ein Body, der kein JSON ist, wird als Text durchgereicht statt abgewiesen — manche Anbieter senden reinen Text — und alles über 256 KB wird mit **413** abgelehnt — die Grenze zählt Bytes, während der Body eintrifft, eine zu große Zustellung wird also abgewiesen statt gepuffert. Polle den Lauf wie jeden anderen über `GET /api/v1/runs/{runId}` mit einem API-Schlüssel, oder schau ihm im Produkt zu.

Das vollständige Antwortvokabular:

- **202** `{ "runId": "..." }` — der Lauf ist gestartet.
- **202** `{ "runId": "...", "duplicate": true }` — eine erneute Zustellung einer bereits angenommenen; `runId` ist der Lauf, den die erste gestartet hat, einen zweiten gibt es nicht.
- **404** — unbekanntes, deaktiviertes oder vertipptes Token. Die Antwort unterscheidet die Fälle nie — wer rät, lernt nichts.
- **409** `{ "error": "automation has no deployed version" }` — deploye eine Version, deren Tests bestehen, und derselbe Aufruf läuft.
- **413** — der Body übersteigt 256 KB.

## Das Token ist die Berechtigung

Es gibt keine Signatur und keinen Authorization-Header: das Token in der URL ist die ganze Berechtigung — behandle die URL wie ein Passwort. Tale speichert nur einen Hash und vergleicht in konstanter Zeit; der Klartext existiert genau einmal, in der Antwort, die ihn erzeugt hat.

URL verloren oder geleakt? Rotiere sie — `PUT /api/v1/automations/{name}/triggers` mit `{"kind": "webhook", "rotateToken": true}` erzeugt ein frisches Token und antwortet es einmalig; die alte URL stirbt sofort. Das Lösen des Triggers (`DELETE .../triggers` oder im Editor) widerruft sie ganz; die Versionen und die Laufhistorie der Automatisierung bleiben.

## Idempotenz und Wiederholungen

Der Endpoint dedupliziert Zustellungen, denn jeder Anbieter liefert mindestens einmal. Zwei Dinge identifizieren eine Zustellung:

- **Eine Zustellungs-ID, die du mitschickst.** Der erste dieser Header, der vorhanden ist, zählt: `Idempotency-Key`, `X-Idempotency-Key`, das `webhook-id` der Standard Webhooks, `X-GitHub-Delivery`, `X-Gitlab-Event-UUID`, `X-Shopify-Webhook-Id`, `Linear-Delivery`, `X-Atlassian-Webhook-Identifier`, `X-Request-UUID` (Bitbucket), `I-Twilio-Idempotency-Token`, `X-Webhook-Id`. Eine Wiederholung mit derselben ID innerhalb von 24 Stunden antwortet **202** mit dem ursprünglichen Lauf und `"duplicate": true` — egal, was im Body steht.
- **Der Body selbst.** Ohne ID-Header ist ein byteidentischer Body an dieselbe URL (und dieselbe `projectId`) innerhalb von zwei Minuten dieselbe Zustellung. Nach zwei Minuten ist er eine neue — ein Heartbeat, der alle paar Minuten denselben Body postet, läuft also weiter.

```bash
curl -sS -X POST "https://your-host.example.com/api/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345-paid" \
  -d '{ "orderId": "12345", "status": "paid" }'
# → 202 { "runId": "run_a" }
# dieselbe Anfrage noch einmal, beliebig oft, in den nächsten 24 Stunden:
# → 202 { "runId": "run_a", "duplicate": true }
```

Wiederholen ist von deiner Seite damit sicher: Wiederhole Timeouts und Nicht-2xx-Antworten mit Backoff, halte die Zustellungs-ID über alle Versuche stabil und behandle jedes **202** als angenommen — `duplicate: true` sagt dir, dass der frühere Versuch schon gelandet war. Die Antwort sagt, ob der Lauf _gestartet_ ist, nicht ob er gelungen ist; verfolge ihn über `GET /api/v1/runs/{runId}`. Ein **409** wird nicht gemerkt: Deploye eine Version und schick die Zustellung noch einmal.

## Wo das hingehört

Der Webhook ist der Weg hinein ohne Schlüssel; alles andere läuft über einen API-Schlüssel. Die [Trigger-Seite](/de/platform/automations/triggers) behandelt die Produktseite — Zeitpläne, Events und Webhooks, wie der Automatisierungs-Editor sie zeigt. Die [API-Referenz](/de/develop/api-reference) behandelt das Starten von Läufen mit Schlüssel (`POST /api/v1/automations/{name}/runs`) — die bessere Naht, wenn der Aufrufer dein eigener Code ist.
