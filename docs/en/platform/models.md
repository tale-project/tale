---
title: Models out of the box
description: Which providers and models a fresh Tale instance ships with — OpenRouter for chat and vision, OpenAI for voice, Vercel AI Gateway for image generation.
---

A fresh Tale instance ships with three providers configured: OpenRouter for chat, vision, and embeddings; OpenAI for speech-to-text and text-to-speech; Vercel AI Gateway for image generation. The default agents in `examples/default/agents/` reach for models in one of those three buckets, and most teams stay on the defaults for weeks before swapping anything. This page lists what is shipped and links to each provider's full catalogue.

Models drift faster than docs. The lists below are correct at the time `examples/default/providers/*.json` was written; the canonical truth is the JSON files, and the canonical "what is reachable today" is what the **Settings > Providers** page shows on your instance.

## The three providers

| Provider              | Default role                   | Why this one                                                                                              | Documentation                                                                  |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **OpenRouter**        | Chat, vision, embeddings       | One key reaches dozens of frontier and open-weight models with consistent pricing and a single rate limit | [openrouter.ai/models](https://openrouter.ai/models)                           |
| **OpenAI**            | Speech-to-text, text-to-speech | Whisper is the practical baseline for transcription; gpt-4o-mini-tts is the cheapest reliable TTS         | [platform.openai.com/docs/models](https://platform.openai.com/docs/models)     |
| **Vercel AI Gateway** | Image generation               | One OpenAI-compatible endpoint covers FLUX, Imagen, and Nano Banana without per-vendor keys               | [vercel.com/docs/ai-gateway/models](https://vercel.com/docs/ai-gateway/models) |

Every provider above is an OpenAI-compatible endpoint Tale calls over HTTPS with a bearer token. You can replace any of them with a different provider (including a local Ollama or vLLM server) by editing the matching JSON under your instance's `TALE_CONFIG_DIR/providers/`.

## OpenRouter — chat, vision, embeddings

OpenRouter is a multi-model gateway. The shipped config picks `deepseek-v4-flash` as the default chat model, `qwen3-vl-32b-instruct` for vision, and `qwen3-embedding-8b` for embeddings — all picked for the speed-to-quality ratio at the moment of writing. The full ship list:

- **Anthropic** — Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5.
- **OpenAI** — GPT-5.2 Pro, GPT-5.2, GPT-5.2 Instant, GPT-OSS 120B (the open-weight release).
- **Google** — Gemini 3 Pro, Gemini 3 Flash, Gemma 4 31B IT, Gemma 4 26B A4B IT, Nano Banana (Gemini 2.5 Flash Image).
- **DeepSeek** — DeepSeek V4 Pro, DeepSeek V4 Flash.
- **Moonshot AI** — Kimi K2.6, Kimi K2.5.
- **MiniMax** — MiniMax M2.7.
- **NVIDIA** — Nemotron 3 Super 120B.
- **Qwen** — Qwen3.6 Max Preview, Qwen3.6 Plus, Qwen3.6 Flash, Qwen3.6 35B A3B, Qwen3.5 397B A17B, Qwen3 Coder 480B, Qwen3 235B A22B, Qwen3 VL 32B, Qwen3 Embedding 8B.
- **Z.AI** — GLM 5.1, GLM 5 Turbo, GLM 5V Turbo.
- **Mistral** — Mistral Large 3, Mistral Medium 3.
- **Xiaomi** — MiMo V2.5 Pro.
- **Meta** — LLaMA 4 Maverick, LLaMA 4 Scout.
- **Black Forest Labs** — FLUX.2 [max], FLUX.2 [pro], FLUX.2 [flex].

The full and live catalogue lives at [openrouter.ai/models](https://openrouter.ai/models). Any model OpenRouter exposes can be added to your instance by editing the `models` array in `providers/openrouter.json` under `TALE_CONFIG_DIR`.

## OpenAI — speech-to-text and text-to-speech

The shipped OpenAI provider config is intentionally narrow — voice only. The two models cover the loop that [voice mode](/platform/chat/voice-mode) needs:

- **whisper-1** — speech-to-text. The transcription provider whenever a user records a message.
- **gpt-4o-mini-tts** — text-to-speech. The default voice provider for agent replies played back as audio.

Add chat and vision models to the OpenAI provider config if you want to call them directly without going through OpenRouter — useful for teams already on an OpenAI Enterprise contract. The full model list lives at [platform.openai.com/docs/models](https://platform.openai.com/docs/models).

## Vercel AI Gateway — image generation

The Vercel AI Gateway exposes image-generation endpoints from multiple vendors over a single OpenAI-compatible URL. The default image model is FLUX.2 [pro]; the shipped list:

- **Black Forest Labs** — FLUX 2 [pro], FLUX 1.1 [pro] Ultra, FLUX.1 Kontext Pro, FLUX.1 Kontext Max.
- **Google** — Imagen 4, Imagen 4 Fast, Imagen 4 Ultra, Nano Banana (Gemini 2.5 Flash Image).

The wider catalogue is at [vercel.com/docs/ai-gateway/models](https://vercel.com/docs/ai-gateway/models).

## Swapping or adding providers

The three providers above are defaults, not requirements. Replace any of them with a different OpenAI-compatible endpoint by editing the JSON in `TALE_CONFIG_DIR/providers/` — point it at your own API, change the `models` array, and Tale reloads on next start. A local Ollama instance, a private vLLM cluster, or a Bedrock proxy all fit the same shape. The mechanics live under [Configuration → providers](/self-hosted/configuration/providers); the admin-UI form for the same config lives at [Providers](/platform/admin/providers).

## Where this fits

Models are the layer beneath every agent, every chat reply, every voice output, and every image the platform renders. The next read that matters depends on what you came to do — [Agent concepts](/platform/agents/concepts) walks how a model is bound to an agent's other three knobs, and [Arena Mode](/platform/chat/arena-mode) is the workflow to pick a default when more than one model could do the job.
