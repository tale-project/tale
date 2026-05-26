---
title: Rate limits
description: REST API rate limits — default per-key budgets, per-org caps, the 429 response shape, and how to retry without making things worse.
---

Tale's REST API is rate-limited per key and per org. The defaults are sized for normal application traffic — bursts are fine, sustained hammering returns 429. When you hit a limit, the response carries the headers you need to back off cleanly; the wrong move (retry without delay, retry forever) only deepens the throttle.

Read this when you are wiring a client that calls the API on a schedule or under load. Come back when a previously healthy integration starts returning 429 — the answer is usually a missing backoff, not a missing capacity grant.

## A worked 429

The shortest useful interaction is a request that overruns its key budget. The server returns:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 12
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1717000060

{ "error": { "code": "rate_limited", "message": "Rate limit exceeded. Try again in 12 seconds." } }
```

`Retry-After` is the authoritative wait — sleep at least that long before the next attempt. `X-RateLimit-Reset` is the Unix timestamp at which the window refills. The body's `code` is `rate_limited`; clients should branch on the code, not parse the message.

## Default limits

| Surface                         | Budget                        | Bucket           |
| ------------------------------- | ----------------------------- | ---------------- |
| REST API (`/api/v1/*`)          | 120 requests / minute / key   | Token, burst 200 |
| OpenAI-compatible chat          | 30 requests / minute / key    | Token, burst 50  |
| OpenAI-compatible model listing | 120 requests / minute / key   | Token, burst 200 |
| Workflow trigger webhooks       | 60 requests / minute / key    | Token, burst 100 |
| Agent webhooks                  | 30 requests / minute / key    | Token, burst 50  |
| File upload                     | 50 requests / minute / member | Fixed window     |
| Email send                      | 100 messages / hour / org     | Token, burst 120 |

Token buckets allow a short burst above the rate — useful for batch imports — then settle to the sustained rate. Fixed windows refill at the minute boundary; a request at 14:59:59 and another at 15:00:00 both pass. Pick the buckets to match: a UI mounting once a minute reads as one token, not 60 over a window.

## Per-org caps

Tale Cloud applies a soft per-org cap on top of the per-key budgets, scaled to the org's plan. The cap protects against a runaway key by making sure one client cannot consume the org's entire budget. Self-hosted instances have no per-org cap by default — the per-key budgets above are the only floor.

When you need a higher per-key budget for a known workload on Cloud, ask support with the key name and the expected sustained rate. Capacity grants are per key, not per org.

## Retry strategy

The right strategy is exponential backoff with jitter, capped at the `Retry-After` value when present:

1. On 429, read `Retry-After` and sleep at least that long.
2. If `Retry-After` is absent (unusual), start at 1 s and double on each subsequent 429, capped at 60 s.
3. Add up to 25 % jitter so concurrent clients do not retry in lock-step.
4. Give up after the eighth attempt and surface the failure — the bucket is saturated and retrying further will not help.

Idempotency matters here: every write endpoint accepts an `Idempotency-Key` header. Set a stable key per logical operation so retries do not double-fire when the original request succeeded but the response was lost. See [API reference](/develop/api-reference) for the idempotency window.

## Where this fits

Rate limits are how Tale stays available when one client misbehaves. The [API reference](/develop/api-reference) names the 429 in the error model and points back here for the rules; the [Webhooks reference](/develop/webhooks) covers the matching retry policy on outbound deliveries. If your traffic is shaped wrong for the defaults and a support grant is not enough, the [Self-hosted](/self-hosted/overview) tab is the other answer — running the platform on your own infrastructure removes the Cloud-imposed caps.
