---
title: API reference
description: REST endpoints for Platform, RAG, and Crawler — OpenAI-compatible chat, document indexing, and crawler control.
---

The Tale API is the surface your code calls when you drive the conversation, the indexing, or the crawling instead of clicking through the UI. The Platform service speaks an OpenAI-compatible Chat Completions API at `/api/v1/*`; RAG and Crawler each expose their own REST surface at the service port. This page is the single source of truth for the wire shape — every endpoint, every required header, every request and response field — and pairs with the tutorial at [Call Tale from a script](/tutorials/developer/call-tale-from-a-script) for the worked walkthrough.

The Webhooks surface — Tale receiving signed requests from external systems — lives in [Webhooks](/develop/webhooks).

## Authentication

Every Platform-API request carries a Bearer token created in **Settings > API keys**:

```text
Authorization: Bearer tale_...
```

Tokens start with `tale_` and are scoped to the user that created them. When that user belongs to more than one organisation, send `X-Organization-Slug: <slug>` to pick the org; Tale resolves automatically when the user belongs to exactly one. RAG and Crawler are reached over the internal Docker network and don't require auth for in-cluster callers — exposing them externally is an operator decision documented in the self-hosted configuration reference.

## Interactive API documentation

The Python services ship a Swagger UI for exploring and testing each endpoint:

| Service | Swagger UI                 | OpenAPI JSON                       |
| ------- | -------------------------- | ---------------------------------- |
| RAG     | http://localhost:8001/docs | http://localhost:8001/openapi.json |
| Crawler | http://localhost:8002/docs | http://localhost:8002/openapi.json |

The Platform API has no Swagger UI — it follows the OpenAI Chat Completions spec, so any OpenAI client documentation applies.

## Platform API — chat completions

The Platform exposes an OpenAI-compatible Chat Completions surface at `/api/v1/*`. Any client or SDK that talks to OpenAI's `chat/completions` talks to Tale by changing two values: the base URL and the key.

### Worked example — minimum viable request

The smallest request that does anything is a single user message addressed at any model exposed by your providers. The example below uses cURL, Python, and Node side by side; the model ID comes from `GET /api/v1/models`.

<CodeGroup>

```python Python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-tale-instance.com/api/v1",
    api_key="tale_...",  # from Settings > API keys
    default_headers={"X-Organization-Slug": "default"},
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

```typescript Node.js
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://your-tale-instance.com/api/v1',
  apiKey: 'tale_...',
  defaultHeaders: { 'X-Organization-Slug': 'default' },
});

