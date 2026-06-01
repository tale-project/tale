---
title: Call Tale from a script
description: Mint an API key and call the Tale REST API from a bash, Python, or Node script — the smallest end-to-end path from terminal to agent reply.
---

Calling Tale from a script is the path you reach for when you want a value back from an agent or a workflow without opening the UI. The Tale API speaks JSON over HTTPS and accepts a bearer token in the `Authorization` header; from there, every endpoint group is a normal REST call. This walk takes you from "I want to script Tale" to a reply streamed into your terminal in one sitting.

You need a Developer role (to mint API keys), the URL of your Tale instance, and a shell with `curl`, Python, or Node. The full API surface lives in the [API reference](/develop/api-reference); this page is the smallest end-to-end walk through it.

## Before you begin

Confirm three things. Your instance is reachable on HTTPS — open `https://your-host.example.com` and check the dashboard loads. Your role is at least Developer — the **Settings > API keys** entry is hidden for Member and Editor. You have at least one published agent — list agents returns an empty array on a brand-new instance, which makes the smoke test ambiguous.

## Step 1 — Mint an API key

The first move is creating an API key scoped to your user. The key is what every script call carries; without it the API returns 401, and you cannot read the key back after creation.

Open **Settings > API keys** and click **New key**. Give it a name (`local-script-test`), pick an expiry, and click **Create**. Copy the key the panel shows — Tale displays it once and never again. Store it as an environment variable for the rest of this walk:

```bash
export TALE_API_KEY="tk_..."
export TALE_BASE_URL="https://your-host.example.com"
```

The key inherits your role; treat it like a password.

## Step 2 — Smoke-test with curl

The smallest end-to-end check is listing the agents your key can see. If this works, auth, networking, and the API are all good; if it fails, the failure mode tells you which one is broken.

```bash
curl -sS "$TALE_BASE_URL/api/v1/agents" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Accept: application/json" | jq
```

A 200 with a JSON body like `{ "agents": [ ... ] }` confirms the round-trip. A 401 means the key is wrong; a 403 means the key is valid but the role is too low; anything else means the instance is unreachable or the path is wrong. Pick an agent ID from the response — you need it for Step 3.

## Step 3 — Call an agent from Python or Node

Listing agents is read-only; the useful work happens when you ask an agent to reply. The OpenAI-compatible endpoint is the easiest entry point because existing SDKs work unchanged:

```python
from openai import OpenAI
import os

client = OpenAI(
    base_url=f"{os.environ['TALE_BASE_URL']}/api/v1",
    api_key=os.environ["TALE_API_KEY"],
)
reply = client.chat.completions.create(
    model="agt_your_agent_id_here",
    messages=[{"role": "user", "content": "Summarise the last quarter's revenue."}],
)
print(reply.choices[0].message.content)
```

The `model` field is the agent's ID; the agent's instructions, knowledge, and tools run as configured. The same shape in Node uses `openai` from npm with the same `baseURL` and `apiKey`. Streaming works with `stream=True` and Server-Sent Events.

## Where this fits

A script is the path you take when the data plane is JSON, not a screen — cron jobs, CI checks, internal portals. The API key carries your role, the OpenAI-compatible endpoint is the lowest-friction shape, and every list endpoint returns the same `{ resource: [...] }` envelope.

For inbound triggers — your system POSTing into a Tale workflow — see [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook). For the full endpoint inventory and error model, the [API reference](/develop/api-reference) is the single source of truth.
