---
title: Models out of the box
description: Which provider and models a fresh Tale instance ships with — OpenRouter covers chat, vision, embeddings, voice, and image generation through a single key.
---

A fresh Tale instance ships with one provider configured: **OpenRouter**, covering chat, vision, embeddings, speech-to-text, text-to-speech, and image generation. The default agents in `examples/default/agents/` reach for OpenRouter models, and most teams stay on the defaults for weeks before swapping anything. One key, one rate limit, one bill — and you can still add a direct vendor (OpenAI, a local Ollama/vLLM server, a Bedrock proxy) whenever a workload needs it. This page lists what is shipped and links to the full catalogue.

Models drift faster than docs. The lists below are correct at the time `examples/default/providers/openrouter.json` was written; the canonical truth is the JSON file, and the canonical "what is reachable today" is what the **Settings > Providers** page shows on your instance.

## The default provider

| Provider       | Default role                                                               | Why this one                                                                                                                              | Documentation                                        |
| -------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **OpenRouter** | Chat, vision, embeddings, speech-to-text, text-to-speech, image generation | One key reaches dozens of frontier and open-weight models — plus audio and image models — with consistent pricing and a single rate limit | [openrouter.ai/models](https://openrouter.ai/models) |

OpenRouter is an OpenAI-compatible endpoint Tale calls over HTTPS with a bearer token. You can replace it (or add more providers alongside it, including a local Ollama or vLLM server) by editing the JSON under your instance's `TALE_CONFIG_DIR/<orgSlug>/providers/` — under the org-first layout, provider catalogs are per-org (each org's subtree holds its own `providers/` directory).

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

The full and live catalogue lives at [openrouter.ai/models](https://openrouter.ai/models). Any model OpenRouter exposes can be added to your instance by editing the `models` array in `<orgSlug>/providers/openrouter.json` under `TALE_CONFIG_DIR` (per-org under the org-first layout).

## OpenRouter — speech-to-text and text-to-speech

The same OpenRouter key covers the audio loop that [voice mode](/platform/chat/voice-mode) needs:

- **openai/whisper-1** — speech-to-text. The transcription provider whenever a user records a message. The shipped config sets `transcriptionMode: "json-base64"`, which selects OpenRouter's audio-transcription request shape.
- **openai/gpt-4o-mini-tts-2025-12-15** — text-to-speech. The default voice provider for agent replies played back as audio, with locale-mapped voices.

TTS model versions are dated and rotate, so confirm the current slug on the **Speech-to-Text** and **Text-to-Speech** collections at [openrouter.ai/models](https://openrouter.ai/models) and update the `id` plus the matching `defaults` entry together if it changes. Prefer calling Whisper or gpt-4o-mini-tts directly against OpenAI instead? Add an `openai.json` provider pointed at `https://api.openai.com/v1` and leave `transcriptionMode` unset (the default `multipart` shape is what OpenAI expects).

## OpenRouter — image generation

Image generation and editing run through OpenRouter's `/chat/completions` multimodal path. The default image model is FLUX.2 [pro]; the shipped list:

- **Black Forest Labs** — FLUX.2 [max], FLUX.2 [pro], FLUX.2 [flex] — each generates and edits (reference-image) images.
- **Google** — Nano Banana (Gemini 2.5 Flash Image) — generation plus reference-image editing.

The wider catalogue is at [openrouter.ai/models](https://openrouter.ai/models) (Image collection).

## Swapping or adding providers

OpenRouter is the default, not a requirement. Replace it with a different OpenAI-compatible endpoint, or add more providers alongside it, by editing the JSON in `TALE_CONFIG_DIR/<orgSlug>/providers/` — point a file at your own API, set its `models` array, and Tale reloads on next start. A local Ollama instance, a private vLLM cluster, a direct OpenAI contract, or a Bedrock proxy all fit the same shape. The mechanics live under [Configuration → providers](/self-hosted/configuration/providers); the admin-UI form for the same config lives at [Providers](/platform/admin/providers).

## Where this fits

Models are the layer beneath every agent, every chat reply, every voice output, and every image the platform renders. The next read that matters depends on what you came to do — [Agent concepts](/platform/agents/concepts) walks how a model is bound to an agent's other three knobs, and [Arena Mode](/platform/chat/arena-mode) is the workflow to pick a default when more than one model could do the job.
