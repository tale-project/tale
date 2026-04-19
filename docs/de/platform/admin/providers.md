---
title: KI-Anbieter
description: KI-Modell-Anbieter für deine Organisation konfigurieren und verwalten.
---

Tale verbindet sich mit KI-Modellen über **Anbieter** — OpenAI-kompatible API-Endpunkte. Jeder Anbieter hat eine Base-URL, einen API-Schlüssel und eine oder mehrere Modell-Definitionen. Ab Werk liefert Tale einen [OpenRouter](https://openrouter.ai)-Beispiel-Anbieter mit, der über einen einzigen API-Schlüssel Zugriff auf Modelle von OpenAI, Anthropic, Google, Mistral, Meta und anderen gibt.

Diese Seite beschreibt das tägliche Anbieter-Management im Admin-UI. Für das Anbinden selbst gehosteter Modelle (Ollama, vLLM, LocalAI, etc.) siehe [Eigene Modelle anbinden](/de/platform/integrations/providers).

## Anbieter verwalten

Anbieter werden unter **Einstellungen > Anbieter** in der Management-UI verwaltet. Admins können:

- **Einen Anbieter hinzufügen** mit Namen, Display-Namen, Base-URL, API-Schlüssel und einem oder mehreren Modellen.
- **Einen Anbieter bearbeiten**, um Display-Namen, Beschreibung, Base-URL und Default-Modelle zu ändern. Die Beschreibung erscheint in der Anbieter-Liste und hilft Nutzern zu verstehen, wofür der Anbieter gedacht ist. Default-Modelle legen fest, welches Modell für Chat, Vision und Embedding vorausgewählt ist.
- **Einen Anbieter löschen**, um ihn vollständig zu entfernen.

Jede Modell-Definition enthält eine ID (muss dem vom API erwarteten Modellnamen entsprechen), einen Display-Namen und ein oder mehrere Tags (`chat`, `vision`, `embedding`), die bestimmen, wo das Modell in der Plattform erscheint.

### Anbieter-Dateien

Die Anbieter-Konfiguration liegt als JSON-Dateien im Verzeichnis `providers/` unter `TALE_CONFIG_DIR`:

- `providers/<name>.json` — öffentliche Konfiguration (Base-URL, Modelle, Tags).
- `providers/<name>.secrets.json` — SOPS-verschlüsselter API-Schlüssel.

Du kannst die Dateien auch direkt bearbeiten, statt die UI zu nutzen. Siehe [Environment-Referenz](/de/self-hosted/configuration/environment-reference) für den Ort von `TALE_CONFIG_DIR`.

## Den Beispiel-Anbieter nutzen

Das Repository enthält einen einsatzbereiten OpenRouter-Config in `examples/providers/`. So nutzt du ihn:

1. Kopiere die Beispieldateien in dein Config-Verzeichnis:

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
cp examples/providers/openrouter.secrets.json $TALE_CONFIG_DIR/providers/
```

2. Setze deinen OpenRouter-API-Schlüssel. Einen kannst du unter [openrouter.ai/keys](https://openrouter.ai/keys) anlegen.

3. Verschlüssle die Secrets-Datei mit SOPS oder aktualisiere den API-Schlüssel via UI unter **Einstellungen > Anbieter > OpenRouter**.

Der Beispiel-Anbieter umfasst Modelle mehrerer Hersteller:

| Hersteller | Modelle                                    | Tags           |
| ---------- | ------------------------------------------ | -------------- |
| Anthropic  | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5     | chat, vision   |
| OpenAI     | GPT-5.2, GPT-5.2 Instant, GPT-5.2 Pro      | chat, vision   |
| Google     | Gemini 3 Pro, Gemini 3 Flash               | chat, vision   |
| Mistral    | Mistral Large 3, Mistral Medium 3          | chat           |
| Meta       | LLaMA 4 Maverick, LLaMA 4 Scout            | chat           |
| DeepSeek   | DeepSeek V3.2                              | chat           |
| Moonshot   | Kimi K2.5                                  | chat           |
| Qwen       | Qwen3 Next 80B, Qwen3.5 35B, Qwen3 VL 32B  | chat, vision   |

## Modelle im Chat verfügbar machen

Nach dem Anlegen eines Anbieters mit Modellen musst du die Model-IDs zusätzlich in die `supportedModels`-Liste des Agents eintragen. Agent-Konfigurationen liegen unter `TALE_CONFIG_DIR/agents/`. Bearbeite die passende Agent-JSON-Datei und ergänze die exakten Model-IDs aus deinem Anbieter-Config (`models[*].id`):

```json
{
  "supportedModels": [
    "llama3.3",
    "anthropic/claude-opus-4.6"
  ]
}
```

Die IDs müssen exakt mit dem Feld `id` in der Modell-Definition des Anbieters übereinstimmen.

Nur Modelle aus `supportedModels` mit dem Tag `chat` erscheinen im Modell-Selector.
