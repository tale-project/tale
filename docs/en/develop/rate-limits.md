---
title: Handle rate limits
description: Plan REST, MCP and webhook traffic, interpret Retry-After and retry accepted work without duplicating it.
---

Tale limits API traffic by the key holder. All API keys belonging to the same person share that person’s budget. Account for every integration and polling worker using that identity, rather than budgeting each key independently.

The limits below describe the current backend. An operator’s proxy or a downstream provider may impose additional limits.

## The buckets

A token bucket refills continuously up to its burst capacity. A short batch can use that capacity, but sustained traffic must stay within the refill rate.

| Traffic | Sustained rate | Burst | Budget owner |
| --- | --- | --- | --- |
| General `/api/v1` traffic, including MCP | 120/minute | 200 | Key holder |
| Run starts, model-message sends and task starts | 20/minute | 40 | Key holder |
| Project upload handoff and file binding | 240/minute | 300 | Key holder |
| Failed API-key authentication | 20/minute | 40 | Source IP |
| Webhook deliveries before token validation | 120/minute | 240 | Sender address |
| Deliveries to a verified webhook trigger | 20/minute | 40 | Trigger |

REST execution and upload requests also consume the general budget. For example, a project file needs an upload-handoff request and a file-bind request; each counts against both the general and upload budgets. The larger upload bucket does not allow a user to bypass the general limit.

Execution includes project and non-project automation starts, thread-message sends and explicit task starts. Task intake also consumes the execution budget when `runWorkflowSlug` is supplied. A starting-work request is charged once its body and headers have passed the endpoint's own checks — a `400 INVALID_BODY` or `INVALID_HEADER` spends nothing — and before anything is looked up, so a `404` for a thread, task or automation you cannot see costs a token, as does a `409` the state answers. Some mutations, such as task comments and folder changes, have additional domain budgets shared with the app.

MCP batches have their own accounting: additional tool calls consume additional request budget. See [MCP endpoint](/develop/mcp-endpoint) for the difference between an HTTP `429` and a refused message inside a batch. Webhook budgets are separate from API-key traffic; both sender and trigger limits must allow a delivery.

The execution bucket limits how quickly messages are accepted, not how many turns run at once. Accepted chat messages share a deployment-wide queue across organizations and keys. Each worker batch runs up to `WORKER_CONCURRENCY` turns, 5 by default; the next batch waits for the current one to settle. A successful send can therefore wait behind other clients’ work. Queue position and estimated start time are not exposed.

## The 429

An HTTP limit refusal includes `Retry-After` in whole seconds. The JSON body provides the same wait in milliseconds. This illustrative response means wait at least two seconds:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 2
Content-Type: application/json

{
  "error": "Too many requests — retry after 1500 ms",
  "code": "RATE_LIMITED",
  "requestId": "example-request-id",
  "data": {"retryAfterMs": 1500}
}
```

Branch on `code`; `error` is a sentence describing the wait, and `requestId` identifies the request for investigation. This is the REST response format. The app’s `/api/app` and webhook limit responses keep the machine code in `error`, so do not parse that text across surfaces. Tale does not expose remaining-budget counters: track your traffic and honor the server’s wait instruction.

1. Stop the worker’s immediate retry loop.
2. Wait at least `Retry-After`. If multiple workers share the identity, coordinate their pause.
3. Retry with a bounded exponential delay and jitter when refusals continue. For example, grow a delay from one second up to sixty seconds, always honoring a longer server-provided wait.
4. Preserve the original idempotency key for operations that support one. A timeout after a run start may mean the run was already accepted.

A spending cap answers `429` too, with `code` `BUDGET_EXCEEDED`: a budget rule that applies to the key holder — their own, a team’s, the organization’s, or the API key’s — has been reached. A short wait does not help. `Retry-After` names the time until the cap’s period resets, and `data` names the cap: `scope`, `period`, `limitCode`, `used`, `limit`, and `resetsAt` in epoch milliseconds. Nothing is queued; pause the work until `resetsAt`, or ask an administrator to raise the limit under [Policies & Limits](/platform/admin/governance/policies-and-limits).

Other `4xx` responses usually need a corrected request, credential or permission. Do not treat every failure as a rate limit; use the [error model](/develop/api-reference#error-model).

## Plan polling and retries

An `ETag` response of `304` still costs a request. It saves response bytes, not budget. Polling one run every five seconds consumes twelve reads per minute before any retries or other work. Leave capacity for those other calls instead of filling the entire budget with polls.

Request only the fields you need, such as `?fields=status,finishedAt` on a run. Slow down when a run is waiting for a human, and stop polling terminal runs. Follow [Start a run, then poll it](/develop/api-reference#start-a-run-then-poll-it) for states and idempotent starts.

For larger imports, use supported batch operations such as `POST /api/v1/contacts/bulk`, and spread batches over time. Creating more keys for the same user does not increase the budget. If a workflow needs its own service identity, provision that identity through your normal account and permission process; do not use key rotation as a retry strategy.
