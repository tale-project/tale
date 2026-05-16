---
title: Call Tale from a script
description: Send a chat request from cURL and Python using Tale's OpenAI-compatible API.
---

Tale's public API is OpenAI-compatible — any SDK that talks to `/chat/completions` talks to Tale by changing two values: the base URL and the API key. This tutorial walks a minimal cURL call, the same call in Python with the official `openai` client, and the switch to streaming. The full surface — every header, every parameter, every error code — lives in [API reference](/develop/api-reference).

The outcome at the end is a working script that hits your Tale instance from your laptop or a CI job.

## Before you begin

You need an account with permission to create API keys — Owner, Admin, or Developer roles qualify. You also need a Tale instance reachable on HTTPS from wherever your script will run (your laptop, a CI runner, a server). For Python, the `openai` library is the only dependency; `pip install openai` covers it. For cURL, any recent `curl` build works.

No agent-side configuration is required for the request itself — the API key routes through your organisation and uses whichever model you address by ID.

## Step 1 — Create an API key

Open **Settings > API keys** and click **Create**. Give the key a descriptive name (`cli-dev-laptop`, `ci-runner`) so you can revoke it without affecting other callers, then copy the token. The token starts with `tale_` and is shown exactly once — store it in your password manager or a shell env var. Closing the dialog without copying means regenerating.

```bash
export TALE_API_KEY="tale_..."
export TALE_BASE_URL="https://<your-tale-instance>/api/v1"
```

The step worked when the API keys list shows the new key with the name you gave it and a last-used timestamp of "Never".

## Step 2 — List available models

Every request needs a `model` field; the valid values come from `GET /api/v1/models`, which lists every model your org's providers expose. The shape matches OpenAI's `/v1/models` so OpenAI SDKs read it without changes.

```bash
curl -s "$TALE_BASE_URL/models" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

The response is a JSON list:

```json
{
  "object": "list",
  "data": [
    {
      "id": "openai/gpt-4o",
      "object": "model",
      "created": 1747325000,
      "owned_by": "openai-main"
    },
    {
      "id": "anthropic/claude-3-5-sonnet",
      "object": "model",
      "created": 1747325000,
      "owned_by": "anthropic-main"
    }
  ]
}
```

Pick a model ID — the rest of this tutorial assumes `openai/gpt-4o`.

The step worked when the response lists at least one model and the ID format matches what you see in **Settings > AI providers**.

## Step 3 — Send a non-streaming chat request

A non-streaming request returns the whole completion in one response. Use it when the script doesn't display tokens as they arrive and you only need the final text.

```bash
curl -s "$TALE_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [
      { "role": "user", "content": "Summarise our return policy in 3 bullets." }
    ]
  }' | jq -r '.choices[0].message.content'
```

The same request from Python with the OpenAI SDK:

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[
        {"role": "user", "content": "Summarise our return policy in 3 bullets."},
    ],
)
print(response.choices[0].message.content)
```

The step worked when the script prints a coherent answer and your **Usage analytics** page in Tale shows the request counted against the API key.

## Step 4 — Switch to streaming

Streaming prints tokens as the model produces them, which feels much better in a CLI or chat UI for any answer longer than a sentence. The wire format is Server-Sent Events; the OpenAI SDK parses it for you.

```python
stream = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[
        {"role": "user", "content": "Summarise our return policy in 3 bullets."},
    ],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    print(delta, end="", flush=True)
print()
```

The total cost and the final content are identical to the non-streaming version — streaming changes the wire format, not the model.

The step worked when characters appear progressively in your terminal instead of arriving all at once.

## Step 5 — Pick the right organisation when you belong to several

A single API key is scoped to one user, and that user may belong to more than one organisation. When the user belongs to exactly one org, Tale resolves it automatically; otherwise you have to name it with the `X-Organization-Slug` header — the value is the org slug shown in your URL after `/dashboard/`.

```python
client = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
    default_headers={"X-Organization-Slug": "acme"},
)
```

The step worked when a request from a multi-org user no longer returns the `Failed to resolve organization` error.

## Troubleshooting

- **401 Unauthorized** — the `tale_` key was revoked, mistyped, or the request is missing the `Bearer ` prefix. Re-check **Settings > API keys** and the `Authorization` header.
- **404 Not Found on `/chat/completions`** — the base URL is missing the `/api/v1` suffix, or the deployment isn't serving HTTPS on the host you're calling.
- **400 missing model** — the request body has no `model` field. Pass an ID from `GET /api/v1/models`.
- **400 Failed to resolve organization** — the user behind the API key belongs to more than one org. Send `X-Organization-Slug` as in Step 5.

## Where this gets used

Any OpenAI-compatible client talks to Tale once you point it at the right base URL and pick a model from your org's providers — there's no Tale-specific SDK, and swapping an existing OpenAI integration means changing two strings. The streaming switch is identical to OpenAI's, and the `X-Organization-Slug` header is the only Tale-specific wrinkle you typically need.

Two common next steps: wire the same call into an automation that runs without an explicit script invocation — [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook) — or extend the client to use tool calling, covered in [API reference](/develop/api-reference).
