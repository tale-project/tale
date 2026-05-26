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

Wenn dein System einen Tale-Workflow feuern muss, poste an die Trigger-URL des Workflows:

```bash
curl -sS https://your-host.example.com/api/v1/workflows/triggers/<trigger-name> \
  -H "Authorization: Bearer $TALE_TRIGGER_KEY" \
  -H "Idempotency-Key: order-12345" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

Der Trigger-Key ist ein Webhook-Trigger-bezogener API-Key, der neben dem Trigger im Workflow-Editor erzeugt wird. Der Body wird die Eingabe des ersten Workflow-Schritts. Die Antwort ist JSON mit einer `executionId`, die du beim Prüfen des Laufs zitieren kannst.

## Signieren und verifizieren

Ausgehend: das pro-Endpoint-Signier-Secret wird einmal angezeigt, wenn du den Endpoint unter **Einstellungen > Integrations** oder im Webhook-Trigger-Panel des Workflow-Editors hinzufügst. Tale signiert jeden Body mit HMAC-SHA256 mit diesem Secret; Verifizierung ist String-Vergleich in konstanter Zeit.

Eingehend: es gibt kein Signieren — das Bearer-Token ist die Auth. Wenn du das Token nicht geheim halten kannst, exponiere die Trigger-URL nicht.

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

Eingehend: gib `Idempotency-Key` bei jedem Trigger-Aufruf mit. Tale speichert den Key gegen die resultierende Ausführung für 24 Stunden; ein Retry mit demselben Key gibt dieselbe Execution-ID zurück, ohne den Workflow erneut zu feuern.

Ausgehend: jede Auslieferung trägt eine eindeutige `X-Tale-Delivery`-UUID. Nutz sie zum Dedupen auf deiner Seite — Tale wiederholt bei Nicht-2xx-Antworten, und dieselbe Delivery-UUID erscheint bei jedem Retry, bis der Empfänger bestätigt.

## Retries

Ausgehende Retries folgen exponentiellem Backoff mit Jitter, begrenzt auf 24 Stunden an Versuchen. Der Plan:

- Sofortiger Retry bei einem 5xx oder Timeout.
- 30 s, 1 m, 5 m, 30 m, 2 h, 8 h, 24 h nach dem ersten Fehler.
- Nach 24 h ohne 2xx ist die Auslieferung als fehlgeschlagen markiert; das Audit-Log hält es fest.

Eingehende Retries sind die Verantwortung des Aufrufers — Tales Antwort zeigt Erfolg oder Fehler des Triggers, nicht der Workflow-Schritte. Willst du wiederholen, nutz einen stabilen Idempotenz-Key.

## Wo das hingehört

Webhooks sind die Naht zwischen Tale und externen Systemen auf beiden Seiten. Die [API-Referenz](/de/develop/api-reference) behandelt die synchrone Hälfte — die Endpoints, die du aufrufst, wenn du einen Wert sofort zurück willst. Die [Trigger-Referenz](/de/platform/automations/triggers) deckt die Workflow-Seite eingehender Webhooks ab — die Konfiguration, die einen POST in einen Workflow-Lauf verwandelt.
