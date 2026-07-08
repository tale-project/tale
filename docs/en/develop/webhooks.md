---
title: Webhooks
description: Inbound webhook triggers (you POST to Tale) and outbound event webhooks (Tale POSTs to you). Signing, idempotency, retries.
---

Webhooks are how Tale and the rest of your stack talk asynchronously. Two directions exist: inbound — your system POSTs to a Tale workflow trigger to fire a run — and outbound — Tale POSTs to your URL when something it cares about happens. The two halves share the same auth model (a bearer token), the same signing scheme (HMAC-SHA256 over the body), and the same retry policy (exponential backoff with jitter).

Read this when you are wiring an integration that needs to react to events in either direction. Come back when a webhook is firing but the receiver does not see it, or when retries are not behaving the way you expected.

## A worked outbound webhook

When an event Tale watches happens — a workflow execution finishes, an agent finishes a reply, a document write completes — Tale POSTs the event to your configured URL:

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

Verify the signature before trusting the body: HMAC-SHA256 over the raw body using the per-endpoint secret, hex-encoded. Compare in constant time. Reject any request older than five minutes by checking `X-Tale-Timestamp` against your clock.

## A worked inbound trigger

When your system needs to fire a Tale workflow, POST to the workflow's trigger URL:

```bash
curl -sS https://your-host.example.com/api/v1/workflows/triggers/<trigger-name> \
  -H "Authorization: Bearer $TALE_TRIGGER_KEY" \
  -H "Idempotency-Key: order-12345" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

The trigger key is a webhook-trigger-scoped API key minted alongside the trigger in the workflow editor. The body becomes the input of the workflow's first step. The response is JSON with an `executionId` you can quote when checking the run.

## Signing and verifying

Outbound: the per-endpoint signing secret is shown once when you add the endpoint under **Settings > Integrations** or in the workflow editor's webhook trigger panel. Tale signs every body with HMAC-SHA256 using that secret; verification is constant-time string compare.

Inbound: there is no signing — the bearer token is the auth. If you cannot keep the token secret, do not expose the trigger URL.

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

## Idempotency

Inbound: pass `Idempotency-Key` on every trigger call. Tale stores the key against the resulting execution for 24 hours; a retry with the same key returns the same execution ID without re-firing the workflow.

Outbound: every delivery carries a unique `X-Tale-Delivery` UUID. Use it to de-duplicate on your side — Tale retries on non-2xx responses, and the same delivery UUID will appear on every retry until the receiver acknowledges.

## Retries

Outbound retries follow exponential backoff with jitter, capped at 24 hours of attempts. The schedule is:

- Immediate retry on a 5xx or a timeout.
- 30 s, 1 m, 5 m, 30 m, 2 h, 8 h, 24 h after the first failure.
- After 24 h with no 2xx, the delivery is marked failed; the audit log records it.

Inbound retries are the caller's responsibility — Tale's response indicates success or failure of the trigger, not of the workflow's steps. If you want to retry, use a stable idempotency key.

## Where this fits

Webhooks are the seam between Tale and external systems on both sides. The [API reference](/develop/api-reference) covers the synchronous half — the endpoints you call when you want a value back immediately. The [Triggers reference](/platform/workflows/triggers) covers the workflow side of inbound webhooks — the configuration that turns a POST into a workflow run.
