---
title: Modelle out of the box
description: Welche Provider und Modelle eine frische Tale-Instanz mitbringt — OpenRouter für Chat und Vision, OpenAI für Sprache, Vercel AI Gateway für Bildgenerierung.
---

Eine frische Tale-Instanz bringt drei konfigurierte Provider mit: OpenRouter für Chat, Vision und Embeddings; OpenAI für Speech-to-Text und Text-to-Speech; Vercel AI Gateway für Bildgenerierung. Die Default-Agents in `examples/agents/` greifen auf Modelle in einem dieser drei Buckets zu, und die meisten Teams bleiben wochenlang bei den Defaults, bevor sie etwas tauschen. Diese Seite listet, was ausgeliefert wird, und verlinkt auf den vollen Katalog jedes Providers.

Modelle driften schneller als Docs. Die Listen unten stimmen zum Zeitpunkt, an dem `examples/providers/*.json` geschrieben wurde; die kanonische Wahrheit sind die JSON-Dateien, und das kanonische „was heute erreichbar ist" zeigt die Seite **Einstellungen > Provider** auf deiner Instanz.

## Die drei Provider

| Provider              | Default-Rolle                  | Warum genau dieser                                                                                                  | Dokumentation                                                                  |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **OpenRouter**        | Chat, Vision, Embeddings       | Ein Key erreicht Dutzende Frontier- und Open-Weight-Modelle mit einheitlichem Pricing und einem einzigen Rate-Limit | [openrouter.ai/models](https://openrouter.ai/models)                           |
| **OpenAI**            | Speech-to-Text, Text-to-Speech | Whisper ist die praktische Baseline für Transkription; gpt-4o-mini-tts ist das billigste verlässliche TTS           | [platform.openai.com/docs/models](https://platform.openai.com/docs/models)     |
| **Vercel AI Gateway** | Bildgenerierung                | Ein OpenAI-kompatibler Endpunkt deckt FLUX, Imagen und Nano Banana ab, ohne pro-Anbieter-Keys                       | [vercel.com/docs/ai-gateway/models](https://vercel.com/docs/ai-gateway/models) |

Jeder Provider oben ist ein OpenAI-kompatibler Endpunkt, den Tale per HTTPS mit Bearer-Token aufruft. Du kannst jeden durch einen anderen Provider ersetzen (auch einen lokalen Ollama- oder vLLM-Server), indem du die passende JSON unter `TALE_CONFIG_DIR/providers/` deiner Instanz bearbeitest.

## OpenRouter — Chat, Vision, Embeddings

OpenRouter ist ein Multi-Modell-Gateway. Die ausgelieferte Konfiguration wählt `deepseek-v4-flash` als Default-Chat-Modell, `qwen3-vl-32b-instruct` für Vision und `qwen3-embedding-8b` für Embeddings — alle wegen des Geschwindigkeits-zu-Qualität-Verhältnisses zum Zeitpunkt des Schreibens. Die volle Lieferliste:

- **Anthropic** — Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5.
- **OpenAI** — GPT-5.2 Pro, GPT-5.2, GPT-5.2 Instant, GPT-OSS 120B (das Open-Weight-Release).
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

Der volle und aktuelle Katalog lebt auf [openrouter.ai/models](https://openrouter.ai/models). Jedes Modell, das OpenRouter exponiert, kannst du auf deiner Instanz hinzufügen, indem du das `models`-Array in `providers/openrouter.json` unter `TALE_CONFIG_DIR` bearbeitest.

## OpenAI — Speech-to-Text und Text-to-Speech

Die ausgelieferte OpenAI-Provider-Konfiguration ist absichtlich schmal — nur Sprache. Die zwei Modelle decken die Schleife ab, die der [Sprachmodus](/de/platform/chat/voice-mode) braucht:

- **whisper-1** — Speech-to-Text. Der Transkriptions-Provider, wenn ein User eine Nachricht aufnimmt.
- **gpt-4o-mini-tts** — Text-to-Speech. Der Default-Stimm-Provider für Agent-Antworten, die als Audio abgespielt werden.

Füg der OpenAI-Provider-Konfiguration Chat- und Vision-Modelle hinzu, wenn du sie direkt aufrufen willst, ohne über OpenRouter zu gehen — nützlich für Teams, die schon einen OpenAI-Enterprise-Vertrag haben. Die volle Modell-Liste lebt auf [platform.openai.com/docs/models](https://platform.openai.com/docs/models).

## Vercel AI Gateway — Bildgenerierung

Das Vercel AI Gateway exponiert Bildgenerierungs-Endpunkte von mehreren Anbietern über eine einzige OpenAI-kompatible URL. Das Default-Bildmodell ist FLUX.2 [pro]; die ausgelieferte Liste:

- **Black Forest Labs** — FLUX 2 [pro], FLUX 1.1 [pro] Ultra, FLUX.1 Kontext Pro, FLUX.1 Kontext Max.
- **Google** — Imagen 4, Imagen 4 Fast, Imagen 4 Ultra, Nano Banana (Gemini 2.5 Flash Image).

Der breitere Katalog liegt auf [vercel.com/docs/ai-gateway/models](https://vercel.com/docs/ai-gateway/models).

## Provider tauschen oder hinzufügen

Die drei oben genannten Provider sind Defaults, keine Vorgaben. Ersetz jeden durch einen anderen OpenAI-kompatiblen Endpunkt, indem du die JSON in `TALE_CONFIG_DIR/providers/` bearbeitest — richt sie auf deine eigene API, ändere das `models`-Array, und Tale lädt beim nächsten Start neu. Eine lokale Ollama-Instanz, ein privater vLLM-Cluster oder ein Bedrock-Proxy passen alle in dieselbe Form. Die Mechanik lebt unter [Konfiguration → Provider](/de/self-hosted/configuration/providers); das Admin-UI-Formular für dieselbe Konfiguration liegt auf [Provider](/de/platform/admin/providers).

## Wo das hineinpasst

Modelle sind die Schicht unter jedem Agent, jeder Chat-Antwort, jeder Sprachausgabe und jedem Bild, das die Plattform rendert. Welche Seite du als Nächstes liest, hängt davon ab, wozu du gekommen bist — [Agent-Konzepte](/de/platform/agents/concepts) führt durch, wie ein Modell an die anderen drei Knöpfe eines Agents gebunden wird, und [Arena-Modus](/de/platform/chat/arena-mode) ist der Workflow, um einen Default zu wählen, wenn mehr als ein Modell die Arbeit machen könnte.
