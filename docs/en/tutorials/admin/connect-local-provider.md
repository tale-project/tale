---
title: Connect a local provider
description: Add Ollama or vLLM as a Tale AI provider so agents run on fully self-hosted models.
---

Tale connects to AI models through [providers](/platform/admin/providers) — any OpenAI-compatible endpoint qualifies, including local runtimes like [Ollama](https://ollama.com), [vLLM](https://docs.vllm.ai), and [LocalAI](https://localai.io). Running agents against a local provider keeps prompts, completions, and knowledge-base context inside your own network; nothing reaches a hosted model vendor. This integration tutorial walks adding Ollama as a provider, exposing a model to agents, and confirming inference is local.

The outcome at the end is a working air-gap path: every chat or automation that picks the local model routes through hardware you control.

## Before you begin

You need Admin or Owner access in Tale — both roles can edit providers. You also need a working Ollama or vLLM server reachable from your Tale instance over HTTP; their respective install guides cover the setup. If Tale itself runs in Docker, the runtime needs to be reachable across the Docker network (the [Self-hosted networking reference](/self-hosted/configuration/environment-reference) covers the options). For Ollama specifically you need at least one pulled model — `ollama pull <name>` downloads it.

No external account, no API key, no feature flag.

## Step 1 — Start the local runtime and verify it responds

A provider that can't reach its endpoint is the most common configuration failure, so make sure the runtime is actually serving before you point Tale at it. For Ollama on the same host:

```bash
ollama pull llama3.3
ollama serve
```

Ollama listens on `http://localhost:11434` by default. Confirm it responds with a list of models:

```bash
curl -s http://localhost:11434/api/tags | jq '.models[].name'
```

If Tale runs in Docker, `localhost` inside the Tale container is the container itself — point at the host instead. On Docker Desktop use `http://host.docker.internal:11434`; on Linux use the host's LAN IP with an explicit `extra_hosts` entry, or put Ollama and Tale on the same Docker network.

The step worked when the `curl` above lists at least one model name.

## Step 2 — Add the provider in Tale

Open **Settings > AI providers** and click **Add provider**. Fill in:

| Field        | Value                                     |
| ------------ | ----------------------------------------- |
| Name         | `ollama-local` (slug, used internally)    |
| Display name | `Ollama (local)`                          |
| Base URL     | `http://host.docker.internal:11434/v1`    |
| API key      | Any non-empty value — Ollama doesn't auth |

Add one model entry per runtime model you want to expose to agents:

| Field        | Value                                  |
| ------------ | -------------------------------------- |
| ID           | `llama3.3` (must match Ollama exactly) |
| Display name | `LLaMA 3.3`                            |
| Tags         | `chat`                                 |

Save. For vLLM the process is identical — the base URL is whatever you started vLLM with (commonly `http://vllm.internal:8000/v1`) and the model ID must match the `--served-model-name` flag.

The step worked when the provider appears in the AI providers list with a green health indicator.

## Step 3 — Allow the model on an agent

Open **Agents**, pick the agent that should run on the local model, and open its file at `TALE_CONFIG_DIR/agents/<slug>.json`. Add the model ID to `supportedModels`:

```json
{
  "supportedModels": ["llama3.3"]
}
```

If two providers expose the same ID, prefix with the provider slug to pin routing:

```json
{
  "supportedModels": ["ollama-local:llama3.3"]
}
```

The full routing rules — provider preference order, fallbacks, when prefix is required — live in [Providers — Making models available to agents](/self-hosted/configuration/providers#making-models-available-to-agents).

The step worked when the agent's chat composer shows the model in its model picker dropdown.

## Step 4 — Test from chat and confirm the model served the request

Open **Chat**, pick the agent, send a short prompt. Latency will be higher than a hosted frontier model — that's expected. Then open the agent's conversation history (or **Usage analytics**) and confirm the model used for the response was `llama3.3` and the provider was `ollama-local`.

If a different provider answered, either the model ID doesn't match Ollama's list (case-sensitive), or `supportedModels` still includes a frontier-model entry that takes precedence in routing.

The step worked when the thread metadata shows `ollama-local` as the provider.

## Trust boundary

What crosses the network in each direction, what doesn't:

- **From Tale to the local runtime**: HTTP requests over your private network only, carrying prompts, system instructions, and any retrieved knowledge-base chunks. With Ollama or vLLM on the same host, traffic never leaves the host's loopback.
- **From the local runtime to Tale**: HTTP responses with the model's completions.
- **From the local runtime to the model vendor**: nothing. Ollama and vLLM serve open-weight models from local files; there's no upstream call.
- **From Tale to a hosted vendor**: nothing, **provided** every model an agent could fall back to is also local. If `supportedModels` includes a hosted model alongside the local one, a routing decision could send a request out — audit the list before claiming air-gap.

That last point is the most common gap in claimed air-gap deployments: the local provider is wired correctly, but a fallback to a hosted provider sits one entry away in the agent's config.

## Troubleshooting

- **Tale can't reach Ollama from Docker** — `localhost` inside the Tale container is the container, not the host. Switch to `host.docker.internal` (Docker Desktop), the host's LAN IP with an `extra_hosts` entry, or a shared Docker network.
- **404 on the model** — the ID is case-sensitive and must match what `ollama list` prints exactly. Re-copy from the runtime, not the model card.
- **Answers are empty or one sentence** — Ollama's default context window is small. Pull a larger-context variant (`llama3.3:8k`, `llama3.3:128k`) or override `num_ctx` in the model's Modelfile.
- **API-key file format error on edit** — editing provider files directly requires matching the encryption mode: SOPS-encrypted when `SOPS_AGE_KEY` is set, plaintext JSON otherwise. Setting the key via the UI writes the right form for you. See [Providers — Provider secrets storage](/self-hosted/configuration/providers#provider-secrets-storage).

## Where this fits

Connecting a local provider is the air-gap building block: once it's in place, every other Tale surface — agents, automations, chat — uses it the same way it would use a hosted provider. The difference is operational (local hardware, slower latency, no per-token cost) and trust-boundary (no traffic to a model vendor); the behaviour is the same.

The local-provider path pairs cleanly with two other integration tutorials: [Meeting transcription](/tutorials/admin/meeting-transcription) keeps the audio path on-device while the summary LLM stays local, and [Word & Excel add-in](/tutorials/admin/office-add-in) routes Office traffic through Tale to whichever provider you've configured.
