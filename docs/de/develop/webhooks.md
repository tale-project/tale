---
title: Webhooks
description: Eingehende Webhook-Trigger (du postest an Tale) und ausgehende Event-Webhooks (Tale postet an dich). Signieren, Idempotenz, Retries.
---

Webhooks sind, wie Tale und der Rest deines Stacks asynchron sprechen. Zwei Richtungen existieren: eingehend — dein System postet an einen Tale-Workflow-Trigger, um einen Lauf zu feuern — und ausgehend — Tale postet an deine URL, wenn etwas passiert, das es überwacht. Die zwei Hälften teilen sich das Auth-Modell (ein Bearer-Token), das Signier-Schema (HMAC-SHA256 über den Body) und die Retry-Richtlinie (exponentielles Backoff mit Jitter).

Lies das, wenn du eine Integration verdrahtest, die in eine der Richtungen auf Events reagieren muss. Komm zurück, wenn ein Webhook feuert, der Empfänger ihn aber nicht sieht, oder wenn Retries sich nicht so verhalten, wie du es erwartet hast.

## Ein durchgespielter ausgehender Webhook

Wenn ein Event, das Tale überwacht, geschieht — eine Workflow-Ausführung schliesst ab, ein Agent beendet eine Antwort, ein Dokument-Schreibvorgang ist fertig — postet Tale das Event an deine konfigurierte URL:

```http
POST https://your-host.example.com/webhooks/tale
Content-Type: application/json
X-Tale-Event: workflow.execution.completed
X-Tale-Signature: sha256=<hex>
X-Tale-Delivery: <uuid>
X-Tale-Timestamp: 1717000000

{
  "event": "workflow.execution.completed",
  "data": { "workflowId": "...", "executionId": "...", "status": "succeeded", ... }
}
```

Verifiziere die Signatur, bevor du dem Body vertraust: HMAC-SHA256 über den rohen Body mit dem pro-Endpoint-Secret, hex-kodiert. Vergleiche in konstanter Zeit. Lehn jeden Request älter als fünf Minuten ab, indem du `X-Tale-Timestamp` gegen deine Uhr prüfst.

## Ein durchgespielter eingehender Trigger

Wenn dein System einen Tale-Workflow feuern muss, poste an die Webhook-URL, die Tale erzeugt, sobald du dem Workflow einen Webhook-Trigger hinzufügst:

```bash
curl -sS https://your-host.example.com/api/automations/webhook/<token> \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

Das Token im URL-Pfad ist der Berechtigungsnachweis — ein Authorization-Header ist nicht nötig; behandle also die ganze URL als Secret und lösch den Trigger, um sie zu widerrufen. Der Body wird die Eingabe des Laufs; ein Body, der kein JSON ist, wird als Text durchgereicht statt abgelehnt, und alles über 256 KB quittiert **413**. Ein angenommener Aufruf gibt **202** mit `{ "runId": "..." }` zurück. Ein unbekanntes, deaktiviertes oder vertipptes Token ist ein schlichtes **404** — die Antwort unterscheidet die Fälle nie, wer rät, lernt also nichts. Eine Automatisierung ohne deployte Version antwortet **409** mit `{ "error": "automation has no deployed version" }`: Deploy eine Version, deren Tests grün sind, und derselbe Aufruf läuft.

## Signieren und verifizieren

Ausgehend: das pro-Endpoint-Signier-Secret wird einmal angezeigt, wenn du den Endpoint unter **Einstellungen > Integrations** oder im Webhook-Trigger-Panel des Workflow-Editors hinzufügst. Tale signiert jeden Body mit HMAC-SHA256 mit diesem Secret; Verifizierung ist String-Vergleich in konstanter Zeit.

Eingehend: es gibt kein Signieren — das Token in der URL ist die Auth. Kannst du die URL nicht geheim halten, gib sie nicht heraus; lösch den Webhook, um sie zu rotieren.

```python
import hmac, hashlib

def verify(body: bytes, signature: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

## Idempotenz

Eingehend: der Trigger-Endpunkt dedupliziert nicht für dich, ein wiederholter POST startet also einen zweiten Lauf. Sicher macht einen Retry der Lauf selbst — ein Live-Lauf setzt nach jedem abgeschlossenen Knoten einen Checkpoint, ein wiederaufgenommener Lauf wiederholt seine bereits erzeugten Seiteneffekte also nie. Wo ein doppelter Lauf trotzdem falsch wäre, führ deinen eigenen Dedup-Schlüssel im Payload mit und verzweig im ersten Knoten des Workflows darauf.

Ausgehend: jede Auslieferung trägt eine eindeutige `X-Tale-Delivery`-UUID. Nutz sie zum Dedupen auf deiner Seite — Tale wiederholt bei Nicht-2xx-Antworten, und dieselbe Delivery-UUID erscheint bei jedem Retry, bis der Empfänger bestätigt.

## Retries

Ausgehende Retries folgen exponentiellem Backoff mit Jitter, begrenzt auf 24 Stunden an Versuchen. Der Plan:

- Sofortiger Retry bei einem 5xx oder Timeout.
- 30 s, 1 m, 5 m, 30 m, 2 h, 8 h, 24 h nach dem ersten Fehler.
- Nach 24 h ohne 2xx ist die Auslieferung als fehlgeschlagen markiert; das Audit-Log hält es fest.

Eingehende Retries sind die Verantwortung des Aufrufers — Tales Antwort zeigt Erfolg oder Fehler des Triggers, nicht der Workflow-Schritte. Willst du wiederholen, nutz einen stabilen Idempotenz-Key.

## Wo das hingehört

Webhooks sind die Naht zwischen Tale und externen Systemen auf beiden Seiten. Die [API-Referenz](/de/develop/api-reference) behandelt die synchrone Hälfte — die Endpoints, die du aufrufst, wenn du einen Wert sofort zurück willst. Die [Trigger-Referenz](/de/platform/automations/triggers) deckt die Workflow-Seite eingehender Webhooks ab — die Konfiguration, die einen POST in einen Workflow-Lauf verwandelt.
