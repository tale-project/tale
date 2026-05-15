---
title: Trigger an automation via webhook
description: Wire an external system into a Tale workflow with a unique-token webhook.
---

Webhook triggers turn any external event — a form submission, an upstream system hook, a CI step, a Slack slash command — into a Tale workflow run. The external service POSTs JSON to a URL that includes a unique token; the token is the credential, and the workflow starts with that JSON as its input. This tutorial walks creating a minimal workflow, exposing its webhook, sending a request, and verifying delivery. Reference lives in [Webhooks](/develop/webhooks) and [Triggers](/platform/automations/triggers).

The outcome at the end is an externally callable workflow you can drive from any HTTPS client.

## Before you begin

You need a role that can create and publish workflows — Owner, Admin, or Developer all qualify. You also need a Tale instance reachable on HTTPS from wherever the external caller runs; for a local test the caller is your laptop, for production it's whichever upstream system is doing the POST. No external service account, no API key — the webhook token is its own credential.

## Step 1 — Create a workflow with a webhook trigger

Open **Automations** in the sidebar and click **Create workflow**. Give it a slug (`incoming-order-intake`) — slugs are URL-safe and permanent in practice, since the webhook URL embeds nothing else that identifies the workflow. Open the **Triggers** panel and add a **Webhook** trigger. Tale generates a unique URL of the form:

```text
https://<your-tale-instance>/api/workflows/wh/<TOKEN>
```

The token is 64 hex characters and is the only credential — anyone holding the URL can post events at the workflow. Treat it the way you'd treat an API key: store it in your caller's secret manager, never commit it.

The step worked when the trigger panel shows the URL and a "Copy" button next to it.

## Step 2 — Reference the payload in a step

The POST body becomes the workflow input, addressable as `{{ trigger.body }}` in every step. Add an **LLM** step after the trigger and reference the input in the prompt:

```text
Classify this order intake as urgent, normal, or follow-up.

Payload:
{{ trigger.body | json }}
```

The `| json` filter renders the whole body as a JSON string the model can read. The full filter and variable syntax lives in [Workflows](/platform/automations/workflows).

The step worked when the step's preview shows the prompt with the placeholder marker still visible (the body resolves at execution time, not preview time).

## Step 3 — Publish and call the webhook

Save the workflow and toggle **Publish** so the trigger is live; unpublished workflows reject webhook POSTs with `403`. Then call the URL from your caller:

```bash
curl -X POST "https://<your-tale-instance>/api/workflows/wh/<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"c-42","priority":"high","lines":3}'
```

The POST returns immediately with `200 OK` and a small body:

```json
{ "status": "accepted", "workflowSlug": "incoming-order-intake" }
```

The workflow itself runs asynchronously. Tale schedules the run on a background queue; the caller never blocks waiting for the workflow's output.

The step worked when the response status is `200` and the body matches the shape above.

## Step 4 — Verify the run

Open the workflow's **Executions** tab to see the run. Each row shows the trigger payload, every step's input and output, and the total wall-clock time. Filter by timestamp or status to find a specific run. This tab is the canonical debugging surface — when a step fails, its error message and stack trace are here, not in the HTTP response.

The step worked when the Executions tab shows a new row with the payload you sent and a green `succeeded` status.

## Step 5 — Add idempotency for safe retries

If your caller retries on its own — a flaky network, a CI step that runs twice, a Stripe webhook that delivers more than once — duplicate POSTs will trigger duplicate workflow runs. Send a stable `X-Idempotency-Key` header to make retries safe; Tale recognises the second delivery and returns the original execution without starting a new run.

```bash
curl -X POST "https://<your-tale-instance>/api/workflows/wh/<TOKEN>" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: order-2026-05-15-42" \
  -d '{"customerId":"c-42","priority":"high","lines":3}'
```

A duplicate delivery returns:

```json
{ "status": "duplicate", "executionId": "exec_..." }
```

Pick a key that is stable across retries and unique across distinct events — most callers use the upstream event's own ID.

The step worked when a second POST with the same key returns `status: "duplicate"` and no new row appears in **Executions**.

## Troubleshooting

- **404 Invalid webhook token** — the token in the URL is wrong, or the trigger was deleted and recreated (regeneration mints a new token). Re-copy the URL from the workflow's Triggers panel.
- **403 Webhook is disabled** — the trigger's toggle is off, or the workflow itself isn't published. Toggle both on in the workflow's Triggers panel.
- **400 Invalid JSON payload** — the request body isn't valid JSON, often because middleware on the caller side stripped quotes or sent a form-encoded body. Send raw JSON with `Content-Type: application/json`.
- **429 Rate limit exceeded** — the caller IP exceeded the per-IP webhook rate limit. Throttle the caller or shard across more workflows.

## Where this gets used

You now have an external system that can drive a Tale workflow: an HTTPS endpoint, a unique-token credential, an asynchronous run, and an Executions tab where every step is debuggable. The same shape — token-in-URL, immediate `202`-style response, async run — applies to any source you can wire up, from a Stripe webhook to a CI job to a Slack slash command, by changing only the caller.

If you need a direct agent reply rather than a workflow run, the same protocol applies to agent webhooks at [Webhooks — Agent webhooks](/develop/webhooks#agent-webhooks). For receiving outbound webhooks from Tale in your own service, [Webhooks](/develop/webhooks) covers the verification side.
