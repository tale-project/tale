---
title: Webhooks
description: Inbound webhook triggers — POST to a token URL and a deployed automation runs. Token handling, rotation, idempotency, and the response codes.
---

A webhook URL lets an external system start a deployed automation by sending an HTTP POST. Use it for events from a service that can call a configured URL, such as an order notification or form submission. The secret token in the URL authorizes the delivery.

The response confirms acceptance and supplies a run ID; it does not return the automation’s completed result. Both webhook and API-key run starts are asynchronous. For a first delivery, follow [the webhook tutorial](/tutorials/developer/trigger-automation-via-webhook).

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
- **404** — unknown, disabled, or mistyped token. The response never distinguishes the cases, so a guesser learns nothing. The door takes `POST` only: `GET`, `HEAD` and `OPTIONS` answer the same **404** — never a 405 and never an `Allow` header — so the verb is not an oracle either.
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

Retry network failures and temporary **5xx** responses with bounded exponential backoff. For **429**, wait at least `Retry-After`. Keep the delivery ID unchanged so a lost response cannot create a second run within the deduplication window. Fix the cause of **4xx** responses before retrying: for example, `AUTOMATION_NOT_DEPLOYED` needs a deployed version, while `AUTOMATION_PROJECT_SCOPE_REQUIRED` needs the project URL. Any **202** means accepted; poll the returned run to learn whether it succeeded. Deduplication prevents a second run for the same delivery within its window; it does not guarantee that an external system applies every side effect exactly once.

## Budgets

Nothing authenticates a sender, so the door is budgeted twice. Each sender address — as the deployment's trusted proxies report it — gets 120 deliveries a minute with a burst of 240, charged before the token is even checked, so a flood of guessed URLs costs the door nothing past that. Each verified trigger gets 20 deliveries a minute with a burst of 40: a delivery costs a whole durable run, the same price a key-authenticated start pays. Beyond either, the door answers **429** with `Retry-After` in whole seconds and the usual error envelope; back off as the [Rate limits](/develop/rate-limits) page describes, keep the delivery id stable across attempts, and the retry reads as the duplicate it is rather than a second run.

## Choose webhook or API key

Use a webhook when the sender supports a fixed event URL. Use an API key when your own client also needs to discover automations, choose projects or read results. Keep either credential private. [Triggers](/platform/automations/triggers) covers setup in the product; the [API reference](/develop/api-reference) documents authenticated run starts and polling.
