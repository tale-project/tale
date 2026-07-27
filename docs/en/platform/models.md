---
title: Model catalog
description: The model catalog behind every picker in Tale — where it lives under Settings > AI providers, what the capability tags mean, which defaults ship, and how the list stays fresh.
---

Every model picker in Tale — the chat's model menu, an agent's model binding, the defaults the crawler and RAG services use — draws from one catalog: the models declared on your organisation's AI providers. A fresh instance ships with a single provider, **OpenRouter**, whose one key covers chat, vision, embeddings, transcription, text-to-speech, and image generation. This page is the reference for where that catalog lives in the UI, what the tags on each model mean, and what ships out of the box.

<Frame caption="The provider drawer's model list — each model carries the capability tags that decide which pickers it appears in.">

![The provider details drawer under Settings > AI providers, showing a searchable model list where each row carries capability tags such as Chat and Image generation, with Fetch models, Sync from catalog, and Add model actions above it.](/images/platform/settings-provider-models.webp)

</Frame>

## Where the catalog lives

Open **Settings > AI providers** and click a provider row. The drawer lists everything the provider declares: its base URL and API key, its **Default Models**, and the **Models** list itself — searchable, with **Show more** past the first ten. **Add model** declares a new entry by hand; **Fetch models** pulls the list the provider's API reports. Models an admin marks as **Hidden from model pickers** stay resolvable for existing bindings but stop appearing in menus — that is how superseded versions retire without breaking old agents.

Each model carries one or more capability tags: **Chat**, **Vision**, **Embedding**, **Transcription**, **Text-to-speech**, **Image generation**, **Image edit**. The tags are load-bearing — they decide which pickers a model shows up in and which platform capability is allowed to call it. A model with no matching tag never appears where that capability is needed.

## The shipped defaults

The **Default Models** card names which model each background capability uses when nothing more specific is bound:

| Capability       | Shipped default    |
| ---------------- | ------------------ |
| Chat             | DeepSeek V4 Flash  |
| Vision           | Qwen3 VL 32B       |
| Embedding        | Qwen3 Embedding 8B |
| Image generation | FLUX.2 [pro]       |
| Transcription    | Whisper v1         |

Text-to-speech for [voice mode](/platform/chat/voice-mode) ships on OpenAI's GPT-4o mini TTS through the same OpenRouter key, and [image generation](/platform/agents/image-generation) defaults to FLUX.2 [pro].

## How the list stays fresh

Models drift faster than docs. Two mechanisms on the **AI providers** page keep the catalog current: the **Model catalog** card refreshes model capabilities — pricing, context window, reasoning, vision — from OpenRouter's public catalog daily, and the **Weekly auto-sync of provider config** toggle merges newly released flagship versions into the org's provider config once a week, hiding superseded ones and leaving any field you customised untouched.

The shipped list below is regenerated from the same source, so it matches what a fresh instance sees:

<!-- MODELS_TABLE:START -->

<!-- Auto-generated from builtin-configs/providers/openrouter.json by the weekly model-catalog sync. Do not edit by hand. -->

