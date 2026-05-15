---
title: Call Tale from a script
description: Send a chat request to an agent from cURL and Python using Tale's OpenAI-compatible API.
---

Tale's public API is OpenAI-compatible — any SDK that talks to `chat/completions` can talk to Tale by changing two values: the base URL and the API key. This tutorial walks through a minimal cURL call, the same call in Python with the official `openai` client, and the switch to streaming responses. Full reference lives in the [API reference](/develop/api-reference).

You need Developer access to create API keys. You also need one agent you can address by slug — use the one from [Build your first agent end to end](/tutorials/editor/first-agent-end-to-end), or any of the default agents.

## Step 1 — Create an API key

Navigate to **Settings > API Keys** and click **Create**. Give the key a descriptive name (`cli-dev-laptop`), copy the token — it starts with `tale_` and is only shown once — and store it in your password manager or shell env.

```bash
export TALE_API_KEY="tale_..."
export TALE_BASE_URL="https://<your-tale-instance>/api/v1"
```

## Step 2 — List available agents

Every request needs a `model` field; the valid values are the agent slugs from `GET /api/v1/models`.

```bash
curl -s "$TALE_BASE_URL/models" \
  -H "Authorization: Bearer $TALE_API_KEY"
```

Response shape:

```json
{
  "object": "list",
  "data": [
    { "id": "chat-agent", "object": "model", "owned_by": "default" },
    { "id": "product-support", "object": "model", "owned_by": "default" }
  ]
}
```

Pick a slug — for the rest of this tutorial, assume `product-support`.

## Step 3 — Send a non-streaming chat request

Non-streaming is simplest: one request, one response. Use it when you just want the final text.

```bash
curl -s "$TALE_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "product-support",
    "messages": [
      { "role": "user", "content": "Summarise our return policy in 3 bullets." }
    ]
  }' | jq -r '.choices[0].message.content'
```

The same request in Python with the official SDK:

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
)

response = client.chat.completions.create(
    model="product-support",
    messages=[
        {"role": "user", "content": "Summarise our return policy in 3 bullets."},
    ],
)
print(response.choices[0].message.content)
```

## Step 4 — Switch to streaming

Streaming starts printing tokens as soon as the model produces them — better UX in CLIs and chat UIs, same total cost. Set `stream=True`:

```python
stream = client.chat.completions.create(
    model="product-support",
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

The wire format is Server-Sent Events (SSE); the SDK handles parsing. If you consume the endpoint without an SDK, read the reference's [streaming notes](/develop/api-reference).

## Step 5 — Reuse a conversation thread

By default each request is a standalone turn. To keep a conversation going across requests, send the optional `X-Thread-Id` header with a value you control. The same thread ID will resolve to the same conversation in the Tale UI, so end users can pick up where your script left off.

```python
client_with_thread = OpenAI(
    base_url=os.environ["TALE_BASE_URL"],
    api_key=os.environ["TALE_API_KEY"],
    default_headers={"X-Thread-Id": "nightly-report-2026-04-20"},
)
```

See [API reference — Headers](/develop/api-reference#headers) for all available headers.

## Troubleshooting

- **401 Unauthorized** — the `tale_` key was revoked, mistyped, or missing the `Bearer` prefix.
- **404 Not Found** on `/chat/completions` — base URL is missing the `/api/v1` suffix.
- **400 model not found** — agent slug does not exist or is spelled differently; re-check `GET /models`.

## Where this fits

The takeaway is that any OpenAI-compatible client talks to Tale once you point it at the right base URL and use the agent's slug as the model name — no Tale-specific SDK, no migration cost if you're swapping an existing OpenAI integration. The streaming switch is identical to OpenAI's, and the `X-Thread-Id` header is the only Tale-specific extension you typically need.

Two natural next steps: wire the same call into an automation so it runs without an explicit script invocation — [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook) — or extend the client to use tool calling, covered in [API reference — Tool calling](/develop/api-reference).
