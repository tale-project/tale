---
title: Eigene Modelle anbinden
description: Selbst gehostete Inference-Server (Ollama, vLLM, LocalAI) als Tale-Anbieter einbinden.
---

Jeder Inference-Server, der eine OpenAI-kompatible API bietet, kann als Anbieter genutzt werden. So läuft Tale gegen Modelle auf deiner eigenen Hardware — Prompts und Antworten bleiben vollständig in deiner Infrastruktur.

Häufig genutzte Server:

- [Ollama](https://ollama.com) — `http://localhost:11434/v1`
- [vLLM](https://docs.vllm.ai) — `http://localhost:8000/v1`
- [LocalAI](https://localai.io) — `http://localhost:8080/v1`
- [llama.cpp server](https://github.com/ggerganov/llama.cpp) — `http://localhost:8080/v1`

## Ein selbst gehostetes Modell anbinden

1. Gehe zu **Einstellungen > Anbieter** und klicke auf **Add provider**.
2. Gib einen Namen (z. B. `ollama`), einen Display-Namen und die Base-URL deines Servers ein.
3. Gib einen API-Schlüssel ein (irgendeinen nicht-leeren String, wenn dein Server keine Auth verlangt).
4. Füge ein oder mehrere Modelle hinzu — die Model-ID muss mit dem Namen übereinstimmen, den dein Endpoint anbietet (z. B. `llama3` für Ollama).
5. Wähle die passenden Tags (meist `chat` für Sprachmodelle).

### Beispiel: Ollama

```json
{
  "displayName": "Ollama (local)",
  "baseUrl": "http://localhost:11434/v1",
  "models": [
    {
      "id": "llama3.3",
      "displayName": "LLaMA 3.3",
      "tags": ["chat"]
    },
    {
      "id": "mistral",
      "displayName": "Mistral 7B",
      "tags": ["chat"]
    }
  ]
}
```

## Netzwerk-Hinweise

Wenn Tale in Docker läuft und Ollama auf dem Docker-Host, nutze `http://host.docker.internal:11434/v1` als Base-URL (Mac und Windows). Unter Linux ergänze `extra_hosts: ["host.docker.internal:host-gateway"]` am Platform-Service in `compose.yml` oder verwende die Docker-Bridge-Gateway-IP.

## Siehe auch

- [KI-Anbieter](/de/platform/admin/providers) — Anbieter im Alltag über die Admin-UI verwalten.
- [Environment-Referenz](/de/self-hosted/configuration/environment-reference) — `TALE_CONFIG_DIR` und verwandte Variablen.
