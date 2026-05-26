---
title: AI providers
description: Settings > Providers is where Admins connect OpenAI, Anthropic, Azure OpenAI, and local Ollama, choose which models each one exposes, and pick the org's default. Every reply Tale streams comes from a model resolved through this page.
---

Settings > Providers is the surface where Tale meets the LLMs it serves. Admins connect the providers the org wants to use — OpenAI, Anthropic, Azure OpenAI, or a local Ollama — pick which of each provider's models the org is allowed to call, and set the default model for new chats and new agents. Every reply Tale streams is routed through this page; touching it changes what the rest of the product can do.

This page covers the UI: how to add a provider, what the model-allowlist controls, how the default resolves, and how to retire a provider without breaking existing chats. The provider catalogue itself and the deeper config-file form of the same surface live one tab over under [Models](/platform/models) for the catalogue and the self-hosted configuration tab for the file form.

## What the list shows

Open **Settings > Providers** and you land on the list of providers the org has connected. Each row names the provider, shows its credential status (connected, error, untested), the number of models the provider exposes, and the number of those the org has allowlisted. A connection error surfaces the upstream message next to the row — usually a bad key or a missing scope.

The row expands into the provider's model picker. Tale fetches the provider's full model list at credential-verification time; the picker shows that list with a checkbox next to each model, plus a per-model tag (chat, image, embedding, audio) that drives where the model can be used downstream.

## Adding a provider

Click **Add provider** and pick the provider type. Each provider type asks for the credential it needs:

- **OpenAI** — API key from `platform.openai.com`. The key inherits the OpenAI account's quota and rate limits.
- **Anthropic** — API key from `console.anthropic.com`. Same shape as OpenAI.
- **Azure OpenAI** — endpoint URL plus a key; Tale resolves models against the Azure deployment, not the OpenAI model name.
- **Ollama** — base URL of the Ollama server (typically `http://ollama:11434` inside the Tale network). No key; reachability is the auth.

Once the credential lands, Tale calls the provider's model-list endpoint, surfaces every model it found, and waits for you to pick the allowlist before any agent can call them. Saving an empty allowlist is allowed, but no model from that provider is callable until you allowlist at least one.

## The allowlist and per-model tags

The allowlist is the org's contract with itself about which models its agents may use. A model that is not on the allowlist does not appear in any picker, even if the upstream provider exposes it. Add models when you trust the provider's pricing for them; remove models when you do not want them callable any more.

Each model carries one or more tags assigned by Tale at fetch time based on the provider's metadata: `chat` (text in, text out), `image` (text in, image out), `embedding` (text in, vector out), `audio` (audio in or out). Agents bind to chat-tagged models; the image-generation tool family uses image-tagged models; document indexing uses embedding-tagged models. Removing the only allowlisted model in a tag class breaks the features that depend on it; the row warns when you are about to do that.

## The org default

The org default is the model new chats and new agents pick when no other model is named. Set it from the **Default model** row at the top of the provider list. Changing the default affects new objects only — existing chats and agents keep the model they were bound to. Reach for the default when you are rolling out a new generation of model across the org without re-editing every agent.

## Retiring a provider

Click the row, then **Disconnect**. A disconnected provider stops appearing in pickers; agents bound to one of its models surface a configuration error and fall back to the org default if the agent has fallback enabled. The row stays in the list with a disconnected badge for the audit trail. Disconnect is reversible — clicking **Reconnect** walks the credential flow again — but the per-model allowlist has to be re-picked since the underlying model list may have shifted upstream.

## Where this fits

Providers are the bottom of the stack — every agent, every chat, every workflow step that produces text resolves through them. The natural next read is [Models](/platform/models) for the catalogue of what each provider currently ships and which tags they carry, and [Agent concepts](/platform/agents/concepts) for how the model knob fits into the four-knob model an agent is built from.
