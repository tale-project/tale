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

The shortest useful call lists the agents your key can see. The key rides as a bearer token; the workspace context is inferred from the key itself:

```bash
curl -sS https://your-host.example.com/api/v1/agents \
  -H "Authorization: Bearer $TALE_API_KEY"
```

<Check>

A JSON array of agents — including the built-in Assistant — proves the key, the header, and the route. A `401` means the token header is malformed or the key was revoked.

</Check>

</Step>

</Steps>

## The rest of the surface

Everything else is variations on that request. The OpenAI-compatible endpoints (`/api/v1/chat/completions`, `/api/v1/models`) mean existing SDKs work by swapping the base URL; workflows run by slug over `/api/v1/workflows/<slug>/run` with the same Bearer key, or fire from outside over webhook URLs of the form `/api/workflows/wh/<token>` — the token in the URL is the credential; documents upload over `/api/v1/documents`. The [API reference](/develop/api-reference) is the complete inventory with auth, shapes, and limits.

## Where you are now

You hold a working credential and have seen the request shape every endpoint shares. From here, [call Tale from a script](/tutorials/developer/call-tale-from-a-script) turns the curl into a real integration, [trigger a workflow via webhook](/tutorials/developer/trigger-automation-via-webhook) covers the push direction, and [webhooks](/develop/webhooks) documents the payloads Tale sends you.
