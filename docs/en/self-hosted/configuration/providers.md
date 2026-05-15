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

### Provider options (advanced)

Tale forwards arbitrary provider-specific request body fields via an optional `providerOptions` block, available at **both** the provider top level and per-model. The most common use is OpenRouter's [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) — pinning quantization, allowed providers, fallback policy, etc.

```json
{
  "displayName": "OpenRouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "providerOptions": {
    "provider": { "allow_fallbacks": false, "data_collection": "deny" }
  },
  "models": [
    {
      "id": "z-ai/glm-5.1",
      "displayName": "GLM 5.1",
      "tags": ["chat"],
      "providerOptions": {
        "provider": { "quantizations": ["fp8"] }
      }
    }
  ]
}
```

**Authoring rules:**

- Write the **inner** request body shape — Tale namespaces it under the actual provider name at call time. Do **not** wrap in `{ "openrouter": { ... } }`.
- **Merge precedence**: provider-level → model-level (depth-2: shared top-level keys merge, sub-keys merge with model winning, arrays replace wholesale).
- The dashboard exposes the same JSON via the **Advanced — Provider Options** panels under _Settings → Providers → \[provider\]_ (provider-level) and the model add/edit dialog (per-model).

**Rejected keys (the file is skipped at load with the reason logged in `skippedReasons`; sibling provider files continue to load):**

| Category        | Keys                                                                                                                                                                                                                                                                                                                                      | Reason                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI SDK reserved | `user`, `reasoningEffort`, `textVerbosity`, `strictJsonSchema`                                                                                                                                                                                                                                                                            | The OpenAI-compatible adapter strips these silently — set them at the agent level instead.                                                                                                                                                                                       |
| Body-overwrite  | `model`, `messages`, `tools`, `tool_choice`, `stream`, `temperature`, `max_tokens`, `max_completion_tokens`, `top_p`, `frequency_penalty`, `presence_penalty`, `response_format`, `stop`, `seed`, `n`, `logit_bias`, `logprobs`, `top_logprobs`, `stream_options`, `store`, `metadata`, `prompt`, `size`, `reasoning_effort`, `verbosity` | These would clobber Tale's resolved body, silently amplify cost (`n`), break usage telemetry (`stream_options`), leak data to upstream (`store`, `metadata`), swap the image-gen prompt (`prompt`, `size`), or bypass the reasoning-token cap (`reasoning_effort`, `verbosity`). |

**OpenRouter quantization values:** `int4`, `int8`, `fp4`, `fp6`, `fp8`, `fp16`, `bf16`, `fp32`, `unknown`.

#### Gateways vs. direct vendors

`providerOptions` mirrors each upstream's API exactly — but the **kinds** of knobs available depend on whether the upstream is a routing gateway or a direct inference vendor.

**Gateways** (OpenRouter, Vercel AI Gateway) sit in front of multiple backends and aggregate them under a single endpoint. Their passthrough fields are _routing controls_ — pick which backend serves the request, in what precision, with what fallback policy. The two well-known gateways structure those controls differently:

```json
// OpenRouter — routing options under a top-level "provider" key. This is
// the field Tale's example config exercises end-to-end.
"providerOptions": {
  "provider": {
    "quantizations": ["fp8"],
    "allow_fallbacks": false,
    "data_collection": "deny"
  }
}
```

```json
// Vercel AI Gateway — primary routing happens via the model-ID prefix
// (e.g. "anthropic/claude-3.5") and HTTP headers like `ai-gateway-order`.
// Tale's deny-list rejects `metadata` (PII-egress vector at the OpenAI
// /v1/chat/completions level), so observability tags must be configured
// in the Vercel dashboard rather than per-request.
"providerOptions": {
  "order": ["anthropic", "openai"]
}
```

Tale's `providerOptions` only flows into the request body. Header-level routing controls (`ai-gateway-order`, `ai-gateway-only`) and observability tags (`metadata`) are not currently settable from a provider config; pin routing via the model-ID prefix and configure tagging in the Vercel dashboard.

