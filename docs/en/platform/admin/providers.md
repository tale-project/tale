---
title: AI providers
description: Settings > AI providers is where Admins connect the OpenAI-compatible providers behind every reply, choose which models the org may call, and set the defaults. Every reply Tale streams comes from a model resolved through this page.
---

Settings > AI providers is the surface where Tale meets the models it serves. A fresh org ships with one provider connected — **OpenRouter**, whose single key reaches chat, vision, embedding, transcription, speech, and image models — and Admins add, edit, or retire providers from here. Every reply Tale streams is routed through a model resolved on this page; touching it changes what the rest of the product can do.

<Frame caption="Settings > AI providers — the connected providers, each with its base URL and the size of its model list.">

![The AI providers settings page listing one connected provider, OpenRouter, with its base URL and a count of 52 models, beside an Add provider button and the model-catalog sync controls.](/images/get-started/settings-providers.webp)

</Frame>

## What the list shows

Open **Settings > AI providers** and you land on the providers the org has connected. Each row names the provider and shows whether its API key is configured. Clicking a row opens the provider's drawer: its base URL and key, its **Default Models**, and the **Models** list itself — searchable, with the capability tags that decide where each model can be used.

The drawer is where all the per-provider work happens. The list view is deliberately thin; the depth is one click in.

## Adding a provider

Click **Add provider**. **Start from a known provider** picks OpenAI, Anthropic, or OpenRouter and fills in the provider name and base URL — the only thing left to add is your API key. Editing the name or base URL by hand switches the picker back to **Custom**, the manual path: a provider is a **base URL** plus an **API key** — a direct vendor's own endpoint, OpenRouter (`https://openrouter.ai/api/v1`) for the widest catalog, or a local Ollama or vLLM server on your network. The key is stored encrypted and used only to call that provider.

Once the credential lands, populate the model list: **Fetch models** pulls the list the provider's API reports, **Add model** declares one by hand, and — once the org's model catalog has synced — picking a model from the catalog inside that dialog fills its ID and known capabilities (context window, pricing, reasoning) instead of typing them. No model is callable until it is in the provider's list with the right capability tag.

For OpenAI, Anthropic, and OpenRouter, the base URL stays locked to the published endpoint even after the provider is created — open the row's drawer, click **Edit** under **General**, and the field shows read-only with an **Override base URL** button beside it. Reach for the override only to point that provider's slug at a compatible proxy or regional mirror; every other provider's base URL is editable directly, no override needed.

## The model list and capability tags

Each model carries one or more capability tags — **Chat**, **Vision**, **Embedding**, **Transcription**, **Text-to-speech**, **Image generation**, **Image edit**. The tags are load-bearing: they decide which pickers a model appears in and which platform capability may call it. A model with no matching tag never appears where that capability is needed.

**Hidden from model pickers** takes a model out of the chat and agent model selection while leaving it fully usable by agents and workflows that already reference it. That is how a superseded or deprecated version retires without breaking the agents bound to it.

## Default models

The **Default Models** card names which model each capability uses when nothing more specific is bound — the chat default for new chats and new agents, plus the vision, embedding, image-generation, and transcription defaults the background services use. Changing a default affects new objects only; existing chats and agents keep the model they were bound to. Reach for the defaults when you roll out a new generation of model across the org without re-editing every agent.

## Keeping the catalog fresh

Two controls keep the catalog current without hand-editing. The **Model catalog** card refreshes each model's capabilities — pricing, context window, reasoning, vision — from OpenRouter's public catalog daily. The **Weekly auto-sync of provider config** toggle merges newly released flagship versions into the org's provider config once a week, hides superseded ones, and leaves any field you customized untouched.

## Where this fits

Providers are the bottom of the stack — every agent, every chat, every workflow step that produces text resolves through them. The catalogue of what each provider ships and which tags they carry lives in [Models](/platform/models); the file-based form of the same configuration lives under [Configuration → providers](/self-hosted/configuration/providers); and [Agent concepts](/platform/agents/concepts) covers how the model knob fits into the four-knob model an agent is built from.
