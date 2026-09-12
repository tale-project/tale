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
export TALE_ORG_SLUG="<org-slug>"
```

The key acts as you in the organization selected by `TALE_ORG_SLUG`; your membership and role determine what it may do. When you belong to several organizations, the organization header is required on every request, reads included — without it the API answers `400` with `"code": "ORG_SLUG_REQUIRED"` and lists the slugs you may send. Store the key like a password.

## Step 2 — Smoke-test with curl

The smallest end-to-end check is listing the organization's automations. If this works, auth, networking, and the API are all good; if it fails, the failure mode tells you which one is broken.

```bash
curl -sS --compressed "$TALE_BASE_URL/api/v1/automations" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" | jq
```

A 200 with a `{ "automations": [...] }` body confirms the round-trip. A 401 means the key is wrong; anything else means the instance is unreachable or the path is mistyped.

## Step 3 — Ask a model and read the reply

Chat over the API is asynchronous: post a message, poll while the turn runs in the background, then read the reply. This example creates a personal thread with no project. For project chat, set `threads_url` to `f"{base}/api/v1/projects/{os.environ['TALE_PROJECT_ID']}/threads"`; all subsequent calls keep that scope, with no `projectId` in the body. You need read access to that active project, even as a Member.

```python
import os, time, requests

base = os.environ["TALE_BASE_URL"]
auth = {
    "Authorization": f"Bearer {os.environ['TALE_API_KEY']}",
    "X-Organization-Slug": os.environ["TALE_ORG_SLUG"],
}
threads_url = f"{base}/api/v1/threads"

# 1. A thread of your own
thread = requests.post(threads_url, headers=auth, json={}).json()

# 2. Send a message — name a model your org has configured
requests.post(
    f"{threads_url}/{thread['id']}/messages",
    headers=auth,
    json={"content": "In one sentence: what is Tale?", "model": "<your-model>"},
).raise_for_status()

# 3. Poll until idle, then read the last message
while True:
    status = requests.get(
        f"{threads_url}/{thread['id']}/generation", headers=auth
    ).json()["status"]
    if status == "idle":
        break
    time.sleep(1)

messages = requests.get(
    f"{threads_url}/{thread['id']}/messages", headers=auth
).json()["page"]
reply = messages[-1]
print("".join(p["text"] for p in reply["parts"] if p.get("type") == "text"))
```

`{"status": "idle"}` means no turn is running. Read the messages for the reply or a model error. The send call answers **202** before the work finishes. If you lose access or move the thread before the queued turn opens, the worker refuses it; see the [API reference](/develop/api-reference) for the scope rules.

## Step 4 — Start an automation run

Choose an active project you can edit and an automation deployed for it, then set `TALE_PROJECT_ID` below. This example uses `billing/dunning`; names containing `/` use `__` in URLs, so it becomes `billing__dunning`. The start and poll both name the same project:

```bash
export TALE_PROJECT_ID="<projectId>"
RUN=$(curl -sS --compressed -X POST "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/automations/billing__dunning/runs" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" \
  -H "Content-Type: application/json" -d '{ "input": {} }' | jq -r .runId)

curl -sS --compressed "$TALE_BASE_URL/api/v1/projects/$TALE_PROJECT_ID/runs/$RUN?fields=status,finishedAt" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG" | jq .status
```

A live run needs your Developer role and project edit access. `{"mode": "mock"}` uses deterministic mocks but still requires project edit access. A 409 means no deployed version is available for this call. An automation with bindings must include the chosen project; install it there first if needed. The [API reference](/develop/api-reference) covers installation and non-project runs.

## Where this fits

A script is the path you take when the data plane is JSON, not a screen — cron jobs, CI checks, internal portals. The API key carries your role, and anything that starts real work answers 202 and hands you something to poll.

For inbound triggers — a third-party system POSTing into a Tale automation — see [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook). For a model-driven client instead of a script, the [MCP endpoint](/develop/mcp-endpoint) exposes the same platform as tools. For the full endpoint inventory and error model, the [API reference](/develop/api-reference) is the single source of truth.
