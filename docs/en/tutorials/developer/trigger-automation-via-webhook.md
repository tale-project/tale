---
title: Trigger a workflow via webhook
description: Add a webhook to a Tale workflow and POST to its URL from an external system to start a run with idempotency.
---

A webhook trigger turns a Tale workflow into something an external system can fire by POSTing JSON. Tale recognizes the token in the URL, stores the idempotency key, and kicks off a run — the same shape any incoming webhook needs to be safe to retry. This walk takes a new workflow from "I want to fire it from outside" to "an order event posts and the workflow runs" on a single instance.

You need a Developer role in the org, an existing workflow (or use the empty starter), and a shell with `curl`. The full webhook contract — signing, idempotency, retries — lives in [Webhooks](/develop/webhooks); this walk is the smallest end-to-end use of the inbound side.

## Before you begin

Confirm two things. The workflow you will trigger exists and is published — drafts cannot be triggered. Your role is at least Developer — adding webhook triggers is gated to Developer and above. If you do not have a workflow yet, the canonical small one is "log the payload to the execution record"; create it through [Workflow with approvals](/tutorials/editor/workflow-with-approvals) and remove the approval step for this walk.

## Step 1 — Add a webhook trigger to the workflow

The first move is binding a webhook trigger to the workflow. Without a trigger, the workflow is only callable from the UI; with one, it gets a URL any system can POST to.

Open the workflow's **Triggers** tab and click **Add webhook**. Tale mints a unique **Webhook URL** with the credential embedded as a token in the path — there is no separate key or Authorization header.

Save the URL when it is shown: anyone holding it can fire the workflow, so treat the whole URL as a secret. Deleting the webhook revokes it.

```bash
export TALE_TRIGGER_URL="https://your-host.example.com/api/workflows/wh/<token>"
```

## Step 2 — POST a payload from curl

The webhook URL is a normal POST endpoint. The body becomes the input of the workflow's first step; an `Idempotency-Key` header makes retries safe — a replay returns the earlier run instead of starting a new one.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-12345" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

A 200 returns `{ "status": "accepted", "workflowSlug": "..." }`. The workflow is now running asynchronously; open the workflow's **Executions** tab and you should see a run in progress with your payload as the trigger input.

A 404 means the token in the URL matches no webhook; a 403 means the webhook is disabled or the workflow is no longer installed; a 429 means the caller's IP hit the rate limit.

## Step 3 — Make retries safe with idempotency

External systems retry on timeouts and 5xx errors; without idempotency, a retry double-fires the workflow. The `Idempotency-Key` header from Step 2 is the fix: Tale remembers the key per organization and answers a retry with `{ "status": "duplicate", "executionId": "..." }` — the original run — instead of firing again.

Test it by re-running the same curl above. The response carries the first call's `executionId`, and the workflow's **Executions** tab still shows one run. Change the key to `order-12346` and curl again — that one fires a second run.

The source system must use a stable, deterministic key per logical event. A common pattern is `<event-type>-<event-id>`; never use a random UUID generated at retry time, since each retry would mint a new run.

## Where this fits

Webhook triggers are the inbound half of Tale's workflow API — the seam your CRM, your order system, or your monitoring tool POSTs into. Use them for "this happened in our world, please run a Tale workflow about it"; reach for the [API reference](/develop/api-reference) when you want a synchronous reply instead.

For the outbound half — Tale POSTing to your URL when a Tale event happens — and for the full signing and retry contract, see [Webhooks](/develop/webhooks). The workflow-side configuration of the trigger lives on the [Workflow triggers](/platform/automations/triggers) page.
