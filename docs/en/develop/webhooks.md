---
title: Webhooks
description: Inbound webhook triggers — POST to a token URL and a deployed automation runs. Token handling, rotation, idempotency, and the response codes.
---

A webhook trigger turns a POST from your system into a run of a deployed automation — no API key, no SDK, just a URL that Tale mints when you bind the trigger. It is the right seam when the caller is a third-party product (a payment provider, a form tool, a CI job) that can only fire an HTTP request at a URL you give it.

Read this when you are wiring an external system to start automations. For calls where you want a value back or you hold an API key, the [API reference](/develop/api-reference) is the synchronous half.

## A worked trigger

Bind a webhook trigger to an automation — in the automation's editor, or with `PUT /api/v1/automations/{name}/triggers` and `{"kind": "webhook"}` — and Tale answers with the trigger URL's token, once. Then any system can start a run:

Choose the URL for the work you intend to start. For a project run, use `/api/projects/{id}/automations/webhook/{token}` as in this example. The automation must be installed in that active project, and project and token must belong to the same organization. The token authorizes the call; it cannot select an unbound project. For a non-project run, use `/api/automations/webhook/{token}` with an automation that has no project bindings. A bound automation refuses that global URL with **409** `AUTOMATION_PROJECT_SCOPE_REQUIRED`. The `projectId` query parameter is refused with **400** on either URL. The vendor body is passed to the automation as data; it does not select the project.

```bash
curl -sS -X POST "https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
# → 202 { "runId": "..." }
```

The run receives `{ "trigger": "webhook", "payload": <body> }`. Read the example’s order id as `input.payload.orderId`; a declared `inputs` schema describes this wrapper. A body that is not JSON is handed through as text rather than refused — some vendors send plain text — and anything over 256 KiB (262,144 bytes) is rejected with **413** — the cap is counted in bytes as the body arrives, so an oversized delivery is refused rather than buffered. Poll the run like any other via `GET /api/v1/projects/{id}/runs/{runId}` with an API key, or watch it in the product. Poll a non-project delivery at `GET /api/v1/runs/{runId}` instead; a project delivery always uses its project URL and the API key holder must be able to read that project.

The full response vocabulary:

- **202** `{ "runId": "..." }` — the run started.
- **202** `{ "runId": "...", "duplicate": true }` — a redelivery of a delivery already accepted; `runId` is the run the first one started, and no second run exists.
- **400** — a `projectId` query parameter (`INVALID_QUERY`), or input that does not match the automation's `inputs` schema (`AUTOMATION_INPUT_INVALID`, every problem under `data.issues`); no run starts.
- **403** `AUTOMATION_PROJECT_FORBIDDEN` — the automation cannot run in the URL project: it does not exist, it is archived, or the automation is not installed there. The response never says which and never names the automation, so a leaked URL is not an oracle for the organization's project ids.
- **404** — unknown, disabled, or mistyped token. The response never distinguishes the cases, so a guesser learns nothing.
- **409** — `AUTOMATION_NOT_DEPLOYED` (deploy a version whose tests pass and the same call runs), `AUTOMATION_PROJECT_SCOPE_REQUIRED` (a bound automation called through the global URL — use its project URL), or `AUTOMATION_DELIVERY_SCOPE_MISMATCH` (this delivery id was first accepted through another URL scope).
- **413** — the body exceeds 256 KiB (262,144 bytes).
- **429** — the sender's or the trigger's budget is spent; `Retry-After` names the wait. The budgets are below.

## The token is the credential

There is no signature and no Authorization header: the token in the URL is the whole credential, so treat the URL like a password. Tale stores only a hash and compares in constant time; the plaintext exists exactly once, in the response that minted it.

Lost or leaked the URL? Rotate it — `PUT /api/v1/automations/{name}/triggers` with `{"kind": "webhook", "rotateToken": true}` mints a fresh token and answers it once; the old URL dies immediately. Unbinding the trigger (`DELETE .../triggers`, or in the editor) revokes it entirely; the automation's versions and run history stay. Binding another kind over it does the same: a `PUT` of `{"kind": "schedule", ...}` on an automation that carries a live webhook answers **200** with `"revoked": "webhook"` beside the name, the old URL answers 404 from that moment, and binding `webhook` again later mints a different token — so read `revoked` on every bind you script, and never rebind to another kind while a partner still posts to the URL. Disabling the trigger (`"enabled": false`, or the switch in the editor) only suspends the URL: it answers the same **404** as a token that never existed, but the token is dormant, not dead — re-enabling it, including a later `PUT` that merely omits `enabled`, brings the same URL back to life. After a leak, rotate or unbind; never rely on the switch.

## Idempotency and retries

The endpoint de-duplicates deliveries because vendors may deliver more than once. Deduplication is scoped to the trigger and the project in its URL: the same delivery ID can start one run in each installed project. Tale checks the current project binding and active state before returning a cached duplicate. Two things identify a delivery:

- **A delivery id you send.** The first of these headers present wins: `Idempotency-Key`, `X-Idempotency-Key`, the Standard Webhooks `webhook-id`, `X-GitHub-Delivery`, `X-Gitlab-Event-UUID`, `X-Shopify-Webhook-Id`, `Linear-Delivery`, `X-Atlassian-Webhook-Identifier`, `X-Request-UUID` (Bitbucket), `I-Twilio-Idempotency-Token`, `X-Webhook-Id`. The id is matched by value, whichever of these headers carried it — a gateway that re-stamps a vendor's delivery id under `Idempotency-Key` is the same delivery, not a second one. A repeat with the same id inside 24 hours answers **202** with the original run and `"duplicate": true` — whatever its body says.
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

## Budgets

Nothing authenticates a sender, so the door is budgeted twice. Each sender address — as the deployment's trusted proxies report it — gets 120 deliveries a minute with a burst of 240, charged before the token is even checked, so a flood of guessed URLs costs the door nothing past that. Each verified trigger gets 20 deliveries a minute with a burst of 40: a delivery costs a whole durable run, the same price a key-authenticated start pays. Beyond either, the door answers **429** with `Retry-After` in whole seconds and the usual error envelope; back off as the [Rate limits](/develop/rate-limits) page describes, keep the delivery id stable across attempts, and the retry reads as the duplicate it is rather than a second run.

## Where this fits

The webhook is the credential-less way in; everything else goes through an API key. The [Triggers page](/platform/automations/triggers) covers the product side — schedules, events, and webhooks as the automation editor presents them. The [API reference](/develop/api-reference) covers starting runs with a key (`POST /api/v1/projects/{id}/automations/{name}/runs`), which is the better seam when the caller is your own code — it honours the same `Idempotency-Key` idea, so a retried start there is as safe as a redelivery here.
