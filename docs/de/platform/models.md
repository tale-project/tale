---
title: Modelle out of the box
description: Welche Provider und Modelle eine frische Tale-Instanz mitbringt — OpenRouter deckt Chat, Vision, Embeddings, Sprache und Bildgenerierung über einen einzigen Key ab.
---

Eine frische Tale-Instanz bringt einen konfigurierten Provider mit: **OpenRouter**, der Chat, Vision, Embeddings, Speech-to-Text, Text-to-Speech und Bildgenerierung abdeckt. Die Default-Agents in `examples/default/agents/` greifen auf OpenRouter-Modelle zu, und die meisten Teams bleiben wochenlang bei den Defaults, bevor sie etwas tauschen. Ein Key, ein Rate-Limit, eine Rechnung — und du kannst trotzdem jederzeit einen Direkt-Anbieter (OpenAI, einen lokalen Ollama-/vLLM-Server, einen Bedrock-Proxy) hinzufügen, wenn eine Workload es braucht. Diese Seite listet, was ausgeliefert wird, und verlinkt auf den vollen Katalog.

Modelle driften schneller als Docs. Die Listen unten stimmen zum Zeitpunkt, an dem `examples/default/providers/openrouter.json` geschrieben wurde; die kanonische Wahrheit ist die JSON-Datei, und das kanonische „was heute erreichbar ist" zeigt die Seite **Einstellungen > Provider** auf deiner Instanz.

## Der Default-Provider

| Provider       | Default-Rolle                                                             | Warum genau dieser                                                                                                                                  | Dokumentation                                        |
| -------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **OpenRouter** | Chat, Vision, Embeddings, Speech-to-Text, Text-to-Speech, Bildgenerierung | Ein Key erreicht Dutzende Frontier- und Open-Weight-Modelle — plus Audio- und Bildmodelle — mit einheitlichem Pricing und einem einzigen Rate-Limit | [openrouter.ai/models](https://openrouter.ai/models) |

OpenRouter ist ein OpenAI-kompatibler Endpunkt, den Tale per HTTPS mit Bearer-Token aufruft. Du kannst ihn ersetzen (oder weitere Provider daneben hinzufügen, auch einen lokalen Ollama- oder vLLM-Server), indem du die JSON unter `TALE_CONFIG_DIR/<orgSlug>/providers/` deiner Instanz bearbeitest — unter dem org-first Layout sind Provider-Kataloge pro Org (jede Org hat ihren eigenen `providers/`-Unterbaum).

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

Der volle und aktuelle Katalog lebt auf [openrouter.ai/models](https://openrouter.ai/models). Jedes Modell, das OpenRouter exponiert, kannst du auf deiner Instanz hinzufügen, indem du das `models`-Array in `<orgSlug>/providers/openrouter.json` unter `TALE_CONFIG_DIR` bearbeitest (pro Org unter dem org-first Layout).

## OpenRouter — Speech-to-Text und Text-to-Speech

Derselbe OpenRouter-Key deckt die Audio-Schleife ab, die der [Sprachmodus](/de/platform/chat/voice-mode) braucht:

- **openai/whisper-1** — Speech-to-Text. Der Transkriptions-Provider, wenn ein User eine Nachricht aufnimmt. Die ausgelieferte Konfiguration setzt `transcriptionMode: "json-base64"`, was das Audio-Transkriptions-Format von OpenRouter wählt.
- **openai/gpt-4o-mini-tts-2025-12-15** — Text-to-Speech. Der Default-Stimm-Provider für Agent-Antworten, die als Audio abgespielt werden, mit locale-zugeordneten Stimmen.

TTS-Modellversionen sind datiert und rotieren, prüf also den aktuellen Slug in den Sammlungen **Speech-to-Text** und **Text-to-Speech** auf [openrouter.ai/models](https://openrouter.ai/models) und aktualisiere die `id` plus den passenden `defaults`-Eintrag gemeinsam, falls er sich ändert. Du willst Whisper oder gpt-4o-mini-tts lieber direkt gegen OpenAI aufrufen? Füg einen `openai.json`-Provider hinzu, der auf `https://api.openai.com/v1` zeigt, und lass `transcriptionMode` ungesetzt (das Default-`multipart`-Format ist, was OpenAI erwartet).

## OpenRouter — Bildgenerierung

Bildgenerierung und -bearbeitung laufen über OpenRouters multimodalen `/chat/completions`-Pfad. Das Default-Bildmodell ist FLUX.2 [pro]; die ausgelieferte Liste:

- **Black Forest Labs** — FLUX.2 [max], FLUX.2 [pro], FLUX.2 [flex] — jedes erzeugt und bearbeitet Bilder (Referenzbild).
- **Google** — Nano Banana (Gemini 2.5 Flash Image) — Erzeugung plus Referenzbild-Bearbeitung.

Der breitere Katalog liegt auf [openrouter.ai/models](https://openrouter.ai/models) (Bild-Sammlung).

## Provider tauschen oder hinzufügen

OpenRouter ist der Default, keine Vorgabe. Ersetz ihn durch einen anderen OpenAI-kompatiblen Endpunkt, oder füg weitere Provider daneben hinzu, indem du die JSON in `TALE_CONFIG_DIR/<orgSlug>/providers/` bearbeitest — richt eine Datei auf deine eigene API, setz ihr `models`-Array, und Tale lädt beim nächsten Start neu. Eine lokale Ollama-Instanz, ein privater vLLM-Cluster, ein direkter OpenAI-Vertrag oder ein Bedrock-Proxy passen alle in dieselbe Form. Die Mechanik lebt unter [Konfiguration → Provider](/de/self-hosted/configuration/providers); das Admin-UI-Formular für dieselbe Konfiguration liegt auf [Provider](/de/platform/admin/providers).

## Wo das hineinpasst

Modelle sind die Schicht unter jedem Agent, jeder Chat-Antwort, jeder Sprachausgabe und jedem Bild, das die Plattform rendert. Welche Seite du als Nächstes liest, hängt davon ab, wozu du gekommen bist — [Agent-Konzepte](/de/platform/agents/concepts) führt durch, wie ein Modell an die anderen drei Knöpfe eines Agents gebunden wird, und [Arena-Modus](/de/platform/chat/arena-mode) ist der Workflow, um einen Default zu wählen, wenn mehr als ein Modell die Arbeit machen könnte.
