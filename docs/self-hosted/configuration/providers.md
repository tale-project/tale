---
title: Providers
description: Configure AI model providers via JSON config files, connect self-hosted inference backends, and store secrets either encrypted (SOPS) or as plaintext.
---

Providers connect Tale to AI models over OpenAI-compatible HTTP APIs. Admins can add and edit providers from **Settings > Providers** in the running app — see [AI providers](/platform/admin/providers) for the UI path and feature concept. This page covers the on-disk config form: the JSON files in `TALE_CONFIG_DIR/providers/`, their schema, secrets storage (SOPS-encrypted or plaintext), and how to point Tale at self-hosted inference backends like Ollama, vLLM, LocalAI, or faster-whisper-server.

The UI form and the file form are equivalent — the app writes the same JSON when you save from **Settings > Providers**. Choose whichever fits your change-management workflow: UI edits are quicker for day-to-day tweaks; file edits commit cleanly to git and suit infrastructure-as-code operators.

## File layout

Provider configuration lives in the `providers/` subdirectory of `TALE_CONFIG_DIR`. See [environment reference](/self-hosted/configuration/environment-reference) for the variable's value per deployment flavour.

```text
$TALE_CONFIG_DIR/
  providers/
    openrouter.json          # public config — committable
    openrouter.secrets.json  # API key — never commit (encrypted or plaintext)
    openai.json
    openai.secrets.json
```

- `providers/<name>.json` — public config: base URL, model definitions, tags, defaults.
- `providers/<name>.secrets.json` — the API key. Stored SOPS-encrypted when `SOPS_AGE_KEY` is set, otherwise plaintext JSON at file mode `0600`. Never commit either form — `tale init` adds `**/*.secrets.json` to the project `.gitignore`.

The filename stem (`<name>`) is the provider's internal slug. It must match between the public file and its secrets sibling.

## Public config schema

```json
{
  "displayName": "OpenAI",
  "description": "OpenAI API (Whisper for speech-to-text).",
  "baseUrl": "https://api.openai.com/v1",
  "defaults": {
    "chat": "gpt-4o",
    "transcription": "whisper-1"
  },
  "models": [
    {
      "id": "whisper-1",
      "displayName": "Whisper v1",
      "description": "Speech-to-text. Billed per minute of audio; 25 MB file ceiling.",
      "tags": ["transcription"],
      "cost": { "centsPerAudioMinute": 0.6 }
    }
  ]
}
```

| Field            | Purpose                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `displayName`    | Label shown in the UI and in model pickers.                                                                                                   |
| `description`    | Optional explainer shown in the provider list.                                                                                                |
| `baseUrl`        | OpenAI-compatible endpoint. `/chat/completions`, `/embeddings`, `/audio/transcriptions`, etc. are appended by Tale.                           |
| `defaults`       | Per-capability default model used when no explicit pick exists. Keys: `chat`, `vision`, `embedding`, `image-generation`, `transcription`.     |
| `models[*].id`   | Must match exactly the model name the endpoint accepts (e.g. `llama3.3` for Ollama, `Systran/faster-whisper-base` for faster-whisper-server). |
| `models[*].tags` | One or more of `chat`, `vision`, `embedding`, `image-generation`, `image-edit`, `transcription` — controls where the model appears.           |
| `models[*].cost` | Optional pricing — see the cost table below.                                                                                                  |

### Cost fields

Pricing is declared per model so the usage ledger can compute cost estimates. Token-billed and per-unit-billed models use different fields:

| Field                   | Applies to                       | Notes                                                                 |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `inputCentsPerMillion`  | Chat, vision, embedding          | Price per million input tokens.                                       |
| `outputCentsPerMillion` | Chat, vision                     | Price per million output tokens.                                      |
| `imageCentsPerImage`    | `image-generation`, `image-edit` | Fixed price per generated image. Bypasses token math.                 |
| `centsPerAudioMinute`   | `transcription`                  | Price per minute of audio. OpenAI Whisper is `0.6` (i.e. $0.006/min). |

