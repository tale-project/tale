---
title: Call Tale from a script
description: Mint an API key and call the Tale REST API from a bash or Python script — the smallest end-to-end path from terminal to an assistant reply.
---

Calling Tale from a script is the path you reach for when you want a value back from the platform without opening the UI. The Tale API speaks JSON over HTTPS and accepts a bearer token in the `Authorization` header; from there, every endpoint group is a normal REST call. This walk takes you from "I want to script Tale" to an assistant reply printed in your terminal in one sitting.

You need a Developer role (to mint API keys), the URL of your Tale instance, and a shell with `curl` and Python. The full API surface lives in the [API reference](/develop/api-reference); this page is the smallest end-to-end walk through it.

## Before you begin

Confirm three things. Your instance is reachable on HTTPS — open `https://your-host.example.com` and check the dashboard loads. Your role is at least Developer — [API keys](/platform/admin/api-keys) are managed by Admin and Developer roles. You know a model your organization has configured — the API never auto-selects one, so every chat call names its model explicitly.

## Step 1 — Mint an API key

The first move is creating an API key. The key is what every script call carries; without it the API returns 401, and you cannot read the key back after creation.

Create a key in the [API keys](/platform/admin/api-keys) panel and copy what it shows — Tale displays it once and never again. Store it as an environment variable for the rest of this walk:

```bash
export TALE_API_KEY="tale_..."
export TALE_BASE_URL="https://your-host.example.com"
```

The key belongs to you and to your organization; what it may do follows your role. Treat it like a password.

## Step 2 — Smoke-test with curl

The smallest end-to-end check is listing the organization's automations. If this works, auth, networking, and the API are all good; if it fails, the failure mode tells you which one is broken.

```bash
curl -sS "$TALE_BASE_URL/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY" | jq
```

A 200 with a `{ "page": [...], "isDone": true, ... }` body confirms the round-trip — every list endpoint answers this same paginated envelope. A 401 means the key is wrong; anything else means the instance is unreachable or the path is mistyped.

## Step 3 — Ask a model and read the reply

Chat over the API is asynchronous: you post a message, the turn runs in the background, and you poll until it is done. Three calls, one loop:

```python
import os, time, requests

base = os.environ["TALE_BASE_URL"]
auth = {"Authorization": f"Bearer {os.environ['TALE_API_KEY']}"}

# 1. A thread of your own
thread = requests.post(f"{base}/api/v1/threads", headers=auth, json={}).json()

# 2. Send a message — name a model your org has configured
requests.post(
    f"{base}/api/v1/threads/{thread['id']}/messages",
    headers=auth,
    json={"content": "In one sentence: what is Tale?", "model": "<your-model>"},
).raise_for_status()

# 3. Poll until idle, then read the last message
while True:
    status = requests.get(
        f"{base}/api/v1/threads/{thread['id']}/generation", headers=auth
    ).json()["status"]
    if status == "idle":
        break
    time.sleep(1)

messages = requests.get(
    f"{base}/api/v1/threads/{thread['id']}/messages", headers=auth
).json()["page"]
print(messages[-1]["content"])
```

`{"status": "idle"}` means the turn finished — including a failed one, which lands as an assistant message carrying the error rather than vanishing. The send call answers **202** immediately; the reply exists only after the poll loop leaves `queued`/`streaming`.

## Step 4 — Start an automation run

The same 202-then-poll shape starts real work. Automation names are `/`-paths written with `__` in URLs — `billing/dunning` travels as `billing__dunning`:

```bash
RUN=$(curl -sS -X POST "$TALE_BASE_URL/api/v1/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "Content-Type: application/json" -d '{ "input": {} }' | jq -r .runId)

curl -sS "$TALE_BASE_URL/api/v1/runs/$RUN" \
  -H "Authorization: Bearer $TALE_API_KEY" | jq .status
```

A live run needs your Developer role; pass `{"mode": "mock"}` to rehearse against deterministic mocks with any member key. A 409 means the automation has no deployed version yet.

## Where this fits

A script is the path you take when the data plane is JSON, not a screen — cron jobs, CI checks, internal portals. The API key carries your role, every list endpoint answers the same paginated envelope, and anything that starts real work answers 202 and hands you something to poll.

For inbound triggers — a third-party system POSTing into a Tale automation — see [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook). For a model-driven client instead of a script, the [MCP endpoint](/develop/mcp-endpoint) exposes the same platform as tools. For the full endpoint inventory and error model, the [API reference](/develop/api-reference) is the single source of truth.
