---
title: Agent webhooks
description: The agent's Webhooks tab — unique URLs external systems POST to so they can chat with the agent without going through the UI, with the token in the URL as the credential.
---

An agent's **Webhooks** tab creates unique URLs external systems can POST to and chat with the agent — nothing in the UI is involved. Reach for it when something outside Tale needs the agent to answer: a Slack bot, a form handler, a scheduled job.

This page covers the per-agent webhook surface only. For inbound triggers that run an automation rather than an agent, see [Automations → triggers](/platform/automations/triggers); for the full developer surface, see [Develop → API reference](/develop/api-reference).

<Frame caption="The Webhooks tab — one live webhook with its Active toggle and last-triggered time.">

![The agent editor's Webhooks tab showing the Create webhook button and a table with one webhook URL, an active toggle, and a Never last-triggered value.](/images/platform/agent-editor-webhooks.webp)

</Frame>

## Create a webhook

Open the agent, switch to **Webhooks**, and click **Create webhook**. The dialog shows the new URL once — save it, because the token embedded in the URL acts as the authentication credential. There is no separate API key or header: anyone holding the URL can chat with the agent, so treat it like a secret.

## Call it

POST a JSON body with a `message` field; the response is the agent's reply:

```bash
curl -X POST https://tale.yourcompany.com/api/agents/wh/<token> \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

Three fields shape the call:

- **`stream`** — add `"stream": true` and the reply arrives as server-sent events instead of one JSON response.
- **`threadId`** — without it, every POST starts a fresh conversation; pass the thread id from a previous response to continue one with context intact.
- **Files** — send `multipart/form-data` with a `message` field and one or more `file` fields to attach uploads to the message.

Each row's **Usage examples** action opens ready-made samples for all of these, filled in with the row's real URL.

## The OpenAI-compatible endpoint

Appending `/chat/completions` to the webhook URL exposes an OpenAI-style ChatCompletion endpoint, so off-the-shelf OpenAI clients can point at an agent: use the webhook URL as the base URL, any non-empty value as the API key, and a model the organization offers as the model id. The agent pins no model of its own, so this field is where the caller makes the choice the composer would otherwise make. File uploads are supported only on the base webhook URL, not on this sub-path.

## Manage and revoke

The table shows each webhook's URL, an **Active** toggle, and when it was last triggered. Toggling a webhook off pauses it without losing the URL; deleting it is the revocation move — any system still using that URL loses access, so provision the replacement webhook before retiring the old one.

## Where this fits

Webhooks are the lightweight, per-agent integration surface — right when the integration is "this one agent answers this one thing". For richer flows with steps and approvals, model the work as an [automation](/platform/automations/concepts) and point the caller at the automation's webhook trigger — [Trigger automation via webhook](/tutorials/developer/trigger-automation-via-webhook) walks that shape end to end.
