---
title: API reference
description: REST API endpoints for RAG, Crawler, and Platform services.
---

Each Tale service has its own REST API. These are used internally between services but are also available for direct integration with external systems.

## Interactive API documentation

All Python-based services have a Swagger UI for exploring and testing the API:

| Service | Swagger UI URL             | OpenAPI JSON                       |
| ------- | -------------------------- | ---------------------------------- |
| RAG     | http://localhost:8001/docs | http://localhost:8001/openapi.json |
| Crawler | http://localhost:8002/docs | http://localhost:8002/openapi.json |

## RAG API

The RAG API handles document indexing and search. It is the engine behind the knowledge base.

### Upload a document

```http
POST /api/v1/documents/upload
Content-Type: multipart/form-data
```

```text
file:      <binary file data>
file_id:   "unique-file-id"
sync:      "true"  (optional, wait for indexing to complete)
metadata:  '{"source": "upload"}'  (optional JSON string)
```

Document indexing runs in the background by default. Set `sync=true` to wait for indexing to complete before the response returns.

### Check document statuses

```http
POST /api/v1/documents/statuses
```

```json
{
  "file_ids": ["file-id-1", "file-id-2"]
}
```

Returns the indexing status for each document. States: `queued`, `running`, `completed`, `failed`.

### Search the knowledge base

```http
POST /api/v1/search
```

```json
{
  "query": "What is our return policy?",
  "file_ids": ["file-id-1", "file-id-2"],
  "top_k": 5,
  "similarity_threshold": 0.0,
  "include_metadata": true
}
```

The `file_ids` parameter is required and scopes the search to specific documents.

### Delete a document

```http
DELETE /api/v1/documents/{file_id}
```

### Get document content

```http
GET /api/v1/documents/{file_id}/content
```

Returns the full extracted text of an indexed document.

### Compare documents

```http
POST /api/v1/documents/compare
```

```json
{
  "file_id_a": "file-id-1",
  "file_id_b": "file-id-2"
}
```

## Crawler API

### Register a website for crawling

```http
POST /api/v1/websites
```

```json
{
  "domain": "https://docs.example.com",
  "scan_interval": 21600
}
```

`scan_interval` is in seconds. Minimum value is 60.

### Fetch page content

```http
POST /api/v1/urls/fetch
```

```json
{
  "urls": ["https://docs.example.com/guide"],
  "word_count_threshold": 100
}
```

Returns cached content when available, or fetches it live if not.

### Get website info

```http
GET /api/v1/websites/{domain}
```

### Deregister a website

```http
DELETE /api/v1/websites/{domain}
```

### List website URLs

```http
GET /api/v1/websites/{domain}/urls
```

## Platform API

The Platform service exposes a public API at `/api/v1/*` for programmatic access to your data. Authenticate using an API key from **Settings > API Keys**.

### OpenAI-compatible chat completions

