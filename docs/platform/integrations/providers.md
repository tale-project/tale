---
title: Bring your own model
description: Connect self-hosted inference servers (Ollama, vLLM, LocalAI) as Tale providers.
---

Any inference server that exposes an OpenAI-compatible API can be used as a provider. This lets you run Tale against models on your own hardware, keeping prompts and responses entirely on your infrastructure.

Commonly used servers:

- [Ollama](https://ollama.com) — `http://localhost:11434/v1`
- [vLLM](https://docs.vllm.ai) — `http://localhost:8000/v1`
- [LocalAI](https://localai.io) — `http://localhost:8080/v1`
- [llama.cpp server](https://github.com/ggerganov/llama.cpp) — `http://localhost:8080/v1`

## Connecting a self-hosted model

1. Go to **Settings > Providers** and click **Add provider**.
2. Enter a name (e.g., `ollama`), display name, and the base URL of your server.
3. Enter an API key (use any non-empty string if your server doesn't require auth).
4. Add one or more models — the model ID must match the name served by your endpoint (e.g., `llama3` for Ollama).
5. Select the appropriate tags (typically `chat` for language models).

### Example: Ollama

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

## Networking notes

When Tale runs in Docker and Ollama runs on the Docker host, use `http://host.docker.internal:11434/v1` as the base URL on Mac and Windows. On Linux, add `extra_hosts: ["host.docker.internal:host-gateway"]` to the platform service in `compose.yml` or use the Docker bridge gateway IP.

## See also

- [AI providers](/platform/admin/providers) — day-to-day provider management in the admin UI.
- [Environment reference](/self-hosted/configuration/environment-reference) — `TALE_CONFIG_DIR` and related variables.
