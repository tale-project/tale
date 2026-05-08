---
title: Connect a local provider
description: Add Ollama or vLLM as a Tale AI provider so agents run on fully self-hosted models.
---

Tale connects to AI models through [providers](/platform/admin/providers) — any OpenAI-compatible endpoint qualifies, including local runtimes like [Ollama](https://ollama.com), [vLLM](https://docs.vllm.ai), and [LocalAI](https://localai.io). Running agents against a local provider keeps prompts, completions, and knowledge-base context inside your own network; nothing reaches a hosted model vendor. This tutorial walks through adding Ollama as a provider, attaching a model to an agent, and switching it on.

You need Admin access. A working Ollama or vLLM server reachable from your Tale instance is the only external prerequisite — see their respective install guides.

## Step 1 — Start the local runtime

For Ollama on the same host as Tale:

```bash
ollama pull llama3.3
ollama serve
```

Ollama listens on `http://localhost:11434` by default. Confirm it responds:

```bash
curl -s http://localhost:11434/api/tags | jq '.models[].name'
```

If Tale runs in Docker, point it at the host instead of `localhost` — on Linux, use `http://host.docker.internal:11434` with an explicit Docker extra-host, or the host's LAN IP. See [Self-hosted configuration](/self-hosted/configuration/environment-reference) for the networking options.

## Step 2 — Add the provider in Tale

Navigate to **Settings > Providers** and click **Add provider**. Fill in:

| Field        | Value                                      |
| ------------ | ------------------------------------------ |
| Name         | `ollama-local` (slug, used internally)     |
| Display name | `Ollama (local)`                           |
| Base URL     | `http://host.docker.internal:11434/v1`     |
| API key      | Any non-empty value — Ollama does not auth |

Add one model entry per runtime model you want to expose:

| Field        | Value                                  |
| ------------ | -------------------------------------- |
| ID           | `llama3.3` (must match Ollama exactly) |
| Display name | `LLaMA 3.3`                            |
| Tags         | `chat`                                 |

Save. The provider appears in the list.

For vLLM the process is identical; the base URL is whatever you configured (commonly `http://vllm.internal:8000/v1`), and the model ID must match the `--served-model-name` flag you started vLLM with.

## Step 3 — Add the model to an agent

Open **Agents**, pick the agent you want to run on the local model, and open its JSON at `TALE_CONFIG_DIR/agents/<slug>.json`. Add the model ID to `supportedModels`:

```json
{
  "supportedModels": ["llama3.3"]
}
```

If two providers define the same model ID, prefix with the provider slug to pin routing:

```json
{
  "supportedModels": ["ollama-local:llama3.3"]
}
```

See [Providers — Making models available to agents](/self-hosted/configuration/providers#making-models-available-to-agents) for the full rules.

## Step 4 — Test from chat

Open **Chat**, pick the agent, and ask anything. In **Settings > Usage analytics** or the agent's conversation history, confirm the request was served by `ollama-local` — the model ID appears in the thread metadata. Latency will be higher than a hosted frontier model; that is expected on most hardware.

If Tale falls back to a different provider, either the model ID does not match Ollama's list, or `supportedModels` still contains a frontier-model entry that takes precedence — remove or reorder.

## Step 5 — Wire it into the must-have tutorials

Both admin must-haves benefit from a local provider:

- **Office Agents** — the add-in hits Tale; Tale routes to the local model. No change to the add-in side. See [Word & Excel add-in](/tutorials/admin/office-add-in).
- **Meeting transcription** — Meetily already runs Whisper locally; adding a local provider closes the loop so the summarisation LLM is also local. See [Meeting transcription](/tutorials/admin/meeting-transcription).

## Troubleshooting

- **Tale cannot reach Ollama from Docker** — `localhost` inside the Tale container is not the host. Use `host.docker.internal` (Docker Desktop), the host LAN IP, or put Ollama and Tale on the same Docker network.
- **404 on model** — model ID is case-sensitive and must match the name `ollama list` prints.
- **Empty or very short answers** — default Ollama context window is small. Pull a larger-context variant or override `num_ctx` in the model's `Modelfile`.
- **API key file format** — if you edit provider files directly, the API-key file must match the configured mode: SOPS-encrypted when `SOPS_AGE_KEY` is set, plaintext JSON otherwise. Setting the key via the UI writes the right form for you; see [Providers — Provider secrets storage](/self-hosted/configuration/providers#provider-secrets-storage).