Leave `cost` unset for self-hosted backends where spend is operational rather than per-call — usage is still logged, but the estimated cost column is `0`.

## Provider secrets storage

Tale supports two on-disk forms for `providers/<name>.secrets.json`. The format detection is **content-based** — the file format speaks for itself, and Tale picks the right path regardless of which process (Convex, CLI, Python services) is reading it.

### Encrypted mode (`SOPS_AGE_KEY` set)

When `SOPS_AGE_KEY` (or `SOPS_AGE_KEY_FILE`) is set in `.env`, Tale stores secrets [SOPS](https://github.com/getsops/sops)-encrypted with the configured age recipient. `tale init` auto-generates a key and uses this mode by default. The on-disk file looks like:

```json
{
  "apiKey": "ENC[AES256_GCM,...]",
  "sops": {
    "age": [{ "recipient": "age1...", "enc": "..." }],
    "version": "3.9.4"
  }
}
```

To rotate, re-encrypt the file with the new recipient (or save through the UI to re-encrypt with the current key) and restart.

### Plaintext mode (`SOPS_AGE_KEY` not set)

When the env var is absent, Tale reads and writes secrets as plaintext JSON at file mode `0600`. This mode is intended for self-hosted setups that already manage credentials externally (Kubernetes secrets, Vault-injected files, mounted bind volumes, etc.):

```json
{ "apiKey": "sk-…" }
```

The plaintext form is owner-readable only and is excluded from git via the scaffolded `.gitignore`. The platform logs a one-time warning at startup so the storage posture is visible to operators.

### Switching modes

The file format is self-describing, so a SOPS-encrypted file remains decryptable after switching to plaintext mode (provided you keep the key) and a plaintext file remains readable after enabling encryption — Tale will only re-encrypt on the next save through the UI.

To prevent unrecoverable data loss, **the platform refuses to plaintext-overwrite an existing SOPS-encrypted secrets file** when `SOPS_AGE_KEY` is no longer set. Resolve it explicitly: either restore the key, or remove the encrypted file before saving fresh credentials.

If you prefer to avoid SOPS end-to-end, set the API key through the UI instead — **Settings > Providers > Edit > API key**. The app handles whichever mode `.env` configures.

## Using the bundled example providers

The repo ships ready-to-use example configs in `examples/providers/`. Copy any of them into your config directory and supply your own key.

### OpenRouter (chat + vision across vendors)

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
```

Get a key at [openrouter.ai/keys](https://openrouter.ai/keys) and add it via the UI in **Settings > Providers > OpenRouter** — the app writes the matching `openrouter.secrets.json` for you in whichever mode is configured. (The committed `examples/providers/*.secrets.json` files are SOPS-encrypted to the repo's age recipient and not useful as drop-in templates.)

The example includes models across multiple vendors:

| Vendor    | Models                                    | Tags         |
| --------- | ----------------------------------------- | ------------ |
| Anthropic | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5    | chat, vision |
| OpenAI    | GPT-5.2, GPT-5.2 Instant, GPT-5.2 Pro     | chat, vision |
| Google    | Gemini 3 Pro, Gemini 3 Flash              | chat, vision |
| Mistral   | Mistral Large 3, Mistral Medium 3         | chat         |
| Meta      | LLaMA 4 Maverick, LLaMA 4 Scout           | chat         |
| DeepSeek  | DeepSeek V3.2                             | chat         |
| Moonshot  | Kimi K2.5                                 | chat         |
| Qwen      | Qwen3 Next 80B, Qwen3.5 35B, Qwen3 VL 32B | chat, vision |

### OpenAI (Whisper for transcription)

```bash
cp examples/providers/openai.json $TALE_CONFIG_DIR/providers/
```

Add your OpenAI key via **Settings > Providers > OpenAI**. The file declares `whisper-1` and `defaults.transcription`, so audio and video chat attachments route here once a key is set. See [Chat attachments](/platform/chat/attachments#audio-and-video-transcription) for the end-user view.

## Self-hosted inference backends

Any server that exposes an OpenAI-compatible API can be a provider. Add a JSON file with its base URL and the model IDs the server serves. Commonly used backends:

- [Ollama](https://ollama.com) — `http://localhost:11434/v1`
- [vLLM](https://docs.vllm.ai) — `http://localhost:8000/v1`
- [LocalAI](https://localai.io) — `http://localhost:8080/v1`
- [llama.cpp server](https://github.com/ggerganov/llama.cpp) — `http://localhost:8080/v1`
- [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) — `http://localhost:8000/v1` (transcription only)

### Example — Ollama

```json
{
  "displayName": "Ollama (local)",
  "baseUrl": "http://localhost:11434/v1",
  "models": [
    { "id": "llama3.3", "displayName": "LLaMA 3.3", "tags": ["chat"] },
    { "id": "mistral", "displayName": "Mistral 7B", "tags": ["chat"] }
  ]
}
```

Ollama does not require authentication; set `apiKey` to any non-empty placeholder in the secrets file.

### Example — local Whisper for transcription

```json
{
  "displayName": "Local Whisper",
  "baseUrl": "http://localhost:8000/v1",
  "defaults": { "transcription": "Systran/faster-whisper-base" },
  "models": [
    {
      "id": "Systran/faster-whisper-base",
      "displayName": "Faster-Whisper Base",
      "tags": ["transcription"]
    }
  ]
}
```

Tale calls `{baseUrl}/audio/transcriptions` and expects the OpenAI-compatible `verbose_json` response format — faster-whisper-server, vLLM, and LocalAI all support it.

## Docker host networking

When Tale runs in a Docker container and the inference backend runs on the Docker host (Ollama, vLLM, LocalAI), `localhost` inside the container points at the container, not the host. Options:

- **Docker Desktop (Mac, Windows)** — use `http://host.docker.internal:<port>/v1`.
- **Linux** — add `extra_hosts: ["host.docker.internal:host-gateway"]` to the platform service in `compose.yml`, or use the host's LAN IP, or put Tale and the backend on the same Docker network and reference the backend by service name.

## Making models available to agents

A model defined in a provider file is only _reachable_. For it to appear in an agent's model selector, add its `id` to the agent's `supportedModels` array in `TALE_CONFIG_DIR/agents/<slug>.json`:

```json
{
  "supportedModels": ["llama3.3", "anthropic/claude-opus-4.6"]
}
```

The IDs must match the `id` field in the provider's model definition exactly. Only entries with the `chat` tag appear in the chat model selector; `embedding` models are picked up by the knowledge base, `transcription` models by the audio pipeline, etc.

### Pinning to a specific provider

When the same model id is defined in more than one provider file (e.g. `anthropic/claude-opus-4.6` in both `openrouter.json` and a direct `anthropic.json`), prefix the entry with `<provider>:` to pin routing explicitly:

```json
{
  "supportedModels": [
    "openrouter:anthropic/claude-opus-4.6",
    "anthropic:claude-opus-4.6"
  ]
}
```

Plain entries (no colon) resolve to the first provider that defines the id. The agent save path emits a warning when an unqualified entry matches more than one provider so you can disambiguate. Direct file edits bypass that save-time validation — the runtime resolver will still surface warnings, but pinning explicitly is safer for multi-provider setups.

## See also

- [AI providers](/platform/admin/providers) — managing providers through the UI.
- [Chat attachments](/platform/chat/attachments#audio-and-video-transcription) — how transcription-tagged models are used.
- [Environment reference](/self-hosted/configuration/environment-reference) — `TALE_CONFIG_DIR` and related variables.