| Provider | Model | Capabilities | Context | Input ($/M) | Output ($/M) |
| --- | --- | --- | --- | --- | --- |
| AI21 | Jamba Large 1.7 | chat | 256K | 2.00 | 8.00 |
| Amazon | Nova Premier | chat, vision | 1M | 2.50 | 12.50 |
| Amazon | Nova 2 Lite | chat, vision | 1M | 0.30 | 2.50 |
| Anthropic | Claude Fable (latest) | chat, vision | 1M | 10.00 | 50.00 |
| Anthropic | Claude Fable 5 | chat, vision | 1M | 10.00 | 50.00 |
| Anthropic | Claude Haiku 4.5 | chat | 200K | 1.00 | 5.00 |
| Anthropic | Anthropic: Claude Sonnet 5 | chat, vision | 1M | 2.00 | 10.00 |
| Anthropic | Claude Opus 5 | chat, vision | 1M | 5.00 | 25.00 |
| Black Forest Labs | FLUX.2 [flex] | image-generation, image-edit | — | — | — |
| Black Forest Labs | FLUX.2 [max] | image-generation, image-edit | — | — | — |
| Black Forest Labs | FLUX.2 [pro] | image-generation, image-edit | — | — | — |
| Cohere | Command A | chat | 256K | 2.50 | 10.00 |
| Cohere | Command R | chat | 128K | 0.15 | 0.60 |
| DeepSeek | DeepSeek V4 Pro | chat | 1M | 0.43 | 0.87 |
| DeepSeek | DeepSeek V4 Flash | chat | 1M | 0.14 | 0.28 |
| Google | Gemini 3 Pro | chat, vision | 1M | 2.00 | 12.00 |
| Google | Gemini 3 Flash | chat, vision | 1M | 0.50 | 3.00 |
| Google | Gemma 4 31B IT | chat, vision | 262K | 0.14 | 0.40 |
| Google | Gemma 4 26B A4B IT | chat, vision | 262K | 0.12 | 0.35 |
| Google | Nano Banana (Gemini 2.5 Flash Image) | image-generation, image-edit | 33K | 0.30 | 2.50 |
| Liquid | LFM2 24B | chat | 128K | 0.03 | 0.12 |
| Meta | LLaMA 4 Maverick | chat | 1M | 0.20 | 0.80 |
| Meta | LLaMA 4 Scout | chat | 1M | 0.10 | 0.30 |
| Microsoft | Phi-4 | chat | 16K | 0.07 | 0.14 |
| MiniMax | MiniMax M3 | chat, vision | 1M | 0.30 | 1.20 |
| Mistral | Mistral Large 3 | chat | 262K | 0.50 | 1.50 |
| Mistral | Mistral Medium 3.5 | chat, vision | 262K | 1.50 | 7.50 |
| Moonshot AI | Kimi K2.7 Code | chat, vision | 262K | 0.73 | 3.50 |
| Moonshot AI | MoonshotAI: Kimi K3 | chat, vision | 1M | 3.00 | 15.00 |
| NVIDIA | Nemotron 3 Ultra | chat | 512K | 0.50 | 2.20 |
| NVIDIA | Nemotron 3 Super | chat | 1M | 0.09 | 0.40 |
| OpenAI | GPT-OSS 120B | chat | 131K | 0.04 | 0.17 |
| OpenAI | GPT-4o mini TTS | text-to-speech | — | — | — |
| OpenAI | GPT-5.3 Chat | chat, vision | 128K | 1.75 | 14.00 |
| OpenAI | GPT-5.5 | chat, vision | 1M | 5.00 | 30.00 |
| OpenAI | GPT-5.5 Pro | chat, vision | 1M | 30.00 | 180.00 |
| OpenAI | Whisper v1 | transcription | — | — | — |
| Perplexity | Sonar Pro | chat, vision | 200K | 3.00 | 15.00 |
| Perplexity | Sonar | chat, vision | 127K | 1.00 | 1.00 |
| Qwen | Qwen3.6 Max Preview | chat | 262K | 1.04 | 6.24 |
| Qwen | Qwen3 Coder 480B | chat | 262K | 0.30 | 1.00 |
| Qwen | Qwen3 VL 32B | chat, vision | 131K | 0.10 | 0.42 |
| Qwen | Qwen3.6 Flash | chat, vision | 1M | 0.19 | 1.13 |
| Qwen | Qwen3 Embedding 8B | embedding | — | 0.01 | 0.00 |
| Qwen | Qwen3.7 Plus | chat, vision | 1M | 0.32 | 1.28 |
| Reka | Reka Flash 3 | chat | 66K | 0.10 | 0.20 |
| Xiaomi | MiMo V2.5 Pro | chat | 1M | 0.43 | 0.87 |
| Z.AI | GLM 5.2 | chat | 1M | 0.82 | 2.57 |
| Z.AI | GLM 5 Turbo | chat | 203K | 1.20 | 4.00 |
| Z.AI | GLM 5V Turbo | chat, vision | 203K | 1.20 | 4.00 |
| xAI | Grok 4.20 | chat, vision | 2M | 1.25 | 2.50 |

<!-- MODELS_TABLE:END -->

The full and live catalogue lives at [openrouter.ai/models](https://openrouter.ai/models); any model OpenRouter exposes can be added to your instance from the same drawer.

## Where this fits

Models are the layer beneath every agent, every chat reply, every voice output, and every image the platform renders. OpenRouter is the default, not a requirement — adding a direct vendor, a local Ollama or vLLM server, or a second gateway is admin work covered in [Providers](/platform/admin/providers), and the file-based form of the same configuration lives under [Configuration → providers](/self-hosted/configuration/providers). For picking between chat models when more than one could do the job, [Arena Mode](/platform/chat/arena-mode) is the workflow built for exactly that question.
