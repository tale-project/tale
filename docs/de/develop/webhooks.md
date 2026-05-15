---
title: Webhooks
description: Workflows und Agents aus externen Systemen per signierter HTTP-Request aufrufen.
---

Tale bietet zwei Arten von Webhooks: **Workflow-Webhooks** (lösen eine Automatisierung aus) und **Agent-Webhooks** (senden eine Nachricht an einen Agent außerhalb der Chat-UI). Beide nutzen dasselbe Anfrage-Format und dasselbe Signatur-Schema.

## Workflow-Webhooks

Jeder Workflow hat eine eigene Webhook-URL, sichtbar im **Konfiguration**-Tab:

```text
https://<your-tale-domain>/api/webhooks/workflow/<workflow-id>
```

POSTe einen JSON-Body, um den Workflow mit diesen Daten als Input zu starten:

```bash
curl -X POST https://tale.example.com/api/webhooks/workflow/abc123 \
  -H "Content-Type: application/json" \
  -H "X-Tale-Signature: sha256=..." \
  -d '{"customerId": "c-42", "priority": "high"}'
```

Die Antwort enthält sofort eine Ausführungs-ID. Den Status und Output siehst du im **Ausführungen**-Tab des Workflows (oder über die REST-API).

## Agent-Webhooks

Jeder Agent hat einen eigenen Endpoint:

```text
https://<your-tale-domain>/api/webhooks/agent/<agent-slug>
```

POSTe eine Nachricht, um eine Agent-Antwort ohne die Plattform-UI zu bekommen. Die Antwort ist synchron — der HTTP-Anfrage blockiert, bis der Agent fertig generiert hat.

```bash
curl -X POST https://tale.example.com/api/webhooks/agent/support-agent \
  -H "Content-Type: application/json" \
  -H "X-Tale-Signature: sha256=..." \
  -d '{
    "message": "Wo bleibt meine Bestellung?",
    "conversationId": "optional-existing-id"
  }'
```

Wenn `conversationId` weggelassen wird, wird eine neue Konversation angelegt und in der Antwort zurückgegeben.

## Signatur-Verifizierung

Tale signiert jeden Webhook-Anfrage mit HMAC-SHA-256 unter Verwendung des Webhook-Secrets. Die Signatur wird im Kopfzeile `X-Tale-Signature` als `sha256=<hex>` mitgeschickt.

Empfänger sollten:

1. den rohen Anfrage-Body lesen (nicht das geparste JSON);
2. `HMAC-SHA-256(secret, body)` berechnen;
3. den Kopfzeile-Wert per constant-time-Vergleich prüfen;
4. Anfragen ablehnen, die nicht übereinstimmen.

Node.js-Beispiel:

```javascript
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(req, secret) {
  const signature = req.headers['x-tale-signature'];
  if (!signature) return false;
  const expected =
    'sha256=' + createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Python-Beispiel:

```python
import hmac, hashlib

def verify(body: bytes, header: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header or '', expected)
```

## Wiederholungen

Tale versucht fehlgeschlagene Webhook-Zustellungen (Non-2xx-Antworten, Timeouts) mit exponentiellem Backoff bis zu 5 Mal erneut. Nach dem letzten Fehlschlag wird die Zustellung als fehlgeschlagen markiert und im Audit-Stream protokolliert — ein Admin kann sie über die Audit-Logs-Seite wiedergeben.

## Wo das hingehört

Webhooks sind das eingehende Gegenstück zur ausgehenden API von Tale. Die API ruft dein Code, wenn _du_ die Konversation treibst; Webhooks bietet Tale an, damit ein externes System einen Workflow auslöst oder einen Agent anspricht, ohne dass jemand in der Chat-UI sitzt. Beide Formen teilen sich dasselbe Signatur-Schema und denselben Audit-Log, sodass ein einziges gehärtetes Receiver-Muster alles abdeckt, was Tale sendet.

Für die verwandten Stücke: [API-Referenz](/de/develop/api-reference) ist die ausgehende Seite desselben Protokolls, [Trigger](/de/platform/automations/triggers) zeigt, wie ein Workflow Webhook-Trigger einschaltet, und der [Agents — Webhook-Tab](/de/platform/agents/create#tab-webhook) führt durch die Pro-Agent-Einrichtung.
