---
title: Trigger an automation via webhook
description: Add a webhook trigger to an automation and POST to its URL from an external system to start a run of the deployed version.
---

A webhook trigger turns an automation into something an external system can fire by POSTing JSON. Tale matches the token in the URL against the trigger, and the run it starts belongs to the automation's deployed version — never to a draft someone is still editing. This walk takes an automation from "I want to fire it from outside" to "an order event posts and the run appears" on a single instance.

You need a Developer role in the org, an automation with a deployed version, and a shell with `curl`. The full inbound contract — status codes, body handling, size limits — lives in [Webhooks](/develop/webhooks); this walk is the smallest end-to-end use of it.

## Before you begin

Confirm two things. The automation you will trigger has a **deployed** version — saving a version is not enough, and a version is only deployable once its own tests pass, so run them first. Your role is at least Developer; adding triggers is gated to Developer and above. If you have no automation yet, the canonical small one is "record the payload and stop" — build it through [Build a workflow with an approval](/tutorials/editor/workflow-with-approvals) and drop the approval node for this walk.

## Step 1 — Add a webhook trigger

The first move is binding a webhook trigger to the automation. Without one, the automation runs only from the UI or a schedule; with one, it gets a URL any system can POST to.

Open the automation's **Triggers** tab and add a webhook. Tale mints a URL with the credential embedded as a token in the path — there is no separate key and no Authorization header. The plaintext token is shown once and never stored, so copy it now; only its hash is kept, which is why nobody can recover the URL for you later.

The trigger binds to the automation's **name**, not to the version you deployed. Deploy a new version tomorrow and this URL keeps working — that is the whole point of separating the two.

```bash
export TALE_TRIGGER_URL="https://your-host.example.com/api/automations/webhook/<token>"
```

## Step 2 — POST a payload from curl

The webhook URL is an ordinary POST endpoint, and the body becomes the run's input. A body that is not JSON is handed through as text rather than refused, so a vendor that posts form-encoded data still reaches your first node.

```bash
curl -sS "$TALE_TRIGGER_URL" \
  -H "Content-Type: application/json" \
  -d '{ "orderId": "12345", "amount": 199.0 }'
```

An accepted call answers **202** with `{ "runId": "..." }`. The run is now executing asynchronously; open the automation's run list and you will see it with your payload as the input.

## Step 3 — Read the failure cases

Four responses cover everything the endpoint can say, and each one points at a different fix.

**404** means the token matches no enabled trigger — it is wrong, it was deleted, or the trigger is disabled. The response deliberately never says which, so a caller guessing tokens learns nothing from the difference. **409** with `{ "error": "automation has no deployed version" }` means the automation exists but nothing is live: deploy a version whose tests pass and the same call runs. **413** means the body is over 256 KB; post a reference instead of the payload. **202** is the only success.

Retries deserve one sentence of their own: the endpoint de-duplicates, so a retried POST does not start a second run. Send a delivery id — `Idempotency-Key`, or your vendor's own header such as `X-GitHub-Delivery` — and a repeat inside 24 hours answers with the run the first attempt started, flagged `duplicate: true`; without one, a byte-identical body within two minutes is treated the same way. Keep the id stable across attempts and a stalled request is safe to retry. The run itself checkpoints every completed node too, so a run resumed after an interruption never repeats a side effect it already produced.

## Where this fits

Webhook triggers are the inbound seam of the automation engine — what your CRM, your order system, or your monitoring tool POSTs into. Reach for one when the sentence is "this happened in our world, please run something about it"; reach for the [API reference](/develop/api-reference) when you want a synchronous answer instead. The trigger-side configuration, and the other three kinds that can start the same automation, live on [Workflow triggers](/platform/automations/triggers).
