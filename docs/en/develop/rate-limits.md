---
title: Rate limits
description: REST and MCP rate limits — the buckets, the 429 response and its Retry-After, and how to retry without making things worse.
---

The API is rate-limited per client IP with token buckets — before authentication, so the budget holds even against unauthenticated hammering: bursts pass, sustained hammering answers **429**. A worker fleet behind one NAT egress arrives as one IP and shares one budget. The budgets are sized so a normal connector never sees them — when a previously healthy client starts hitting 429, the answer is almost always a missing backoff or a hot loop, not missing capacity.

Read this when you are wiring a client that calls the API on a schedule or under load.

## The buckets

| Surface                                                                                                                           | Budget             | Burst |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----- |
| Reads and CRUD — every `/api/v1` endpoint not listed below, including `POST /api/v1/mcp`                                          | 120 requests / min | 200   |
| Starting work — `POST /api/v1/automations/{name}/runs`, `POST /api/v1/threads/{id}/messages`, and `POST /api/v1/tasks/{id}/start` | 20 requests / min  | 40    |
| The project upload flow — the upload handoff and file bind (`POST .../uploads` and `POST .../files`)                              | 240 requests / min | 300   |

The second bucket is deliberately small: each of those requests costs a whole durable run or a model turn, not a database read. The third is deliberately roomy: one file costs at least two calls here — mint the handoff, bind the file — so the lane is budgeted for the whole choreography. Every request also counts against the general budget — it is the door — so a starting-work or upload POST draws from two lanes at once, and the tighter one governs; plan against it. A folder create is a plain write, so it draws from the general budget alone. A token bucket refills continuously — the burst capacity absorbs a batch, then the sustained rate applies.

Some writes also pass the same per-user or per-organization budgets as their in-app twins — a task comment, a folder change — and answer the same 429 beyond them.

## The 429

An overrun answers the API's ordinary error envelope, plus a `Retry-After` header naming the wait in whole seconds (rounded up):

```json
{ "error": "Rate limit exceeded" }
```

Sleep at least `Retry-After` before the next attempt. There are no remaining-budget counters, so beyond that back off blind: start at one second, double per consecutive 429, cap at sixty, and add jitter so concurrent workers do not retry in lock-step. Because starting a run answers **202** before the work happens, a lost response is cheap to detect — list the automation's recent runs before firing again rather than retrying writes on suspicion.

## Where this fits

The [API reference](/develop/api-reference) names the 429 in the error model and points here. If your workload genuinely needs more than the budgets allow, batch on your side — `POST /api/v1/contacts/bulk` exists for exactly that — or spread the schedule; the buckets are per IP, so splitting traffic across keys changes nothing — a fleet shares its NAT egress's budget.
