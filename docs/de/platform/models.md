---
title: Modelle out of the box
description: Welche Provider und Modelle eine frische Tale-Instanz mitbringt — OpenRouter deckt Chat, Vision, Embeddings, Sprache und Bildgenerierung über einen einzigen Key ab.
---

Eine frische Tale-Instanz bringt einen konfigurierten Provider mit: **OpenRouter**, der Chat, Vision, Embeddings, Speech-to-Text, Text-to-Speech und Bildgenerierung abdeckt. Die Default-Agents in `builtin-configs/agents/` greifen auf OpenRouter-Modelle zu, und die meisten Teams bleiben wochenlang bei den Defaults, bevor sie etwas tauschen. Ein Key, ein Rate-Limit, eine Rechnung — und du kannst trotzdem jederzeit einen Direkt-Anbieter (OpenAI, einen lokalen Ollama-/vLLM-Server, einen Bedrock-Proxy) hinzufügen, wenn eine Workload es braucht. Diese Seite listet, was ausgeliefert wird, und verlinkt auf den vollen Katalog.

Modelle driften schneller als Docs. Die Listen unten stimmen zum Zeitpunkt, an dem `builtin-configs/providers/openrouter.json` geschrieben wurde; die kanonische Wahrheit ist die JSON-Datei, und das kanonische „was heute erreichbar ist" zeigt die Seite **Einstellungen > Provider** auf deiner Instanz.

## Der Default-Provider

