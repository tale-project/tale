---
title: Webhooks
description: Invoke workflows and agents from external systems via signed HTTP requests.
---

Tale exposes two kinds of webhooks: **workflow webhooks** (trigger an automation) and **agent webhooks** (send a message to an agent outside the chat UI). Both use the same request format and signature scheme.

## Workflow webhooks

Every workflow has a unique webhook URL visible on its Configuration tab:

```text
https://<your-tale-domain>/api/webhooks/workflow/<workflow-id>
```

POST a JSON body to start the workflow with that data as input:

```bash
curl -X POST https://tale.example.com/api/webhooks/workflow/abc123 \
  -H "Content-Type: application/json" \
  -H "X-Tale-Signature: sha256=..." \
  -d '{"customerId": "c-42", "priority": "high"}'
```

The response returns immediately with an execution ID. Query the workflow's Executions tab (or the REST API) to see status and output.

## Agent webhooks

Every agent has a unique endpoint:

```text
https://<your-tale-domain>/api/webhooks/agent/<agent-slug>
```

POST a message to get an agent response without using the platform UI. The response is synchronous — the HTTP request blocks until the agent has finished generating.

```bash
curl -X POST https://tale.example.com/api/webhooks/agent/support-agent \
  -H "Content-Type: application/json" \
  -H "X-Tale-Signature: sha256=..." \
  -d '{
    "message": "Where is my order?",
    "conversationId": "optional-existing-id"
  }'
```

If `conversationId` is omitted, a new conversation is created and returned in the response.

## Signature verification

Tale signs every webhook request with HMAC-SHA-256 using the webhook's secret. The signature is sent in the `X-Tale-Signature` header as `sha256=<hex>`.

Receivers should:

1. Read the raw request body (not parsed JSON).
2. Compute `HMAC-SHA-256(secret, body)`.
3. Compare with the header value using a constant-time equality check.
4. Reject requests that don't match.

Node.js example:

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

Python example:

```python
import hmac, hashlib

def verify(body: bytes, header: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header or '', expected)
```

## Retries

Tale retries failed webhook deliveries (non-2xx responses, timeouts) with exponential backoff up to 5 attempts. After the final failure the delivery is marked failed and logged in the audit stream — an admin can replay it from the Audit logs page.

## See also

- [API reference](/develop/api-reference) for the full REST API.
- [Triggers](/platform/automations/triggers) for configuring webhook triggers on workflows.
- [Agents — Webhook tab](/platform/agents/create#webhook-tab) for agent webhook setup.
