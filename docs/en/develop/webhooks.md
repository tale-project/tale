---
title: Webhooks
description: Inbound webhook triggers — POST to a token URL and a deployed automation runs. Token handling, rotation, idempotency, and the response codes.
---

A webhook trigger turns a POST from your system into a run of a deployed automation — no API key, no SDK, just a URL that Tale mints when you bind the trigger. It is the right seam when the caller is a third-party product (a payment provider, a form tool, a CI job) that can only fire an HTTP request at a URL you give it.

Read this when you are wiring an external system to start automations. For calls where you want a value back or you hold an API key, the [API reference](/develop/api-reference) is the synchronous half.

## A worked trigger

Bind a webhook trigger to an automation — in the automation's editor, or with `PUT /api/v1/automations/{name}/triggers` and `{"kind": "webhook"}` — and Tale answers with the trigger URL's token, once. Then any system can start a run:

```bash
curl -sS -X POST "https://your-host.example.com/api/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
# → 202 { "runId": "..." }
```

The body becomes the run's input. A body that is not JSON is handed through as text rather than refused — some vendors send plain text — and anything over 256 KB is rejected with **413**. Poll the run like any other via `GET /api/v1/runs/{runId}` with an API key, or watch it in the product.

The full response vocabulary:

- **202** `{ "runId": "..." }` — the run started.
- **404** — unknown, disabled, or mistyped token. The response never distinguishes the cases, so a guesser learns nothing.
- **409** `{ "error": "automation has no deployed version" }` — deploy a version whose tests pass and the same call runs.
- **413** — the body exceeds 256 KB.

## The token is the credential

There is no signature and no Authorization header: the token in the URL is the whole credential, so treat the URL like a password. Tale stores only a hash and compares in constant time; the plaintext exists exactly once, in the response that minted it.

Lost or leaked the URL? Rotate it — `PUT /api/v1/automations/{name}/triggers` with `{"kind": "webhook", "rotateToken": true}` mints a fresh token and answers it once; the old URL dies immediately. Unbinding the trigger (`DELETE .../triggers`, or in the editor) revokes it entirely; the automation's versions and run history stay.

## Idempotency and retries

The trigger endpoint does not de-duplicate: a retried POST starts a second run. What makes retries safe is the run itself — a live run checkpoints every completed node, so a run that resumes after an interruption never repeats a side effect it already produced. Where a _duplicate run_ would still be wrong, carry your own de-duplication key in the payload and branch on it in the automation's first node.

Retrying is the caller's responsibility: the response tells you whether the run _started_, not whether it succeeded. A sensible caller retries non-2xx responses with backoff and treats 202 as done.

## Where this fits

The webhook is the credential-less way in; everything else goes through an API key. The [Triggers page](/platform/automations/triggers) covers the product side — schedules, events, and webhooks as the automation editor presents them. The [API reference](/develop/api-reference) covers starting runs with a key (`POST /api/v1/automations/{name}/runs`), which is the better seam when the caller is your own code.
