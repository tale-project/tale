---
title: Trigger a workflow via webhook
description: Mint a trigger key in a Tale workflow and POST to the trigger URL from an external system to start a run with idempotency.
---

A webhook trigger turns a Tale workflow into something an external system can fire by POSTing JSON. Tale verifies the bearer token, stores the idempotency key, kicks off a run, and returns an execution ID — the same shape any incoming webhook needs to be safe to retry. This walk takes a new workflow from "I want to fire it from outside" to "an order event posts and the workflow runs" on a single instance.

You need a Developer role in the org, an existing workflow (or use the empty starter), and a shell with `curl`. The full webhook contract — signing, idempotency, retries — lives in [Webhooks](/develop/webhooks); this walk is the smallest end-to-end use of the inbound side.

## Before you begin

Confirm two things. The workflow you will trigger exists and is published — drafts cannot be triggered. Your role is at least Developer — minting trigger keys is gated to Developer and above. If you do not have a workflow yet, the canonical small one is "log the payload to the execution record"; create it through [Workflow with approvals](/tutorials/editor/workflow-with-approvals) and remove the approval step for this walk.

## Step 1 — Add a webhook trigger to the workflow

The first move is binding a webhook trigger to the workflow. Without a trigger, the workflow is only callable from the UI; with one, it gets a URL plus a key.

Open the workflow editor, click the trigger node at the top, and pick **Webhook**. Give the trigger a name (`order-created`) — the URL Tale generates uses this name. Save. The right panel now shows two things you need: the **Trigger URL** and the **Trigger key**.

Tale shows the trigger key once, like any other API key. Copy it; you will not see it again.

```bash
export TALE_TRIGGER_KEY="tk_trigger_..."
export TALE_TRIGGER_URL="https://your-host.example.com/api/v1/workflows/triggers/order-created"
```

## Step 2 — POST a payload from curl

A trigger URL is a normal POST endpoint. The body becomes the input of the workflow's first step; the response carries the execution ID so the caller can correlate runs.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Authorization: Bearer $TALE_TRIGGER_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

A 200 returns `{ "executionId": "exe_..." }`. The workflow is now running asynchronously; open the workflow's **Executions** tab and you should see a run in progress with your payload as the trigger input.

A 401 means the key is wrong; a 404 means the trigger name in the URL does not match a published workflow; a 422 means the workflow is archived or the trigger is disabled.

## Step 3 — Make retries safe with idempotency

External systems retry on timeouts and 5xx errors; without idempotency, a retry double-fires the workflow. The `Idempotency-Key` header from Step 2 is the fix: Tale stores the key for 24 hours and returns the original execution on every retry with the same key.

Test it by re-running the same curl above. The response carries the same `executionId` as the first call, and the workflow's **Executions** tab still shows one run. Change the key to `order-12346` and curl again — that one fires a second run.

The source system must use a stable, deterministic key per logical event. A common pattern is `<event-type>-<event-id>`; never use a random UUID generated at retry time, since each retry would mint a new run.

## Where this fits

Webhook triggers are the inbound half of Tale's workflow API — the seam your CRM, your order system, or your monitoring tool POSTs into. Use them for "this happened in our world, please run a Tale workflow about it"; reach for the [API reference](/develop/api-reference) when you want a synchronous reply instead.

For the outbound half — Tale POSTing to your URL when a Tale event happens — and for the full signing and retry contract, see [Webhooks](/develop/webhooks). The workflow-side configuration of the trigger lives on the [Workflow concepts](/platform/workflows/concepts) page.
