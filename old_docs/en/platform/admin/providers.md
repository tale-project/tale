---
title: AI providers
description: Connect Tale to AI models through OpenAI-compatible providers — manage the catalogue from the Settings UI, mix vendor APIs, gateways, and self-hosted inference under one roof.
---

Tale talks to AI models through **providers** — each provider is an OpenAI-compatible API endpoint together with a catalogue of model definitions. The endpoint can be a hosted vendor (OpenAI, Anthropic via OpenRouter, Google), a routing gateway (OpenRouter, Vercel AI Gateway), or a self-hosted inference server (Ollama, vLLM, LocalAI, faster-whisper-server). A provider exposes _what_ models exist and _how_ they can be used — chat, vision, embedding, image generation, image edit, transcription. Admins manage providers from **Settings > Providers**; users then see the resulting models in the chat model picker and in agent configuration.

Tale ships with an [OpenRouter](https://openrouter.ai) example provider that gives access to models from OpenAI, Anthropic, Google, Mistral, Meta, and others through a single API key — the fastest path from a fresh install to a working chat. Members, Editors, and Developers cannot edit providers; the screen is Admin-only.

## Manage providers in Settings

Open **Settings > Providers**. The list view lets Admins:

- **Add provider** — opens the create dialog. Name, display name, base URL, API key, and one or more models. Each model carries an ID (must match what the endpoint accepts), a display name, an optional description, and one or more tags.
- **Edit provider** — split into **Edit details** (display name, description, base URL), **Edit defaults** (the default model per capability — see below), the API key, and the model catalogue.
- **Delete provider** — drops the provider entirely. Agents that still reference one of its models surface a warning until the agent is repointed.
- **Test connection** — sends a tiny request to every model in the catalogue and reports per-model latency and reachability. Use it after rotating an API key or pointing the base URL at a new endpoint.

The **Description** field shown in the provider list is for human consumption — for example, `OpenAI — Whisper for speech-to-text` makes the catalogue self-explanatory when a team mixes several. **Default models** per capability decide which model is used for chat, vision, embedding, image generation, image edit, and transcription when a user or agent does not pick one explicitly.

## Model tags

Every model belongs to one or more tags. The tag drives where the model can be picked.

| Tag                | Where the model is offered                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `chat`             | The chat model selector and agent `supportedModels`.                                                                                 |
| `vision`           | Eligible for messages that include image attachments.                                                                                |
| `embedding`        | Used by the [knowledge base](/platform/workspace/knowledge-base) for document retrieval.                                             |
| `image-generation` | Used by image-generation agents (`/v1/images/generations` or `/v1/chat/completions` with image content parts, per the model's mode). |
| `image-edit`       | Used by image-edit agents.                                                                                                           |
| `transcription`    | Transcribes audio and video chat uploads — see [Chat attachments](/platform/chat/attachments#audio-and-video-transcription).         |

A single provider can mix tags — one OpenAI provider can expose `chat`, `vision`, and `transcription` models side by side. Models without any tag are invisible to the rest of the product, so the catalogue is opt-in per capability.

## How models reach chat

Providers define what models _exist_. Agents define which of those models they _can run on_. Open the agent in **Agents > (agent name)** and add model IDs to its **Model** section; only models present in at least one provider _and_ listed on the agent appear in the chat model selector. The default chat agent ships pre-configured with the OpenRouter example models; custom agents start empty so the catalogue stays explicit.

For how the selector behaves when two providers define the same model ID, and for the pinning syntax that lets agents prefer a specific provider, see the on-disk reference linked below.

## Provider options (advanced)

The **Provider options** panel forwards a free-form JSON object as extra request body fields on every model call. Tale does not interpret the JSON — it passes it through verbatim — so the shape is dictated by the upstream API. Gateways and direct vendors expose different kinds of knobs:

- **OpenRouter (gateway)** — routing controls under a top-level `provider` key:

  ```json
  { "provider": { "quantizations": ["fp8"], "allow_fallbacks": false } }
  ```

- **Vercel AI Gateway (gateway)** — primarily routes via model-ID prefix and HTTP headers; body-level passthrough is limited to observability fields like `metadata`:

  ```json
  { "metadata": { "tale_agent": "support" } }
  ```

- **OpenAI (direct)** — model-behaviour knobs at the body's top level:

  ```json
  { "service_tier": "priority", "parallel_tool_calls": false }
  ```

- **Together AI (direct)** — moderation and decoding knobs at the top level:

  ```json
  { "safety_model": "meta-llama/Llama-Guard-4-12B", "repetition_penalty": 1.1 }
  ```

Direct vendors do not expose `quantizations` as a request field — the precision is fixed at deploy time, so pick a different model ID instead. Keys like `model`, `messages`, `max_tokens`, and `temperature` are rejected at this layer because they belong on the agent, not on the provider.

The same panel exists at the model level — the model-level JSON is merged on top of the provider-level defaults, so a per-model override does not require duplicating the shared object.

## Self-hosted instances: configuration as files

Self-hosted operators can manage providers through JSON config files in addition to the UI — useful for infrastructure-as-code workflows, bulk edits, or deployments where the UI is not reachable. The UI and the files stay in sync; saving from **Settings > Providers** writes the same JSON. Secrets can be SOPS-encrypted on disk while still being editable from the UI.

For the file schema, the bundled example providers, the self-hosted inference backends (Ollama, vLLM, LocalAI, faster-whisper-server), Docker host networking, and the provider-pinning syntax, see [Providers — configuration reference](/self-hosted/configuration/providers).

## Where this fits

Providers are the gate between Tale and the AI models the rest of the organisation talks to. An agent picks a model preset (Fast, Standard, Advanced); each preset is bound to a specific model defined on a provider. Adding a provider extends the menu; changing a default redirects every agent that has not explicitly opted into a model.

The UI surface this page describes is the same one Cloud Admins use. Self-hosted operators have the choice between the UI and the JSON file form documented at [Providers — configuration reference](/self-hosted/configuration/providers). Once the provider list is settled, the model presets each agent uses live on the agent itself — see [Create an agent](/platform/agents/create) for the agent-side configuration.
