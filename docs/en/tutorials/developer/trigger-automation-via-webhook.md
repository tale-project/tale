---
title: Trigger an automation via webhook
description: Wire an external system into a Tale workflow with a signed webhook.
---

Webhook triggers turn any external event — a form submission, an upstream system hook, a CI/CD step — into a Tale automation run. The external service POSTs JSON to a URL you control; the workflow starts with that payload as its input. This tutorial walks through creating a minimal workflow, exposing its webhook, sending a signed request, and verifying delivery. Reference lives in [Webhooks](/develop/webhooks) and [Triggers](/platform/automations/triggers).

You need Developer access. A working Tale instance reachable on HTTPS from the external caller is enough — no other setup.

## Step 1 — Create a workflow with a webhook trigger

Open **Automations** in the sidebar and click **New workflow**. Give it a name (`incoming-order-intake`) and open the **Start** step. In **Triggers**, add a **Webhook trigger**. Tale generates a unique URL of the form:

```text
https://<your-tale-instance>/api/webhooks/workflow/<workflow-id>
```

Set a **Webhook secret** — any high-entropy string. This is the shared secret used to sign and verify requests. Store it in your caller's secret manager.

## Step 2 — Add one step that uses the payload

The webhook body becomes the workflow input. Add an **LLM** step after Start and reference the input in the prompt:

```text
Classify this order intake as urgent, normal, or follow-up:

{{ trigger.body | json }}
```

See [Workflows](/platform/automations/workflows) for the full step palette and variable syntax.

Save the workflow and toggle **Publish** so the webhook is live.

## Step 3 — Call the webhook from the outside

Tale signs every incoming request with HMAC-SHA-256 if a secret is set. The caller must do the same; Tale rejects unsigned or incorrectly signed requests.

```bash
BODY='{"customerId":"c-42","priority":"high","lines":3}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/.* //')"

curl -X POST "https://<your-tale-instance>/api/webhooks/workflow/<workflow-id>" \
  -H "Content-Type: application/json" \
  -H "X-Tale-Signature: $SIG" \
  -d "$BODY"
```

Response:

```json
{ "executionId": "exec_..." }
```

The POST returns immediately with an execution ID — the workflow itself runs asynchronously.

## Step 4 — Verify the run

Open the workflow and click the **Executions** tab. Filter by the execution ID or by timestamp; you will see the trigger payload, every step's input and output, and the total wall-clock time. This is where you debug failures. See [Execution logs](/platform/automations/execution-logs) for the full view.

## Step 5 — Add retries and idempotency (production hardening)

- **Retries:** Tale retries non-2xx responses with exponential backoff up to five attempts. If your caller retries on its own, make sure each retry sends the same body — otherwise the signature will not match.
- **Idempotency:** include a stable request ID in the body (`requestId`). Your first workflow step can branch on whether that ID has been seen before, so duplicate deliveries do not cause duplicate side effects.
- **Secret rotation:** change the webhook secret in the Tale UI, roll it through your caller's config, then redeploy the caller. Brief overlap is unavoidable; fail-open for a short window if that is acceptable.

## Troubleshooting

- **401 invalid signature** — the signed body is not identical byte-for-byte to what was sent (often due to JSON pretty-printing middleware).
- **404 workflow not found** — workflow was deleted or its ID changed; re-copy the URL from the Start step.
- **5xx** — check the workflow's Executions tab for a failing step. The HTTP response body contains the error summary.

## Where this fits

You now have an external system that can drive a Tale workflow: an HTTPS endpoint, a signed payload, an asynchronous run, and an executions tab where you can debug every step. The same shape — signed request, immediate execution ID, async run — applies to any source you can wire up, from a CI job to a form backend to a Slack slash command.

If you need a direct agent reply rather than a workflow run, the same protocol applies to [Webhooks — Agent webhooks](/develop/webhooks#agent-webhooks). For the signature-verification code you'd add to a custom receiver in Node or Python, [Webhooks](/develop/webhooks) has copy-paste samples.
