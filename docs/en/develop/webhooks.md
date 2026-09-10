---
title: Webhooks
description: Inbound webhook triggers — POST to a token URL and a deployed automation runs. Token handling, rotation, idempotency, and the response codes.
---

A webhook trigger turns a POST from your system into a run of a deployed automation — no API key, no SDK, just a URL that Tale mints when you bind the trigger. It is the right seam when the caller is a third-party product (a payment provider, a form tool, a CI job) that can only fire an HTTP request at a URL you give it.

Read this when you are wiring an external system to start automations. For calls where you want a value back or you hold an API key, the [API reference](/develop/api-reference) is the synchronous half.

## A worked trigger

Bind a webhook trigger to an automation — in the automation's editor, or with `PUT /api/v1/automations/{name}/triggers` and `{"kind": "webhook"}` — and Tale answers with the trigger URL's token, once. Then any system can start a run:

Choose the URL for the work you intend to start. For a project run, use `/api/projects/{id}/automations/webhook/{token}` as in this example. The automation must be installed in that active project, and project and token must belong to the same organization. The token authorizes the call; it cannot select an unbound project. For a non-project run, use `/api/automations/webhook/{token}` with an automation that has no project bindings. A bound automation refuses that global URL with **400**. The `projectId` query parameter is refused with **400** on either URL. The vendor body is passed to the automation as data; it does not select the project.

```bash
curl -sS -X POST "https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
# → 202 { "runId": "..." }
```

The run receives `{ "trigger": "webhook", "payload": <body> }`. Read the example’s order id as `input.payload.orderId`; a declared `inputs` schema describes this wrapper. A body that is not JSON is handed through as text rather than refused — some vendors send plain text — and anything over 256 KB is rejected with **413** — the cap is counted in bytes as the body arrives, so an oversized delivery is refused rather than buffered. Poll the run like any other via `GET /api/v1/projects/{id}/runs/{runId}` with an API key, or watch it in the product. Poll a non-project delivery at `GET /api/v1/runs/{runId}` instead; a project delivery always uses its project URL and the API key holder must be able to read that project.

The full response vocabulary:

- **202** `{ "runId": "..." }` — the run started.
- **202** `{ "runId": "...", "duplicate": true }` — a redelivery of a delivery already accepted; `runId` is the run the first one started, and no second run exists.
- **400** — invalid project scope, an archived or unbound project, a bound automation called through the global URL, a `projectId` query parameter, or input that does not match the automation's `inputs` schema; no run starts.
- **404** — unknown, disabled, or mistyped token. The response never distinguishes the cases, so a guesser learns nothing.
- **409** `{ "error": "automation has no deployed version" }` — deploy a version whose tests pass and the same call runs.
- **413** — the body exceeds 256 KB.

## The token is the credential

There is no signature and no Authorization header: the token in the URL is the whole credential, so treat the URL like a password. Tale stores only a hash and compares in constant time; the plaintext exists exactly once, in the response that minted it.

Lost or leaked the URL? Rotate it — `PUT /api/v1/automations/{name}/triggers` with `{"kind": "webhook", "rotateToken": true}` mints a fresh token and answers it once; the old URL dies immediately. Unbinding the trigger (`DELETE .../triggers`, or in the editor) revokes it entirely; the automation's versions and run history stay.

## Idempotency and retries

The endpoint de-duplicates deliveries because vendors may deliver more than once. Deduplication is scoped to the trigger and the project in its URL: the same delivery ID can start one run in each installed project. Tale checks the current project binding and active state before returning a cached duplicate. Two things identify a delivery:

- **A delivery id you send.** The first of these headers present wins: `Idempotency-Key`, `X-Idempotency-Key`, the Standard Webhooks `webhook-id`, `X-GitHub-Delivery`, `X-Gitlab-Event-UUID`, `X-Shopify-Webhook-Id`, `Linear-Delivery`, `X-Atlassian-Webhook-Identifier`, `X-Request-UUID` (Bitbucket), `I-Twilio-Idempotency-Token`, `X-Webhook-Id`. A repeat with the same id inside 24 hours answers **202** with the original run and `"duplicate": true` — whatever its body says.
- **The body itself.** Without an ID header, a byte-identical body posted to the same URL within two minutes is the same delivery. After two minutes it is a new one, so a heartbeat that posts the same body every few minutes keeps running.

```bash
curl -sS -X POST "https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345-paid" \
  -d '{ "orderId": "12345", "status": "paid" }'
# → 202 { "runId": "run_a" }
# the same request again, however many times, for the next 24 hours:
# → 202 { "runId": "run_a", "duplicate": true }
```

That makes retrying safe from your side: retry timeouts and non-2xx responses with backoff, keep the delivery id stable across attempts, and treat any **202** as accepted — `duplicate: true` tells you the earlier attempt had already landed. The response says whether the run _started_, not whether it succeeded; follow the run with `GET /api/v1/projects/{id}/runs/{runId}`. A **409** is not remembered: deploy a version and send the delivery again.

## Where this fits

The webhook is the credential-less way in; everything else goes through an API key. The [Triggers page](/platform/automations/triggers) covers the product side — schedules, events, and webhooks as the automation editor presents them. The [API reference](/develop/api-reference) covers starting runs with a key (`POST /api/v1/projects/{id}/automations/{name}/runs`), which is the better seam when the caller is your own code.
