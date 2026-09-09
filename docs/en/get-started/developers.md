---
title: Your first day integrating with Tale
description: The developer journey — mint an API key, make your first authenticated request, and know where the API surface lives.
---

This journey is for the person wiring Tale into other systems. In ten minutes you mint an API key, make your first authenticated request, and know which door to knock on for chat, workflows, and documents.

You need the **Developer** role or higher (the API settings are hidden below it) on a running instance — [quickstart](/get-started/quickstart) if you have none. Replace `your-host.example.com` below with your instance's host.

<Steps>

<Step title="Mint an API key">

To get a credential your scripts can hold, open **Settings > API > REST** and click **Create API key**. Name it for the system that will use it — keys are listed by name, and a year from now "zapier-bridge" beats "test". The key value shows once, on creation; store it in your secret manager, not in code.

<Frame caption="The REST API settings — keys are created and revoked here.">

![The REST API keys settings page listing two keys — Production ingest and CI pipeline — each showing only its key prefix, the date it was added, and a Never used marker, beside a Create API key button.](/images/get-started/settings-api-keys.webp)

</Frame>

</Step>

<Step title="Make the first request">

The shortest useful call lists the direct-chat models your key can use. The key travels as a bearer token; organization context follows your membership:

```bash
curl -sS https://your-host.example.com/api/v1/models \
  -H "Authorization: Bearer $TALE_API_KEY"
```

<Check>

A JSON object with a `models` array proves the key, authentication and route. The array can be empty when no direct-chat model is available. A `401` means the authorization header is malformed or the key was revoked.

</Check>

</Step>

</Steps>

## The rest of the surface

For work in a project, start an automation at `POST /api/v1/projects/{id}/automations/{name}/runs` and poll `/api/v1/projects/{id}/runs/{runId}`. Project chats, tasks and files use the same `/api/v1/projects/{id}/...` structure; the project ID belongs in the URL. Ordinary personal chat uses `/api/v1/threads`, and `/api/v1/documents` serves Hub documents with no project. Webhook callers use `/api/projects/{id}/automations/webhook/{token}` for an installed project automation; the token is their credential. The [API reference](/develop/api-reference) covers the matching non-project routes, permissions and required organization header. The same key also opens the [MCP endpoint](/develop/mcp-endpoint) for model-driven clients.

## Where you are now

You hold a working credential and have seen the request shape every endpoint shares. From here, [call Tale from a script](/tutorials/developer/call-tale-from-a-script) turns the curl into a real connector, [trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook) covers the push direction, and the [MCP endpoint](/develop/mcp-endpoint) is the same platform for MCP clients.
