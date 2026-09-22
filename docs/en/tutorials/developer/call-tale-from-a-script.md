---
title: Call Tale from a script
description: Create an API key, choose an available model and print a completed assistant reply with Python.
---
Send one message to Tale and print its reply in your terminal. This tutorial creates a personal chat thread, checks each HTTP response and waits for the assistant to finish. It uses Python 3’s standard library and curl; no Python package installation is needed.

## Prepare access

You need a reachable Tale instance, permission to create an API key, your organization’s slug and a directly callable model. Admins and Developers can create keys. A model listed by Tale can still fail if the provider account has no credit or does not include that model.

Open **Settings > API > REST**, choose **Create API key**, enter a name such as `Reporting script` and choose an expiration. Choose **Create key** and copy the secret shown once. Load it into `TALE_API_KEY` through your secret manager or a private shell environment; do not put it in the Python file or commit it.

<Frame caption="Give the key a recognizable purpose so you can revoke it without disrupting another integration.">

![The Create API key dialog asks for a descriptive name and an expiry before a key is generated.](/images/get-started/settings-api-keys.webp)

</Frame>

Set the non-secret connection values below. Use the slug, not the organization ID; send the header on every request so the script stays explicit if your account joins another organization.

```bash
export TALE_BASE_URL="https://your-host.example.com"
export TALE_ORG_SLUG="your-org-slug"
export TALE_MODEL="model-id-from-the-catalog"
```

## Find a model you can call

List the models available to this key holder:

```bash
curl --fail-with-body --silent --show-error "$TALE_BASE_URL/api/v1/models" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

A `200` response contains a `models` array. Set `TALE_MODEL` to an entry’s `id`. If the same ID appears under several providers, also set `TALE_PROVIDER` to the chosen `providerSlug`. An empty array means there is no directly callable model for this account; ask an admin to check credentials and model access.

## Send and wait for one reply

Save this as `tale-chat.py`, then run `python3 tale-chat.py` in the environment configured above. The script creates data in your personal chat history and may incur model usage charges.

```python
import json
import os
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base = os.environ["TALE_BASE_URL"].rstrip("/")
headers = {
    "Authorization": f"Bearer {os.environ['TALE_API_KEY']}",
    "X-Organization-Slug": os.environ["TALE_ORG_SLUG"],
    "Content-Type": "application/json",
}

def request(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(f"{base}/api/v1{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise SystemExit(f"HTTP {error.code}: {detail}") from error

models = request("GET", "/models")["models"]
model_id = os.environ["TALE_MODEL"]
provider = os.environ.get("TALE_PROVIDER")
candidates = [m for m in models if m["id"] == model_id
              and (not provider or m["providerSlug"] == provider)]
if len(candidates) != 1:
    raise SystemExit("Choose one available model/provider pair from GET /api/v1/models")

thread = request("POST", "/threads", {})
path = f"/threads/{thread['id']}"
sent = request("POST", f"{path}/messages", {
    "content": "In one sentence: what is Tale?",
    "model": candidates[0]["id"],
    "providerSlug": candidates[0]["providerSlug"],
})
reply_id = sent["messageId"]
deadline = time.monotonic() + 600
while True:
    generation = request("GET", f"{path}/generation")
    if generation["status"] == "idle":
        break
    if time.monotonic() >= deadline:
        request("DELETE", f"{path}/generation")
        raise SystemExit("Stopped the turn after the local 10-minute deadline")
    time.sleep(2)

if generation.get("lastMessageId") != reply_id:
    raise SystemExit("The accepted turn did not finish in this thread scope")
reply = request("GET", f"{path}/messages/{reply_id}")
if reply["status"] != "complete":
    raise SystemExit(f"Turn {reply['status']}: {reply.get('errorCode', '')} {reply.get('error', '')}")
if reply.get("finishReason") == "length":
    raise SystemExit("The reply reached its output limit; inspect it before using it")
text = "".join(part["text"] for part in reply["parts"] if part.get("type") == "text")
if not text:
    raise SystemExit("The turn completed without a text answer")
print(text)
```

The message endpoint returns `202` with `messageId` before generation finishes. The generation endpoint becoming `idle` means the turn has settled, not necessarily succeeded. The script then reads that specific assistant message and checks its status, output limit and text before printing.

<Tip>

Keep the thread ID when extending this into an integration. Send later messages to the same thread to preserve conversation context; creating a thread on every invocation starts a new conversation.

</Tip>

## Diagnose a failed request

| Result | Next action |
| --- | --- |
| `401` | Check whether the key expired, was revoked or was copied incorrectly. |
| `400` with `ORG_SLUG_REQUIRED` | Supply the intended organization slug. |
| `404` with `ORG_SLUG_INVALID` | The slug names no organization at all — check for a typo, and never paste the dashboard URL's organization ID. |
| `403` with `ORG_FORBIDDEN` | The organization exists, but the key holder is not a member of it — pick a slug from `data.organizations`. |
| `403` | Check the key holder’s permissions for the operation. |
| No model candidate | Read `/models` again and select an exact ID/provider pair. |
| `429` | Honor `Retry-After`; see [Rate limits](/develop/rate-limits). |
| Message status `failed` | Inspect `errorCode`; fix the provider account or model configuration before retrying. |
| Network timeout | Check the instance and the existing thread before submitting another message. |

A timed-out POST may already have been accepted. Do not blindly send it again: inspect the thread’s generation state and messages first.

The ten-minute deadline belongs to this example, not to the server. A queued turn may be waiting behind other clients, and reasoning can keep a model active before any answer text appears. The script does not automatically repeat a failed send. For unattended retries, persist an `Idempotency-Key` of 1–255 printable ASCII characters with the request body, reuse both after a lost response, and honor `Retry-After` on `429`. See [safe message retries](/develop/api-reference#retry-a-send-safely).

## Extend the integration

For project-scoped conversations, use `/api/v1/projects/{id}/threads` consistently for creation, messages, generation and reads. You need access to the active project; adding `projectId` to a personal-thread request does not switch its scope.

The [API reference](/develop/api-reference) covers project access, message parts and automation runs. To start work when an external event arrives, continue with [Trigger an automation via webhook](/tutorials/developer/trigger-automation-via-webhook).
