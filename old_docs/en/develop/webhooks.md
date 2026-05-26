---
title: Webhooks
description: Invoke workflows and agents from external systems via unique-token HTTP endpoints.
---

Tale exposes two inbound webhook surfaces: **workflow webhooks** (an external POST starts a workflow run) and **agent webhooks** (an external POST sends a message to an agent and gets the response). Both use a unique-token URL where the token is the credential — there's no separate HMAC signature, no shared secret to rotate, no signing code to write on the caller side. This page is the wire reference for both surfaces; for the worked end-to-end walkthrough, [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook) covers the workflow side.

The audience is integrators wiring an external system into Tale. The complement — Tale's outbound API, what your code calls — lives at [API reference](/develop/api-reference).

## Worked example — fire a workflow webhook

The smallest possible workflow trigger from cURL:

```bash
curl -X POST "https://your-tale-instance.com/api/workflows/wh/<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"customerId":"c-42","priority":"high","lines":3}'
```

The response returns immediately, before the workflow runs:

```json
{ "status": "accepted", "workflowSlug": "incoming-order-intake" }
```

The workflow runs asynchronously; the caller never blocks waiting for its output. Status and step-level results live in the workflow's **Executions** tab — see [Execution logs](/platform/automations/execution-logs).

## Workflow webhooks

Every workflow with a webhook trigger has a unique URL of the form:

```text
https://<your-tale-instance>/api/workflows/wh/<TOKEN>
```

The token is 64 hex characters, generated when you add the trigger in **Automations > <workflow> > Triggers**. It's the only credential — anyone holding the URL can post events at the workflow.

### POST /api/workflows/wh/{token}

Start a workflow run. The POST body becomes the workflow input, addressable as `{{ trigger.body }}` in every step.

| Name                | Type   | Required | Description                                                                                                           |
| ------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `Content-Type`      | string | Yes      | `application/json`. Other content types are rejected.                                                                 |
| `X-Idempotency-Key` | string | No       | Stable identifier for safe retries. Duplicate deliveries return the original execution instead of starting a new run. |
| _request body_      | object | Yes      | Arbitrary JSON. The whole body is passed to the workflow as input.                                                    |

**Response — first delivery:**

```json
{ "status": "accepted", "workflowSlug": "<workflow-slug>" }
```

**Response — duplicate delivery (same `X-Idempotency-Key`):**

```json
{ "status": "duplicate", "executionId": "<id>" }
```

The duplicate path returns the original execution's ID so the caller can look up the existing run instead of guessing whether the retry took.

### Status codes

| Code | Meaning                                                                |
| ---- | ---------------------------------------------------------------------- |
| 200  | Accepted (or duplicate). The body distinguishes the two cases.         |
| 400  | Invalid JSON payload, missing token, or invalid token format.          |
| 403  | Webhook is disabled, or the workflow is not published / not installed. |
| 404  | Token doesn't match any webhook.                                       |
| 429  | Per-IP rate limit exceeded.                                            |

## Agent webhooks

Every agent with an active webhook has a unique URL:

```text
https://<your-tale-instance>/api/agents/wh/<TOKEN>
```

Tokens follow the same 64-hex-character format as workflow tokens; create or revoke them on the agent's **Webhook** tab. The endpoint exposes two wire formats — a Tale-native legacy shape, and an OpenAI-compatible sub-path — so an existing OpenAI client can address an agent without rewriting the request.

### POST /api/agents/wh/{token} — Tale-native shape

Send a single user message to the agent. The response polls until the agent has finished generating, or streams Server-Sent Events when `stream: true`.

| Name       | Type    | Required | Description                                                                |
| ---------- | ------- | -------- | -------------------------------------------------------------------------- |
| `message`  | string  | Yes      | The user message. Plain text.                                              |
| `threadId` | string  | No       | Reuse an existing conversation thread. A new thread is created if omitted. |
| `stream`   | boolean | No       | Stream the response as SSE. Default `false`.                               |

The body can also be sent as `multipart/form-data` to attach a file alongside the message — fields are `message`, `threadId`, `stream`, and `file`.

**Response — non-streaming:**

```json
{
  "threadId": "<id>",
  "message": "<the agent's reply>",
  "status": "done"
}
```

### POST /api/agents/wh/{token}/chat/completions — OpenAI-compatible

The same agent is addressable as an OpenAI Chat Completions endpoint. The sub-path lets any OpenAI client talk to the agent without rewriting:

```bash
curl -X POST "https://<your-tale-instance>/api/agents/wh/<TOKEN>/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

The `model` field is optional — when present, Tale validates it against the agent's `supportedModels` and silently falls back to the agent's default when the requested model isn't allowed. The response shape matches OpenAI's `/v1/chat/completions`.

### Status codes (both shapes)

| Code | Meaning                                                                             |
| ---- | ----------------------------------------------------------------------------------- |
| 200  | Response delivered.                                                                 |
| 400  | Invalid body (missing `message`, malformed JSON, empty messages array).             |
| 401  | Invalid webhook token.                                                              |
| 403  | Webhook is disabled.                                                                |
| 404  | Token doesn't match any agent webhook.                                              |
| 429  | Per-IP rate limit exceeded.                                                         |
| 413  | Concatenated client `system` text exceeds 50 000 characters (OpenAI sub-path only). |
| 504  | Response timed out (the agent didn't finish within the 9-minute hard cap).          |

## Token rotation

There's no signature secret to rotate — the credential is the token itself. To rotate:

1. Open the workflow's **Triggers** panel or the agent's **Webhook** tab.
2. Click **Regenerate**. Tale mints a new token; the old one stops accepting requests immediately.
3. Update the caller's stored URL to the new token.

There's no overlap window: regeneration is instant, so caller updates should land in the same change window. For automated rotation flows, treat the token rotation as you would an API key rotation — keep both URLs valid for a brief window by adding a second trigger before retiring the old one.

## Retries and idempotency

For **workflow webhooks**, the caller is in charge of retries. Tale doesn't retry the inbound POST itself — the workflow's own step-level retries handle internal failures, but a non-2xx HTTP response is the caller's responsibility. Use `X-Idempotency-Key` to make caller-side retries safe.

For **agent webhooks**, the request is synchronous — the caller waits for the agent's response — and retrying repeats the model call. Set a sensible client-side timeout (long enough for a slow model, short enough that hung connections don't pile up) and avoid retrying on `200` responses.

## Trust boundary

What crosses the network in each direction:

- **From the caller to Tale**: the POST body and headers, including the token in the URL. HTTPS protects everything in transit; the token isn't sent as a header, so it stays out of standard `Authorization` log lines but appears in the URL of any access log the caller writes. Treat it accordingly.
- **From Tale to the caller**: the response body. Agent webhooks return the model's full reply; workflow webhooks return only `accepted` / `duplicate` plus the workflow slug or execution ID — not the workflow's output.
- **What Tale does with the payload**: the JSON body lands in the workflow's execution log or the agent's conversation history, governed by your org's retention and audit policies. There's no separate external persistence.

## Where this fits

Webhooks are the inbound complement to Tale's outbound API. The API is what your code calls when you drive the conversation; webhooks are what Tale exposes so an external system can drive a workflow or address an agent without sitting at the chat UI. Both surfaces share the same audit log, so a single observability setup covers everything Tale receives.

For the related pieces: [API reference](/develop/api-reference) is the outbound side of the same protocol family, [Triggers](/platform/automations/triggers) covers how a workflow opts into a webhook trigger, and the [agent Webhook tab](/platform/agents/create#webhook-tab) walks the per-agent setup.