| Provider       | Default-Rolle                                                             | Warum genau dieser                                                                                                                                  | Dokumentation                                        |
| -------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **OpenRouter** | Chat, Vision, Embeddings, Speech-to-Text, Text-to-Speech, Bildgenerierung | Ein Key erreicht Dutzende Frontier- und Open-Weight-Modelle — plus Audio- und Bildmodelle — mit einheitlichem Pricing und einem einzigen Rate-Limit | [openrouter.ai/models](https://openrouter.ai/models) |

OpenRouter ist ein OpenAI-kompatibler Endpunkt, den Tale per HTTPS mit Bearer-Token aufruft. Du kannst ihn ersetzen (oder weitere Provider daneben hinzufügen, auch einen lokalen Ollama- oder vLLM-Server), indem du die JSON unter `TALE_CONFIG_DIR/<orgSlug>/providers/` deiner Instanz bearbeitest — unter dem org-first Layout sind Provider-Kataloge pro Org (jede Org hat ihren eigenen `providers/`-Unterbaum).

## OpenRouter — Chat, Vision, Embeddings

OpenRouter ist ein Multi-Modell-Gateway. Die ausgelieferte Konfiguration wählt `deepseek-v4-flash` als Default-Chat-Modell, `qwen3-vl-32b-instruct` für Vision und `qwen3-embedding-8b` für Embeddings — alle wegen des Geschwindigkeits-zu-Qualität-Verhältnisses zum Zeitpunkt des Schreibens. Die volle Lieferliste unten umfasst jedes sichtbare Modell der ausgelieferten `openrouter.json` und wird vom wöchentlichen Katalog-Job neu generiert, damit sie nie von der Konfiguration abweicht:

<!-- MODELS_TABLE:START -->

<!-- Auto-generated from builtin-configs/providers/openrouter.json by the weekly model-catalog sync. Do not edit by hand. -->

| Anbieter          | Modell                               | Fähigkeiten                  | Kontext | Eingabe ($/M) | Ausgabe ($/M) |
| ----------------- | ------------------------------------ | ---------------------------- | ------- | ------------- | ------------- |
| AI21              | Jamba Large 1.7                      | chat                         | 256K    | 2.00          | 8.00          |
| Amazon            | Nova Premier                         | chat, vision                 | 1M      | 2.50          | 12.50         |
| Amazon            | Nova 2 Lite                          | chat, vision                 | 1M      | 0.30          | 2.50          |
| Anthropic         | Claude Sonnet 4.6                    | chat, vision                 | 1M      | 3.00          | 15.00         |
| Anthropic         | Claude Haiku 4.5                     | chat                         | 200K    | 1.00          | 5.00          |
| Anthropic         | Claude Opus 4.8                      | chat, vision                 | 1M      | 5.00          | 25.00         |
| Black Forest Labs | FLUX.2 [flex]                        | image-generation, image-edit | —       | —             | —             |
| Black Forest Labs | FLUX.2 [max]                         | image-generation, image-edit | —       | —             | —             |
| Black Forest Labs | FLUX.2 [pro]                         | image-generation, image-edit | —       | —             | —             |
| Cohere            | Command A                            | chat                         | 256K    | 2.50          | 10.00         |
| Cohere            | Command R                            | chat                         | 128K    | 0.15          | 0.60          |
| DeepSeek          | DeepSeek V4 Pro                      | chat                         | 1M      | 0.43          | 0.87          |
| DeepSeek          | DeepSeek V4 Flash                    | chat                         | 1M      | 0.09          | 0.18          |
| Google            | Gemini 3 Pro                         | chat, vision                 | 1M      | 2.00          | 12.00         |
| Google            | Gemini 3 Flash                       | chat, vision                 | 1M      | 0.50          | 3.00          |
| Google            | Gemma 4 31B IT                       | chat, vision                 | 262K    | 0.12          | 0.35          |
| Google            | Gemma 4 26B A4B IT                   | chat, vision                 | 262K    | 0.06          | 0.33          |
| Google            | Nano Banana (Gemini 2.5 Flash Image) | image-generation, image-edit | 33K     | 0.30          | 2.50          |
| Liquid            | LFM2 24B                             | chat                         | 128K    | 0.03          | 0.12          |
| Meta              | LLaMA 4 Maverick                     | chat                         | 1M      | 0.15          | 0.60          |
| Meta              | LLaMA 4 Scout                        | chat                         | 10M     | 0.10          | 0.30          |
| Microsoft         | Phi-4                                | chat                         | 16K     | 0.07          | 0.14          |
| MiniMax           | MiniMax M3                           | chat, vision                 | 1M      | 0.30          | 1.20          |
| Mistral           | Mistral Large 3                      | chat                         | 262K    | 0.50          | 1.50          |
| Mistral           | Mistral Medium 3.5                   | chat, vision                 | 262K    | 1.50          | 7.50          |
| Moonshot AI       | Kimi K2.6                            | chat, vision                 | 262K    | 0.68          | 3.41          |
| Moonshot AI       | Kimi K2.7 Code                       | chat, vision                 | 262K    | 0.61          | 3.07          |
| NVIDIA            | Nemotron 3 Ultra                     | chat                         | 1M      | 0.50          | 2.20          |
| NVIDIA            | Nemotron 3 Super                     | chat                         | 1M      | 0.09          | 0.45          |
| OpenAI            | GPT-OSS 120B                         | chat                         | 131K    | 0.04          | 0.18          |
| OpenAI            | GPT-4o mini TTS                      | text-to-speech               | —       | —             | —             |
| OpenAI            | GPT-5.3 Chat                         | chat, vision                 | 128K    | 1.75          | 14.00         |
| OpenAI            | GPT-5.5                              | chat, vision                 | 1M      | 5.00          | 30.00         |
| OpenAI            | GPT-5.5 Pro                          | chat, vision                 | 1M      | 30.00         | 180.00        |
| OpenAI            | Whisper v1                           | transcription                | —       | —             | —             |
| Perplexity        | Sonar Pro                            | chat, vision                 | 200K    | 3.00          | 15.00         |
| Perplexity        | Sonar                                | chat, vision                 | 127K    | 1.00          | 1.00          |
| Qwen              | Qwen3.6 Max Preview                  | chat                         | 262K    | 1.04          | 6.24          |
| Qwen              | Qwen3 Coder 480B                     | chat                         | 1M      | 0.22          | 1.80          |
| Qwen              | Qwen3 VL 32B                         | chat, vision                 | 262K    | 0.10          | 0.42          |
| Qwen              | Qwen3.6 Flash                        | chat, vision                 | 1M      | 0.19          | 1.13          |
| Qwen              | Qwen3 Embedding 8B                   | embedding                    | —       | 0.01          | 0.00          |
| Qwen              | Qwen3.7 Plus                         | chat, vision                 | 1M      | 0.32          | 1.28          |
| Reka              | Reka Flash 3                         | chat                         | 66K     | 0.10          | 0.20          |
| Xiaomi            | MiMo V2.5 Pro                        | chat                         | 1M      | 0.43          | 0.87          |
| Z.AI              | GLM 5.1                              | chat                         | 203K    | 0.98          | 3.08          |
| Z.AI              | GLM 5 Turbo                          | chat                         | 262K    | 1.20          | 4.00          |
| Z.AI              | GLM 5V Turbo                         | chat, vision                 | 131K    | 1.20          | 4.00          |
| xAI               | Grok 4.20                            | chat, vision                 | 2M      | 1.25          | 2.50          |

<!-- MODELS_TABLE:END -->

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