**Direct vendors** (OpenAI, Anthropic, Together AI, Groq, DeepSeek, Mistral) host their own models on their own infrastructure. There is **no routing layer** and **no `quantizations` field** — the precision a model is deployed at is fixed by the vendor (Together AI, for example, only exposes Llama 3.3 70B via `meta-llama/Llama-3.3-70B-Instruct-Turbo` at fp8; to pick a different precision you'd change the model ID rather than a request field, and only older Llama 3 70B has a `…-Instruct-Reference` (bf16) variant). Their passthrough fields are _model-behavior knobs_ at the body's top level:

```json
// OpenAI — SLA tier, parallel tools, prompt cache routing
"providerOptions": {
  "service_tier": "priority",
  "parallel_tool_calls": false,
  "prompt_cache_key": "agent-foo-v1"
}
```

```json
// Together AI — moderation routing, sampling controls beyond AI SDK defaults
"providerOptions": {
  "safety_model": "meta-llama/Llama-Guard-4-12B",
  "repetition_penalty": 1.1
}
```

Tale forwards verbatim — refer to each provider's API reference for the exact field names and accepted values. Fields the upstream doesn't recognize are silently ignored at the gateway, so a typo will look like a no-op rather than fail loudly.

**Verifying it landed:** set `TALE_DEBUG_LLM_WIRE=1` in the Convex backend process env (the self-hosted Convex container, or your `bun run dev` Convex shell locally) and watch its stdout. Each outgoing chat / embedding / image LLM request routed through the AI SDK prints its URL plus body keys (with `messages`/`input` redacted), so you can confirm the merged `provider:` (or any other) field is present. Note: the wrapper does not cover transcription, connection-test probes, or the direct-fetch image-gen path, and only redacts `messages`/`input` — other body fields including `system`, `tools`, `metadata`, `prompt_cache_key`, and `user` are logged verbatim.

**Migration:** existing `$TALE_CONFIG_DIR/providers/*.json` files without a `providerOptions` block continue to work unchanged — the field is optional. New models added in `examples/providers/openrouter.json` (GLM 5.x, Kimi K2.6, Qwen 3.6, Gemma 4) need to be merged manually into deployed configs.

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

**Key rotation** uses the file form of the env var. With `SOPS_AGE_KEY_FILE` pointing at a file containing one or more age secret keys (one per line, `#` comments allowed):

1. Append the new age key as a new line in the key file.
2. Re-save each provider's API key through **Settings > Providers**. Each save now produces ciphertext readable by both the old AND new keys.
3. Once every provider has been re-saved, remove the old key from the file. New saves only encrypt to the new recipient; existing files continue to decrypt because sops walks all keys in the file.

The inline `SOPS_AGE_KEY` form does not support multiple keys — switch to `SOPS_AGE_KEY_FILE` for rotation.

### Plaintext mode (`SOPS_AGE_KEY` not set)

`tale init` always provisions `SOPS_AGE_KEY`, so plaintext mode is reached by clearing `SOPS_AGE_KEY` (and not setting `SOPS_AGE_KEY_FILE`) in `.env` post-init, then re-saving keys through **Settings > Providers**. New saves produce plaintext JSON at file mode `0600`. This mode is intended for self-hosted setups that already manage credentials externally (Kubernetes secrets, Vault-injected files, mounted bind volumes, etc.):

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

## Where this fits

The provider files described here are the on-disk form of the same configuration the UI writes when an Admin saves from **Settings > Providers**. Pick whichever surface fits your change-management posture: the UI for day-to-day tweaks and quick rollouts, the files when the configuration belongs in git alongside the rest of your infrastructure. Either way, the canonical place to read what every field means is this page.

Related references: [AI providers](/platform/admin/providers) covers the UI counterpart for Admins, [Chat attachments](/platform/chat/attachments#audio-and-video-transcription) shows how the transcription-tagged models you configure here are consumed end-user-side, and [Environment reference](/self-hosted/configuration/environment-reference) documents `TALE_CONFIG_DIR` and the other variables this page assumes.
