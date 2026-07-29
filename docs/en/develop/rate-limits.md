---
title: Rate limits
description: REST and MCP rate limits — the two buckets, the 429 response, and how to retry without making things worse.
---

The API is rate-limited per key with token buckets: bursts pass, sustained hammering answers **429**. The budgets are sized so a normal connector never sees them — when a previously healthy client starts hitting 429, the answer is almost always a missing backoff or a hot loop, not missing capacity.

Read this when you are wiring a client that calls the API on a schedule or under load.

## The buckets

| Surface                                                                                         | Budget             | Burst |
| ----------------------------------------------------------------------------------------------- | ------------------ | ----- |
| Reads and CRUD — every `/api/v1` endpoint not listed below, including `POST /api/v1/mcp`        | 120 requests / min | 200   |
| Starting work — `POST /api/v1/automations/{name}/runs` and `POST /api/v1/threads/{id}/messages` | 20 requests / min  | 40    |

The second bucket is deliberately small: each of those requests costs a whole durable run or a model turn, not a database read. A token bucket refills continuously — the burst capacity absorbs a batch, then the sustained rate applies.

## The 429

An overrun answers the API's ordinary error envelope, with nothing to parse beyond the status:

```json
{ "error": "Rate limit exceeded" }
```

There are no rate-limit headers — no `Retry-After`, no remaining-budget counters. Back off blind: start at one second, double per consecutive 429, cap at sixty, and add jitter so concurrent workers do not retry in lock-step. Because starting a run answers **202** before the work happens, a lost response is cheap to detect — list the automation's recent runs before firing again rather than retrying writes on suspicion.

## Where this fits

The [API reference](/develop/api-reference) names the 429 in the error model and points here. If your workload genuinely needs more than the budgets allow, batch on your side — `POST /api/v1/contacts/bulk` exists for exactly that — or spread the schedule; the buckets are per key, so two keys do not share a budget.