The platform provides an interface fully compatible with the [OpenAI Chat Completions API](https://platform.openai.com/docs/api-reference/chat). Any client or SDK that supports OpenAI (Python, Node, curl, LiteLLM, etc.) can connect by pointing `base_url` to your Tale instance.

#### Quick start

<CodeGroup>

```python Python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-tale-instance.com/api/v1",
    api_key="tale_...",  # from Settings > API Keys
    default_headers={"X-Organization-Slug": "default"},
)

response = client.chat.completions.create(
    model="chat-agent",  # agent slug from your Agents page
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
  model: 'chat-agent',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);
```

```bash curl
curl https://your-tale-instance.com/api/v1/chat/completions \
  -H "Authorization: Bearer tale_..." \
  -H "X-Organization-Slug: default" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat-agent","messages":[{"role":"user","content":"Hello!"}]}'
```

</CodeGroup>

#### Authentication

All requests require a Bearer token in the `Authorization` header:

```text
Authorization: Bearer tale_...
```

Create API keys in **Settings > API Keys** in the platform UI.

#### Headers

| Header                | Required | Description                                                  |
| --------------------- | -------- | ------------------------------------------------------------ |
| `Authorization`       | Yes      | `Bearer <api-key>`                                           |
| `X-Organization-Slug` | No       | Organization slug. Auto-resolved if user belongs to one org. |
| `X-Thread-Id`         | No       | Reuse a conversation thread across requests.                 |

#### Endpoints

##### POST /api/v1/chat/completions

Send a chat message and receive a response. Supports streaming and tool calling.

**Request body:**

| Field               | Type             | Description                                                                           |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `model`             | string           | **Required.** Agent slug (e.g., `chat-agent`).                                        |
| `messages`          | array            | **Required.** Conversation messages with `role` and `content`.                        |
| `stream`            | boolean          | Enable SSE streaming. Default: `false`.                                               |
| `temperature`       | number           | Sampling temperature (0–2).                                                           |
| `max_tokens`        | number           | Maximum tokens to generate.                                                           |
| `top_p`             | number           | Nucleus sampling parameter.                                                           |
| `frequency_penalty` | number           | Penalize repeated tokens.                                                             |
| `presence_penalty`  | number           | Penalize tokens already present.                                                      |
| `stop`              | string or array  | Stop sequences.                                                                       |
| `response_format`   | object           | Set `{"type": "json_object"}` for JSON mode.                                          |
| `tools`             | array            | Tool definitions for client-side tool calling.                                        |
| `tool_choice`       | string or object | `"auto"`, `"required"`, `"none"`, or `{"type":"function","function":{"name":"..."}}`. |

**Two modes:**

- **Agent mode** (no `tools`): The agent uses its pre-configured server-side tools (RAG, web search, etc.) and auto-executes them. The response contains the final text.
- **Client tool mode** (`tools` provided): Only the client-defined tools are available. The model returns `tool_calls` for the client to execute. Send results back with `role: "tool"` messages.

**Tool calling example:**

```python
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}]

# Step 1: send tools
response = client.chat.completions.create(
    model="chat-agent",
    messages=[{"role": "user", "content": "What's the weather?"}],
    tools=tools,
    tool_choice="required",
)

# Step 2: execute tool and send result
tc = response.choices[0].message.tool_calls[0]
messages = [
    {"role": "user", "content": "What's the weather?"},
    response.choices[0].message.model_dump(),
    {"role": "tool", "tool_call_id": tc.id, "content": '{"temp": 20}'},
]
final = client.chat.completions.create(
    model="chat-agent", messages=messages, tools=tools
)
print(final.choices[0].message.content)
```

##### GET /api/v1/models

List available agents (models).

```json
{
  "object": "list",
  "data": [
    { "id": "chat-agent", "object": "model", "owned_by": "default" },
    { "id": "workflow-assistant", "object": "model", "owned_by": "default" }
  ]
}
```

## Status endpoints

Two public, unauthenticated endpoints expose the platform's overall up/down state. They share the same probe (5-second in-memory cache) and only differ in representation:

| Endpoint       | Use                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/status`      | Human-readable HTML status page. Picks English, German, or French from `Accept-Language`.                              |
| `/status.json` | Machine-readable feed for external monitors (BetterStack, UptimeRobot, Atlassian Statuspage, Datadog Synthetics, etc.) |

Both endpoints always respond with `200 OK` and `Cache-Control: public, max-age=5`. The platform itself is the source of truth — if your monitor cannot reach `/status.json` at all, the platform process is unreachable, and the monitor's own timeout is the signal.

### Wire shape (`/status.json`)

```json
{
  "status": "operational",
  "checkedAt": "2026-05-11T13:45:07.123Z",
  "components": [
    { "id": "convex", "status": "operational" },
    { "id": "rag", "status": "operational" },
    { "id": "crawler", "status": "outage" }
  ]
}
```

| Field                 | Type   | Values                                                                    |
| --------------------- | ------ | ------------------------------------------------------------------------- |
| `status`              | string | `operational`, `degraded` (some components down), or `outage` (all down). |
| `checkedAt`           | string | ISO 8601 timestamp of the most recent probe round.                        |
| `components[].id`     | string | Stable component identifier: `convex`, `rag`, or `crawler`.               |
| `components[].status` | string | `operational` or `outage` per component.                                  |

Keyword-based uptime monitors can alert on the case-sensitive substring `"status":"outage"`.

## Where this fits

The API is Tale's outbound surface — what your code calls when _you_ drive the conversation, the workflow, or the data access. Its inbound counterpart is [Webhooks](/develop/webhooks): the same protocol, the same signature scheme, the same audit log, with Tale on the calling side instead of the receiving side. Any client that talks to OpenAI's `/chat/completions` talks to Tale by changing two values (base URL and key); any system that can send a signed HTTPS POST can drive a workflow.

For the tutorial that walks both directions end to end, [Call Tale from a script](/tutorials/developer/call-tale-from-a-script) covers the API side and [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook) covers the inbound webhook side.
