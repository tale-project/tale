---
title: Trigger an automation via webhook
description: Add a webhook trigger to an automation and POST to its URL from an external system to start a run of the deployed version.
---

A webhook trigger turns an automation into something an external system can fire by POSTing JSON. Tale matches the token in the URL against the trigger, and the run it starts belongs to the automation's deployed version — never to a draft someone is still editing. This walk takes an automation from "I want to fire it from outside" to "an order event posts and the run appears" on a single instance.

You need a Developer role in the org, an automation with a deployed version, and a shell with `curl`. The full inbound contract — status codes, body handling, size limits — lives in [Webhooks](/develop/webhooks); this walk is the smallest end-to-end use of it.

## Before you begin

Confirm two things. The automation you will trigger has a **deployed** version — saving a version is not enough, and a version is only deployable once its own tests pass, so run them first. Your role is at least Developer; adding triggers is gated to Developer and above. If you have no automation yet, the canonical small one is "record the payload and stop" — a single `transform` node, built on the canvas as [The workflow editor](/platform/automations/editor) describes.

For the project delivery below, choose an active project where this automation is installed. The project and trigger must belong to the same organization. The [API reference](/develop/api-reference) explains how to install an automation in a project.

## Step 1 — Add a webhook trigger

The first move is binding a webhook trigger to the automation. Without one, the automation runs only from the UI or a schedule; with one, it gets a URL any system can POST to.

Open the automation's detail page and find **Trigger** in the settings panel on the right; on a narrow screen, the panel sits below the canvas. Set **Trigger type** to **Webhook**, then click **Save settings**. Tale shows the token once. Copy it when it appears: the token in the URL authorizes deliveries, and Tale stores only its hash. From a script, the same bind is `PUT /api/v1/automations/{name}/triggers` with `{"kind": "webhook"}` — the **200** carries `token` exactly once; a later `{"kind": "webhook", "rotateToken": true}` mints a new one and kills the old URL, and binding a schedule or an event over it kills the URL too (the answer says `"revoked": "webhook"`).

The trigger binds to the automation's **name**, not to the version you deployed. Deploy a new version tomorrow and this URL keeps working — that is the whole point of separating the two.

Use the token just minted in the project URL below. The project comes from the URL, not the vendor body or a `projectId` query parameter. A non-project delivery uses `/api/automations/webhook/{token}` and requires an automation with no project bindings.

```bash
export TALE_TRIGGER_URL="https://your-host.example.com/api/projects/<projectId>/automations/webhook/<token>"
```

## Step 2 — POST a payload from curl

POST the vendor data to the project URL. The run receives `{ "trigger": "webhook", "payload": <body> }`, so the example's order ID is at `input.payload.orderId`. If the automation declares an `inputs` schema, it must describe this wrapper. Non-JSON bodies pass through as text.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

An accepted call answers **202** with `{ "runId": "..." }`. The run continues asynchronously in the named project. Poll `GET /api/v1/projects/{id}/runs/{runId}` with an API key that can read the project, or open the automation's run list in the product.

## Step 3 — Read the failure cases

Seven statuses cover this flow, and every refusal carries a stable `code` — branch on `code`, never on the sentence, which is written for a person and may change.

- **202** — the run started (`{ "runId": "..." }`), or this delivery was already accepted and the same `runId` comes back with `"duplicate": true`; no second run exists. This is the only success.
- **400** `INVALID_QUERY` — a `projectId` query parameter; the project comes from the URL path. **400** `AUTOMATION_INPUT_INVALID` — the body does not fit the automation's declared `inputs` schema; `data.issues` names each problem. Fix the request; no run started.
- **403** `AUTOMATION_PROJECT_FORBIDDEN` — the automation cannot run in the URL project: it does not exist, it is archived, or the automation is not installed there. One answer for all three, and it never names the automation, so a leaked URL cannot probe your project ids. Fix the URL or the installation; retrying changes nothing.
- **404** `NOT_FOUND` — the token matches no enabled trigger: it is wrong, it was deleted or revoked, or the trigger is disabled. The response deliberately never says which, so a caller guessing tokens learns nothing from the difference.
- **409** `AUTOMATION_NOT_DEPLOYED` — the automation exists but nothing is live: deploy a version whose tests pass and the same call runs. **409** `AUTOMATION_PROJECT_SCOPE_REQUIRED` — a project-bound automation was called through the global `/api/automations/webhook/{token}` URL; use its project URL. **409** `AUTOMATION_DELIVERY_SCOPE_MISMATCH` — this delivery id was first accepted through another URL scope.
- **413** `BODY_TOO_LARGE` — the body is over 256 KiB (262,144 bytes); post a reference instead of the payload.
- **429** `RATE_LIMITED` — the sender's or the trigger's budget is spent; wait the seconds `Retry-After` names and resend with the same delivery id, so the retry is the same delivery and not a second run.

Retries deserve one sentence of their own: the endpoint de-duplicates, so a retried POST does not start a second run. Send a delivery id — `Idempotency-Key`, or your vendor's own header such as `X-GitHub-Delivery` — and a repeat inside 24 hours answers with the run the first attempt started, flagged `duplicate: true`; without one, a byte-identical body within two minutes is treated the same way. Keep the id stable across attempts and a stalled request is safe to retry. The run itself checkpoints every completed node too, so a run resumed after an interruption never repeats a side effect it already produced. Delivery IDs and matching bodies are compared within the same project URL; a different installed project has its own deliveries. Removing the binding or archiving the project prevents further deliveries, including cached duplicate responses.

## Where this fits

Webhook triggers are the inbound seam of the automation engine — what your CRM, your order system, or your monitoring tool POSTs into. Reach for one when the sentence is "this happened in our world, please run something about it"; reach for the [API reference](/develop/api-reference) when you want a synchronous answer instead. The trigger-side configuration, and the other three kinds that can start the same automation, live on [Workflow triggers](/platform/automations/triggers).
