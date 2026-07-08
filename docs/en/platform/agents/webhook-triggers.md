---
title: Agent webhook triggers
description: The Workers surface — a per-agent HTTP endpoint that external systems POST to so they can invoke the agent without going through Chat.
---

An agent's **Workers** tab exposes an HTTP endpoint another system can POST to. The POST runs the agent against the payload and returns the reply; nothing in the UI is involved. Reach for it when something outside Tale needs the agent to answer a question — a Slack bot, a form handler, a scheduled job.

This page covers the Workers surface only. For the developer-facing equivalent (calling Tale from arbitrary scripts), see [Develop → API reference](/develop/api-reference); for inbound triggers that run a workflow rather than an agent, see [Workflows → triggers](/platform/workflows/triggers).

## A worked Worker

Open the agent and switch to **Workers**. The page shows a per-agent URL and a sample `curl`. POST a JSON payload with a `message` field; Tale receives it, runs the agent against the message, and returns the agent's reply as the response body. The same payload sent twice produces two independent runs — Workers do not de-duplicate.

## Authentication

Worker endpoints require an API key. The endpoint shows the URL but not a working `curl` until a key is attached; the **Authorization** header carries the key as a bearer token. Rotating the key invalidates every running caller — provision new keys before retiring old ones. API keys are managed under [API keys](/platform/admin/api-keys).

## Payload shape

The default payload is `{"message": "…"}`. Additional fields the agent's instructions reference can be added; they pass through to the model context as structured input. The agent's reply is returned as a JSON object with the reply text, any tool calls, and any citations. Streaming is supported when the caller sets the `Accept: text/event-stream` header.

## Where this fits

Workers are the lightweight, per-agent equivalent of the API. They are useful when the integration is "this one agent does this one thing"; for richer flows, model the call as a [workflow](/platform/workflows/concepts) and point the integration at the workflow's webhook trigger. The [Trigger a workflow via webhook](/tutorials/developer/trigger-automation-via-webhook) tutorial walks the workflow shape end to end.
