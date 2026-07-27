---
title: Modellkatalog
description: Der Modellkatalog hinter jedem Picker in Tale — wo er unter Einstellungen > KI-Anbieter liegt, was die Fähigkeits-Tags bedeuten, welche Standards mitkommen und wie die Liste frisch bleibt.
---

Jeder Modell-Picker in Tale — das Modellmenü des Chats, die Modellbindung eines Agents, die Standards, die Crawler- und RAG-Dienste nutzen — zieht aus einem Katalog: den Modellen, die auf den KI-Providern deiner Organisation deklariert sind. Eine frische Instanz bringt einen einzigen Provider mit, **OpenRouter**, dessen ein Key Chat, Vision, Embeddings, Transkription, Text-to-Speech und Bildgenerierung abdeckt. Diese Seite ist die Referenz dafür, wo dieser Katalog in der UI liegt, was die Tags auf jedem Modell bedeuten und was ab Werk mitkommt.

<Frame caption="Die Modell-Liste im Provider-Drawer — jedes Modell trägt die Fähigkeits-Tags, die entscheiden, in welchen Pickern es erscheint.">

![Der Provider-Detail-Drawer unter Einstellungen > KI-Anbieter, mit einer durchsuchbaren Modell-Liste, in der jede Zeile Fähigkeits-Tags wie Chat und Bildgenerierung trägt, darüber die Aktionen Modelle abrufen, Aus Katalog synchronisieren und Modell hinzufügen.](/images/platform/settings-provider-models.webp)

</Frame>

## Wo der Katalog liegt

Öffne **Einstellungen > KI-Anbieter** und klick eine Provider-Zeile an. Der Drawer listet alles, was der Provider deklariert: seine Basis-URL und seinen API-Schlüssel, seine **Standardmodelle** und die **Modelle**-Liste selbst — durchsuchbar, mit **Mehr anzeigen** hinter den ersten zehn. **Modell hinzufügen** deklariert einen neuen Eintrag von Hand; **Modelle abrufen** zieht die Liste, die die API des Providers meldet. Modelle, die ein Admin als **In Modell-Auswahl ausgeblendet** markiert, bleiben für bestehende Bindungen auflösbar, erscheinen aber nicht mehr in Menüs — so gehen abgelöste Versionen in Rente, ohne alte Agents zu brechen.

Jedes Modell trägt einen oder mehrere Fähigkeits-Tags: **Chat**, **Vision**, **Embedding**, **Transkription**, **Text-zu-Sprache**, **Bildgenerierung**, **Bildbearbeitung**. Die Tags sind tragend — sie entscheiden, in welchen Pickern ein Modell auftaucht und welche Plattform-Fähigkeit es aufrufen darf. Ein Modell ohne passenden Tag erscheint nie dort, wo diese Fähigkeit gebraucht wird.

## Die ausgelieferten Standards

Die **Standardmodelle**-Karte nennt, welches Modell jede Hintergrund-Fähigkeit nutzt, wenn nichts Spezifischeres gebunden ist:

| Fähigkeit       | Ausgelieferter Standard |
| --------------- | ----------------------- |
| Chat            | DeepSeek V4 Flash       |
| Vision          | Qwen3 VL 32B            |
| Embedding       | Qwen3 Embedding 8B      |
| Bildgenerierung | FLUX.2 [pro]            |
| Transkription   | Whisper v1              |

Text-to-Speech für den [Sprachmodus](/de/platform/chat/voice-mode) kommt über OpenAIs GPT-4o mini TTS über denselben OpenRouter-Key, und [Bildgenerierung](/de/platform/agents/image-generation) fällt auf FLUX.2 [pro] zurück.

## Wie die Liste frisch bleibt

Modelle driften schneller als Docs. Zwei Mechanismen auf der Seite **KI-Anbieter** halten den Katalog aktuell: die **Modellkatalog**-Karte frischt Modell-Fähigkeiten — Pricing, Kontextfenster, Reasoning, Vision — täglich aus OpenRouters öffentlichem Katalog auf, und der Schalter **Wöchentliche Auto-Synchronisierung der Anbieter-Konfiguration** mergt neu veröffentlichte Flaggschiff-Versionen einmal pro Woche in die Provider-Konfiguration der Org, blendet abgelöste aus und lässt jedes Feld, das du angepasst hast, unberührt.

Die Lieferliste unten wird aus derselben Quelle neu generiert, sie stimmt also mit dem, was eine frische Instanz sieht:

<!-- MODELS_TABLE:START -->

<!-- Auto-generated from builtin-configs/providers/openrouter.json by the weekly model-catalog sync. Do not edit by hand. -->

| Anbieter | Modell | Fähigkeiten | Kontext | Eingabe ($/M) | Ausgabe ($/M) |
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

Der volle und aktuelle Katalog lebt auf [openrouter.ai/models](https://openrouter.ai/models); jedes Modell, das OpenRouter exponiert, lässt sich aus demselben Drawer zu deiner Instanz hinzufügen.

## Wo das hineinpasst

Modelle sind die Schicht unter jedem Agent, jeder Chat-Antwort, jeder Sprachausgabe und jedem Bild, das die Plattform rendert. OpenRouter ist der Default, keine Vorgabe — einen Direkt-Anbieter, einen lokalen Ollama- oder vLLM-Server oder ein zweites Gateway hinzuzufügen ist Admin-Arbeit, die [Provider](/de/platform/admin/providers) abdeckt, und die dateibasierte Form derselben Konfiguration liegt unter [Konfiguration → Provider](/de/self-hosted/configuration/providers). Zum Auswählen zwischen Chat-Modellen, wenn mehr als eines die Arbeit machen könnte, ist [Arena-Modus](/de/platform/chat/arena-mode) der Workflow, der genau für diese Frage gebaut ist.