const response = await client.chat.completions.create({
  model: 'openai/gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);
```

```bash curl
curl https://your-tale-instance.com/api/v1/chat/completions \
  -H "Authorization: Bearer tale_..." \
  -H "X-Organization-Slug: default" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'
```

</CodeGroup>

The response follows OpenAI's shape — `id`, `object: chat.completion`, `created`, `model`, `choices[].message.content`, `usage`. Streaming swaps `chat.completion` for `chat.completion.chunk` and emits one chunk per token.

### POST /api/v1/chat/completions

Send a chat message and receive a response. Supports streaming, tool calling, and JSON mode.

**Headers.** `Authorization` is required; `X-Organization-Slug` is required only for multi-org users.

| Name                  | Type   | Required             | Description                                                     |
| --------------------- | ------ | -------------------- | --------------------------------------------------------------- |
| `Authorization`       | string | Yes                  | `Bearer tale_...` — the API key from **Settings > API keys**.   |
| `X-Organization-Slug` | string | Multi-org users only | Organisation slug. Auto-resolved when the user has exactly one. |
| `Content-Type`        | string | Yes                  | `application/json` for the request body.                        |

**Request body.**

| Name                | Type             | Required | Description                                                                                 |
| ------------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------- |
| `model`             | string           | Yes      | Provider model ID, e.g. `openai/gpt-4o`. List with `GET /api/v1/models`.                    |
| `messages`          | array            | Yes      | Conversation history. Each entry has `role` and `content`; tool calls follow OpenAI's spec. |
| `stream`            | boolean          | No       | Stream the response as Server-Sent Events. Default `false`.                                 |
| `temperature`       | number           | No       | Sampling temperature, 0–2.                                                                  |
| `max_tokens`        | number           | No       | Maximum tokens to generate.                                                                 |
| `top_p`             | number           | No       | Nucleus sampling parameter.                                                                 |
| `frequency_penalty` | number           | No       | Penalise repeated tokens.                                                                   |
| `presence_penalty`  | number           | No       | Penalise tokens already present.                                                            |
| `stop`              | string or array  | No       | Stop sequences.                                                                             |
| `response_format`   | object           | No       | Set `{"type":"json_object"}` for JSON mode.                                                 |
| `tools`             | array            | No       | Tool definitions for client-side tool calling.                                              |
| `tool_choice`       | string or object | No       | `"auto"`, `"required"`, `"none"`, or `{"type":"function","function":{"name":"..."}}`.       |
| `stream_options`    | object           | No       | `{"include_usage": true}` adds a final usage chunk to a streamed response.                  |
| `seed`              | number           | No       | Best-effort determinism hint. Provider behaviour varies.                                    |

**Two modes.** Without `tools`, the request runs in **direct model mode** — Tale routes by model ID and returns the model's completion as-is. With `tools`, the request runs in **client tool mode** — the model returns `tool_calls` instead of a final answer, the client executes them, and a follow-up request carries the results back as `role: "tool"` messages.

**Tool calling example.**

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a city.",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        },
    }
]

# First call: model decides to call the tool.
response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "What's the weather in Zurich?"}],
    tools=tools,
    tool_choice="required",
)
tc = response.choices[0].message.tool_calls[0]

# Second call: send the tool result back.
final = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[
        {"role": "user", "content": "What's the weather in Zurich?"},
        response.choices[0].message.model_dump(),
        {"role": "tool", "tool_call_id": tc.id, "content": '{"temp": 18}'},
    ],
    tools=tools,
)
print(final.choices[0].message.content)
```

### GET /api/v1/models

List every model exposed by the org's providers. The shape matches OpenAI's `/v1/models`.

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

`owned_by` carries the provider slug — useful for distinguishing two providers that expose the same upstream model ID.

## RAG API — document indexing and search

The RAG service handles document indexing and vector search. It's the engine behind the knowledge base; the platform UI delegates every search and upload to this surface. The service listens on port `8001` by default.

### Worked example — index and search

A minimal end-to-end flow uploads a document, polls until indexing is done, and runs a search scoped to that document:

```bash
curl -X POST http://localhost:8001/api/v1/documents/upload \
  -F "file=@policy.pdf" \
  -F "file_id=policy-pdf-1" \
  -F "sync=true"

curl -X POST http://localhost:8001/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query":"What is our return policy?","file_ids":["policy-pdf-1"],"top_k":5}'
```

The `sync=true` parameter makes the upload block until indexing finishes; without it, the response returns immediately and the document indexes in the background.

### POST /api/v1/documents/upload

Upload a document for indexing. Multipart form-data.

| Name       | Type    | Required | Description                                          |
| ---------- | ------- | -------- | ---------------------------------------------------- |
| `file`     | file    | Yes      | The binary file to index.                            |
| `file_id`  | string  | Yes      | Stable identifier the caller assigns.                |
| `sync`     | boolean | No       | Wait for indexing to finish. Default `false`.        |
| `metadata` | string  | No       | JSON-encoded metadata stored alongside the document. |

### POST /api/v1/documents/statuses

Check indexing status for one or more documents.

```json
{ "file_ids": ["policy-pdf-1", "manual-pdf-2"] }
```

Returns each `file_id` with a status of `queued`, `running`, `completed`, or `failed`.

### POST /api/v1/search

Run a vector search scoped to specific documents.

| Name                   | Type    | Required | Description                                                             |
| ---------------------- | ------- | -------- | ----------------------------------------------------------------------- |
| `query`                | string  | Yes      | Natural-language query.                                                 |
| `file_ids`             | array   | Yes      | Documents to scope the search to. Required — there's no implicit "all". |
| `top_k`                | number  | No       | Maximum chunks to return. Default `5`.                                  |
| `similarity_threshold` | number  | No       | Minimum cosine similarity, 0–1.                                         |
| `include_metadata`     | boolean | No       | Include per-chunk metadata in the response.                             |

### DELETE /api/v1/documents/{file_id}

Remove a document and its index entries.

### GET /api/v1/documents/{file_id}/content

Return the full extracted text of an indexed document.

### POST /api/v1/documents/compare

Compare two indexed documents.

```json
{ "file_id_a": "policy-2024", "file_id_b": "policy-2025" }
```

## Crawler API — websites and on-demand fetch

The Crawler service registers websites for periodic indexing and exposes an on-demand URL-fetch endpoint. It listens on port `8002` by default.

### Worked example — register and fetch

```bash
curl -X POST http://localhost:8002/api/v1/websites \
  -H "Content-Type: application/json" \
  -d '{"domain":"https://docs.example.com","scan_interval":21600}'

curl -X POST http://localhost:8002/api/v1/urls/fetch \
  -H "Content-Type: application/json" \
  -d '{"urls":["https://docs.example.com/guide"],"word_count_threshold":100}'
```

`scan_interval` is in seconds; minimum is 60. The fetch endpoint returns cached content when available and fetches live when not.

### POST /api/v1/websites

Register a website for periodic crawling.

| Name            | Type   | Required | Description                                                       |
| --------------- | ------ | -------- | ----------------------------------------------------------------- |
| `domain`        | string | Yes      | Fully qualified URL of the site root.                             |
| `scan_interval` | number | No       | Seconds between scans. Minimum 60. Default is service-configured. |

### POST /api/v1/urls/fetch

Fetch one or more URLs synchronously.

| Name                   | Type   | Required | Description                                                |
| ---------------------- | ------ | -------- | ---------------------------------------------------------- |
| `urls`                 | array  | Yes      | URLs to fetch.                                             |
| `word_count_threshold` | number | No       | Reject results below this length (filters out menu pages). |

### GET /api/v1/websites/{domain}

Return the registration record for a website.

### DELETE /api/v1/websites/{domain}

Deregister a website. Existing indexed pages remain searchable until they age out.

### GET /api/v1/websites/{domain}/urls

List every URL the crawler has indexed for the site.

## Status endpoints

The platform exposes two public, unauthenticated endpoints that report overall up/down state. Both share the same in-memory probe with a five-second cache; they differ only in representation.

| Endpoint       | Use                                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/status`      | Human-readable HTML page. Locale picked from `Accept-Language` (English, German, French).                                        |
| `/status.json` | Machine-readable feed for external monitors — BetterStack, UptimeRobot, Statuspage, Datadog, anything that polls a JSON surface. |

Both return `200 OK` and `Cache-Control: public, max-age=5`. The platform is the source of truth — if a monitor can't reach `/status.json` at all, the process is unreachable and the monitor's own timeout is the signal. The JSON shape is covered in detail at [Status page](/develop/status-page).

## Where this fits

The API is Tale's outbound surface — what your code calls when you drive the conversation, the indexing, or the crawling. Its inbound counterpart is [Webhooks](/develop/webhooks): the same protocol family, the same audit log, with Tale on the receiving side instead of the calling side. Any client that talks to OpenAI's `/chat/completions` talks to Tale by changing two values (base URL and key); any system that can POST JSON to a unique URL can drive a workflow.

For the tutorial that walks both directions end to end, [Call Tale from a script](/tutorials/developer/call-tale-from-a-script) covers the API side and [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook) covers the inbound webhook side.
