---
title: Rate limits
description: REST and MCP rate limits — the buckets, the 429 response and its Retry-After, and how to retry without making things worse.
---

Tale limits API traffic per key holder. All keys belonging to the same person share a budget, so adding a key does not increase throughput. Design your client to handle bursts, wait after `429` responses and leave capacity for retries and other integrations.

Invalid keys are limited by source IP instead: 20 requests per minute, with a burst of 40. Webhook deliveries have separate sender and trigger budgets, listed below.

## The buckets

| Surface                                                                                                                           | Budget             | Burst |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----- |
| Reads and CRUD — every `/api/v1` endpoint not listed below, including `POST /api/v1/mcp`                                          | 120 requests / min | 200   |
| Starting work — project automation runs (`POST /api/v1/projects/{id}/automations/{name}/runs`), messages (`POST /api/v1/projects/{id}/threads/{threadId}/messages`) and tasks (`POST /api/v1/projects/{id}/tasks/{taskId}/start`), plus non-project automation runs and thread messages | 20 requests / min | 40 |
| The project upload flow — the upload handoff and file bind (`POST .../uploads` and `POST .../files`)                              | 240 requests / min | 300   |
| Inbound webhook deliveries (`POST /api/automations/webhook/{token}` and the project form) — per sender address, charged before the token is checked | 120 requests / min | 240 |
| The same deliveries, per verified trigger                                                                                          | 20 requests / min  | 40    |

The second bucket is deliberately small: each of those requests costs a whole durable run or a model turn, not a database read — and so is the per-trigger webhook bucket, for the same reason; the webhook door carries no key, so its budgets key on the sender's address and on the trigger the token names (the [Webhooks page](/develop/webhooks) has the door's own vocabulary). The third is deliberately roomy: one file costs at least two calls here — mint the handoff, bind the file — so the lane is budgeted for the whole choreography. Every request also counts against the general budget — it is the door — so a starting-work or upload POST draws from two lanes at once, and the tighter one governs; plan against it. A token bucket refills continuously — the burst capacity absorbs a batch, then the sustained rate applies. The starting-work bucket bounds how fast sends are **accepted**, not how many turns run at once: accepted thread messages join one queue shared by every organization and key holder on the deployment, worked oldest-first by the background worker in batches of up to five turns (the operator's `WORKER_CONCURRENCY`, default 5), and a new batch starts only when every turn of the running one has settled — a burst of N sends completes in waves, not in parallel.

Some writes also pass the same per-user or per-organization budgets as their in-app twins — a task comment, a folder change — and answer the same 429 beyond them.

## The 429

An overrun answers the API's ordinary error envelope, plus a `Retry-After` header naming the wait in whole seconds (rounded up):

```json
{ "error": "Too many requests — retry after 1500 ms", "code": "RATE_LIMITED", "requestId": "…", "data": { "retryAfterMs": 1500 } }
```

`code` is the value to branch on, as everywhere in the [error model](/develop/api-reference#error-model); `error` carries a sentence naming the wait, and `requestId` the id to quote when you report it — the in-app doors keep repeating the code in `error` for their own clients, so a 429 from `/api/app` reads differently. The body names the wait in milliseconds as `data.retryAfterMs`; the `Retry-After` header rounds it up to whole seconds. For example, `1500` milliseconds gives `Retry-After: 2`.

A poll that answers **304** (an unchanged `ETag`, see [caching](/develop/api-reference#caching-compression-and-partial-reads)) costs a request like any other — revalidation saves bytes, not budget — so size a polling interval by the budget: at one read a second a single key holder can watch two runs, at five seconds ten. Read only what you need (`?fields=status,finishedAt` on a run) so each request is small, and prefer a schedule to a tight loop.

Sleep at least `Retry-After` before the next attempt. There are no remaining-budget counters, so beyond that back off blind: start at one second, double per consecutive 429, cap at sixty, and add jitter so concurrent workers do not retry in lock-step. Because starting a run answers **202** before the work happens, a lost response is the ordinary case, not an edge: name the start with `Idempotency-Key` and retry it — the repeat answers the run the first attempt started, flagged `duplicate: true`, instead of starting a second one (the [API reference](/develop/api-reference#start-a-run-then-poll-it) has the rules).

## Where this fits

The [API reference](/develop/api-reference) names the 429 in the error model and points here. If your workload genuinely needs more than the budgets allow, batch on your side — `POST /api/v1/contacts/bulk` exists for exactly that — or spread the schedule; the buckets are per key holder, so splitting traffic across keys minted by the same user changes nothing — an integration that genuinely needs its own budget gets its own machine user.
