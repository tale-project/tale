---
title: API reference
description: How to call Tale from outside — authentication, endpoints, error model, rate limits, and the OpenAI-compatible chat endpoint. The single source of truth for the Tale API surface.
i18nLintExclude:
  - terminology-loanword
---

The Tale API is the surface integrators use when they are outside the product and want to script it. Authentication is an API key in a header; the data plane is JSON over HTTPS; a subset of the chat endpoints speaks the OpenAI Chat Completions format so existing OpenAI client libraries work unchanged.

This page is the canonical inventory of the API surface, the auth model, and the error shape. It does not enumerate every payload field — that lives next to each endpoint group in the linked sub-pages. Read this before you call the API; come back when you are not sure which header carries the key or what a 429 means.

## A worked request

The shortest useful request — list the agents your key can see — is one curl:

```bash
curl -sS https://your-host.example.com/api/v1/agents \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Accept: application/json"
```

A successful response is JSON: `{ "agents": [ { "id": "...", "name": "...", "visibleInChat": true, ... }, ... ] }`. Every list endpoint returns the same shape — a top-level object with one array property named after the resource.

## Authentication

API keys are minted in the UI under **Settings > API keys** by anyone with the Developer role or above. Each key has a name, an owner, and a scope; the scope follows the role of the issuing user at the time of creation. Keys are shown once at creation; Tale never displays the raw key again.

Pass the key as a bearer token: `Authorization: Bearer <key>`. The key authenticates the request; the org context is inferred from the key. A key cannot be used outside its issuing org.

Cookies authenticate the browser session; API calls from the browser inside the product use cookies. Server-side scripts use the API key.

## Endpoint groups

| Group                                             | Method  | Path                               | Auth required | Notes                                              |
| ------------------------------------------------- | ------- | ---------------------------------- | ------------- | -------------------------------------------------- |
| Agents                                            | various | `/api/v1/agents/...`               | API key       | List, get, run.                                    |
| Chat                                              | various | `/api/v1/chat/...`                 | API key       | Stream chat completions against an agent or model. |
| OpenAI-compatible                                 | POST    | `/api/v1/chat/completions`         | API key       | OpenAI Chat Completions shape; use existing SDKs.  |
| OpenAI-compatible                                 | POST    | `/api/v1/images/generations`       | API key       | Generate images; OpenAI Images shape.              |
| OpenAI-compatible                                 | GET     | `/api/v1/models`                   | API key       | List available models in OpenAI format.            |
| Automation webhooks                               | POST    | `/api/automations/webhook/<token>` | URL token     | Start a run of the deployed version from outside.  |
| Knowledge — Documents                             | various | `/api/v1/documents/...`            | API key       | Upload, list, get, delete.                         |
| Knowledge — Contacts, Products, Vendors, Websites | various | `/api/v1/<entity>/...`             | API key       | List, get, create, update.                         |
| Conversations                                     | various | `/api/v1/conversations/...`        | API key       | List by status, get, write messages.               |
| Files                                             | various | `/api/v1/files/...`                | API key       | Upload, get, delete. Used by uploads.              |

Exact field shapes for each endpoint live in the OpenAPI document the platform emits at build time; load it in a Swagger or Stoplight viewer to see request and response schemas with examples. The endpoint groups in the table above are the high-level inventory; the OpenAPI doc is the field-level reference.

## OpenAI-compatible endpoints

`POST /api/v1/chat/completions` accepts a payload in OpenAI Chat Completions shape and returns a streaming or non-streaming response in the same shape. The `model` field is interpreted as the agent ID — pass an agent's ID to route through that agent's instructions, knowledge, and tools. Pass a raw model name (e.g. `gpt-4o`) to bypass agents and call the provider directly.

Existing OpenAI SDKs work with one change: point the base URL at `https://your-host.example.com/api/v1` and substitute the API key. Streaming uses Server-Sent Events.

### Vision

To send an image, give the user message an array `content` of parts instead of a string — a `text` part plus one or more `image_url` parts, each carrying a `data:` URL or a public `https` URL. This is the standard OpenAI vision shape, so an SDK that already builds multimodal messages needs no change. A plain string `content` still works for text-only turns; only image input requires the array form.

### Image generation

`POST /api/v1/images/generations` takes `{ model, prompt, n?, response_format? }` and returns the OpenAI Images shape — `{ created, data: [...] }`. `response_format` is `url` (the default — each entry is a download URL) or `b64_json` (each entry is base64 image bytes); `n` is capped at 4. Call it through any OpenAI SDK's `images.generate`.

Passing an image-generation model to `/api/v1/chat/completions` works too: the generated image comes back on the assistant message as `choices[0].message.images[]` — each an `image_url` — matching the convention image-capable gateways use, so the call is billed against a returned image rather than a dropped one. To edit an existing image, send that same request with a `text` part and an `image_url` part carrying a `data:` URL to a model that supports editing; the edited image returns the same way. Only `data:` URLs are read as edit inputs — Tale never fetches an `http` image URL server-side.

## Error model

Errors land as JSON: `{ "error": { "code": "<symbol>", "message": "<human>", "details"?: { ... } } }`. The HTTP status is one of:

- **400** — malformed request (missing field, wrong type).
- **401** — missing or invalid API key.
- **403** — the key is valid but does not have the role required for the action.
- **404** — the resource does not exist or the key cannot see it.
- **409** — conflict (e.g. duplicate idempotency key with different body).
- **422** — semantically invalid (e.g. agent referenced for a workflow trigger has been archived).
- **429** — rate limit hit. See [Rate limits](/develop/rate-limits).
- **500** — internal error. The body's `details` field has a request ID you can quote in support.

The `code` is a symbol (`unauthorized`, `forbidden`, `agent_not_found`, …); the `message` is human-readable. Clients should branch on `code`, not on the human message.

## Idempotency

Every write endpoint accepts an `Idempotency-Key` header. The first request with a given key succeeds; subsequent requests with the same key return the same response without re-executing. The key is valid for 24 hours.

A webhook-trigger call is not de-duplicated for you: a retried POST starts a second run. Durable runs make that safe for the run already in flight — each completed node is checkpointed, so a resumed run never repeats a side effect — but if a duplicate run would still be wrong, carry your own key in the payload and branch on it in the first node.

## Versioning

The API is versioned by URL prefix: today, `/api/v1/`. Breaking changes ship under a new prefix; the old prefix stays available for at least one minor version. Non-breaking additions land in the current prefix.

The release notes name the API version each release ships against; pin your client library to the current version when in production.

## Where this fits

The API is the seam between Tale and everything outside it. Webhooks are the other half — for events Tale needs to push to you, or for you to push at Tale's workflows, the [Webhooks reference](/develop/webhooks) covers the signing and idempotency rules. If you are building inside the product as a Developer-role user — agents, workflows, custom tools — the [Platform tab](/platform) is your day-to-day; this page is for outside.
