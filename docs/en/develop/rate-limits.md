---
title: Rate limits
description: REST and MCP rate limits — the buckets, the 429 response and its Retry-After, and how to retry without making things worse.
---

The API is rate-limited with token buckets keyed on the key holder — the user your API key acts as — so a budget always belongs to an identifiable caller and no network header can mint a fresh one: bursts pass, sustained hammering answers **429**. Every key a user mints draws from that user's budget; a worker fleet that needs a budget of its own gets a machine user of its own. A key that fails to authenticate is throttled per source IP instead (20 requests a minute, burst 40), so strangers never draw from a key holder's budget, and a request without a key costs nothing at all. The budgets are sized so a normal connector never sees them — when a previously healthy client starts hitting 429, the answer is almost always a missing backoff or a hot loop, not missing capacity.

Read this when you are wiring a client that calls the API on a schedule or under load.

## The buckets

| Surface                                                                                                                           | Budget             | Burst |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----- |
| Reads and CRUD — every `/api/v1` endpoint not listed below, including `POST /api/v1/mcp`                                          | 120 requests / min | 200   |
| Starting work — project automation runs (`POST /api/v1/projects/{id}/automations/{name}/runs`), messages (`POST /api/v1/projects/{id}/threads/{threadId}/messages`) and tasks (`POST /api/v1/projects/{id}/tasks/{taskId}/start`), plus non-project automation runs and thread messages | 20 requests / min | 40 |
| The project upload flow — the upload handoff and file bind (`POST .../uploads` and `POST .../files`)                              | 240 requests / min | 300   |
| Inbound webhook deliveries (`POST /api/automations/webhook/{token}` and the project form) — per sender address, charged before the token is checked | 120 requests / min | 240 |
| The same deliveries, per verified trigger                                                                                          | 20 requests / min  | 40    |

The second bucket is deliberately small: each of those requests costs a whole durable run or a model turn, not a database read — and so is the per-trigger webhook bucket, for the same reason; the webhook door carries no key, so its budgets key on the sender's address and on the trigger the token names (the [Webhooks page](/develop/webhooks) has the door's own vocabulary). The third is deliberately roomy: one file costs at least two calls here — mint the handoff, bind the file — so the lane is budgeted for the whole choreography. Every request also counts against the general budget — it is the door — so a starting-work or upload POST draws from two lanes at once, and the tighter one governs; plan against it. A token bucket refills continuously — the burst capacity absorbs a batch, then the sustained rate applies.

Some writes also pass the same per-user or per-organization budgets as their in-app twins — a task comment, a folder change — and answer the same 429 beyond them.

## The 429

An overrun answers the API's ordinary error envelope, plus a `Retry-After` header naming the wait in whole seconds (rounded up):

```json
{ "error": "RATE_LIMITED", "code": "RATE_LIMITED", "data": { "retryAfterMs": 1500 } }
```

`code` is the value to branch on, as everywhere in the [error model](/develop/api-reference#error-model); on this one refusal `error` repeats it instead of carrying a sentence, because the same 429 serves the in-app doors, whose clients read `error`. The body names the wait in milliseconds as `data.retryAfterMs`; the `Retry-After` header rounds it up to whole seconds. For example, `1500` milliseconds gives `Retry-After: 2`.

Sleep at least `Retry-After` before the next attempt. There are no remaining-budget counters, so beyond that back off blind: start at one second, double per consecutive 429, cap at sixty, and add jitter so concurrent workers do not retry in lock-step. Because starting a run answers **202** before the work happens, a lost response is the ordinary case, not an edge: name the start with `Idempotency-Key` and retry it — the repeat answers the run the first attempt started, flagged `duplicate: true`, instead of starting a second one (the [API reference](/develop/api-reference#start-a-run-then-poll-it) has the rules).

## Where this fits

The [API reference](/develop/api-reference) names the 429 in the error model and points here. If your workload genuinely needs more than the budgets allow, batch on your side — `POST /api/v1/contacts/bulk` exists for exactly that — or spread the schedule; the buckets are per key holder, so splitting traffic across keys minted by the same user changes nothing — an integration that genuinely needs its own budget gets its own machine user.
