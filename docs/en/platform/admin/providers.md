---
title: AI providers
description: Connect Tale to AI models through providers — OpenAI-compatible endpoints managed from the Settings UI.
---

Tale talks to AI models through **providers** — each provider is an OpenAI-compatible API endpoint (OpenAI, OpenRouter, Anthropic via OpenRouter, Google, self-hosted Ollama, vLLM, etc.) together with a catalogue of model definitions. A provider exposes _what_ models exist and _how_ they can be used (chat, vision, embedding, image generation, transcription). Admins manage providers from **Settings > Providers** in the running app; users see the resulting models in the chat model picker and in agent configuration.

Tale ships with an [OpenRouter](https://openrouter.ai) example provider that gives access to models from OpenAI, Anthropic, Google, Mistral, Meta, and others through a single API key — the fastest way to get a chat workspace running end to end.

## Managing providers in Settings

Open **Settings > Providers**. Admins can:

- **Add a provider** with a name, display name, base URL, API key, and one or more models. Each model entry carries an ID (must match what the endpoint accepts), a display name, an optional description, and one or more tags.
- **Edit a provider** to update its display name, description, base URL, API key, default models per capability, and its model catalogue.
- **Delete a provider** to remove it entirely. Agents that still reference the provider's models show a warning until you pick a replacement.

The **description** shown in the provider list helps users understand what the provider is for (e.g. "OpenAI — Whisper for speech-to-text"). **Default models** per capability let you pre-select which model is used for chat, vision, embedding, image generation, and transcription when a user doesn't pick one explicitly.

## Model tags

Every model belongs to one or more tags. Tags control where the model shows up in the product:

| Tag                | Where the model shows up                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `chat`             | Appears in the chat model selector and can be referenced by agents' `supportedModels`.                                       |
| `vision`           | Eligible for messages that include image attachments.                                                                        |
| `embedding`        | Used by the [knowledge base](/platform/workspace/knowledge-base) for document retrieval.                                     |
| `image-generation` | Used by image-generation agents.                                                                                             |
| `image-edit`       | Used by image-edit agents.                                                                                                   |
| `transcription`    | Transcribes audio and video chat uploads — see [Chat attachments](/platform/chat/attachments#audio-and-video-transcription). |

A single provider can mix tags — one OpenAI provider can expose `chat`, `vision`, and `transcription` models side by side.

## Making models available in chat

Providers define what models _exist_. Agents define which of those models they _can run on_. Open the agent in **Agents > (agent name)** and add model IDs to its model list; only models present in at least one provider and listed on the agent appear in the chat model selector.

The default chat agent is pre-configured with the OpenRouter example models. Custom agents start empty — pick the models you want the agent to support. For how the selector behaves when two providers define the same model ID (and how pinning works), see the on-disk provider reference below.

## Self-hosted instances: configuration as files

Self-hosted operators can manage providers through JSON config files in addition to the UI — useful for infrastructure-as-code workflows, bulk edits, or deployments where the UI is not reachable. The UI and the files stay in sync; saving from **Settings > Providers** writes the same JSON.

For the file schema, bundled example providers, SOPS-encrypted secrets, self-hosted inference backends (Ollama, vLLM, LocalAI, faster-whisper-server), Docker host networking, and provider pinning syntax, see [Providers — configuration reference](/self-hosted/configuration/providers).

## Where this fits

Providers are the gate between Tale and the AI models the rest of the organisation talks to. An agent picks a model preset (Fast / Standard / Advanced); each preset is bound to a specific model defined on a provider. Adding a provider extends the menu; changing a default redirects every agent that hadn't explicitly opted into a model.

The UI surface this page describes is the same one Cloud admins use; self-hosted operators have the choice between the UI and the JSON file form documented at [Providers — configuration reference](/self-hosted/configuration/providers). Once the provider list is settled, the model presets each agent uses live on the agent itself — see [Create an agent](/platform/agents/create).
