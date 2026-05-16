---
title: Providers
description: Configure AI model providers via JSON config files, connect self-hosted inference backends, and store secrets either encrypted (SOPS) or as plaintext.
---

Providers connect Tale to AI models over OpenAI-compatible HTTP APIs — OpenRouter, OpenAI direct, Anthropic, Together, Groq, or a self-hosted Ollama or vLLM server. This page is the reference for the on-disk provider configuration under `TALE_CONFIG_DIR/providers/`: the JSON schema, the secrets-storage modes, the routing rules for picking a model, and the per-vendor passthrough patterns. For the UI counterpart Admins reach through the app, [AI providers](/platform/admin/providers) is the platform-side reference.

The UI form and the file form are equivalent. The app writes the same JSON when an Admin saves from **Settings > Providers** that you'd write by hand; pick whichever fits your change-management workflow. UI edits are quicker for day-to-day tweaks; file edits commit cleanly to git and suit infrastructure-as-code operators.

## A worked example

Drop these two files under `$TALE_CONFIG_DIR/providers/`, give the secrets file owner-only permissions, and Tale picks up the provider on the next reload — no restart required.

`openrouter.json`:

```json
{
  "displayName": "OpenRouter",
  "description": "Multi-vendor gateway for chat and vision models.",
  "baseUrl": "https://openrouter.ai/api/v1",
  "defaults": {
    "chat": "anthropic/claude-opus-4.7"
  },
  "providerOptions": {
    "provider": { "allow_fallbacks": false, "data_collection": "deny" }
  },
  "models": [
    {
      "id": "anthropic/claude-opus-4.7",
      "displayName": "Claude Opus 4.7",
      "tags": ["chat", "vision"],
      "cost": {
        "inputCentsPerMillion": 1500,
        "outputCentsPerMillion": 7500
      }
    }
  ]
}
```

`openrouter.secrets.json` (plaintext form; the SOPS-encrypted form is shown below):

```json
{ "apiKey": "sk-or-v1-..." }
```

The filename stem (`openrouter`) is the provider's internal slug. The two files share the stem; mismatched names mean the secret never reaches the runtime.

## File layout

Provider configuration lives in the `providers/` subdirectory of `TALE_CONFIG_DIR`. Each provider gets two files: a public config that's safe to commit, and a secrets file that holds the API key.

```text
$TALE_CONFIG_DIR/
  providers/
    openrouter.json          # public config — committable
    openrouter.secrets.json  # API key — never commit
    openai.json
    openai.secrets.json
```

The public `.json` file holds the base URL, the model list, the cost schema, and the optional `providerOptions` block. The `.secrets.json` sibling holds the API key only; it's SOPS-encrypted when `SOPS_AGE_KEY` is set, and plaintext at file mode `0600` otherwise. `tale init` adds `**/*.secrets.json` to the project `.gitignore` so neither form ever lands in version control by accident.

## Public config schema

The schema below names every top-level field. `displayName`, `baseUrl`, and at least one model are the practical minimum; everything else either defaults sensibly or controls the cost ledger.

| Field            | Description                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `displayName`    | Label shown in the UI and in model pickers.                                                                                                  |
| `description`    | Optional explainer shown in the provider list.                                                                                               |
| `baseUrl`        | OpenAI-compatible endpoint. Tale appends `/chat/completions`, `/embeddings`, `/audio/transcriptions`, etc.                                   |
| `defaults`       | Per-capability default model when no explicit pick exists. Keys: `chat`, `vision`, `embedding`, `image-generation`, `transcription`.         |
| `models[*].id`   | Must match the model name the upstream endpoint accepts (`llama3.3` for Ollama; `Systran/faster-whisper-base` for faster-whisper-server).    |
| `models[*].tags` | One or more of `chat`, `vision`, `embedding`, `image-generation`, `image-edit`, `transcription`. Controls where the model appears in the UI. |
| `models[*].cost` | Optional pricing. See the cost table below.                                                                                                  |

### Cost fields

Pricing is declared per model so the usage ledger can compute cost estimates. Token-billed models use the per-million fields; image and audio models use per-unit fields.

| Field                   | Applies to                       | Description                                                      |
| ----------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `inputCentsPerMillion`  | chat, vision, embedding          | Price per million input tokens.                                  |
| `outputCentsPerMillion` | chat, vision                     | Price per million output tokens.                                 |
| `imageCentsPerImage`    | `image-generation`, `image-edit` | Fixed price per generated image.                                 |
| `centsPerAudioMinute`   | `transcription`                  | Price per minute of audio. OpenAI Whisper is `0.6` ($0.006/min). |

Leave the `cost` block off for self-hosted backends where spend is operational rather than per-call. Usage is still logged; the cost column reads `0`.

### Provider options

Tale forwards arbitrary provider-specific request body fields via an optional `providerOptions` block. The block is allowed at both the provider top level and per model; per-model values override provider-level ones for the same key.

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

Three rules govern `providerOptions`. Write the **inner** request body shape — Tale namespaces it under the upstream's actual provider name at call time, so do not wrap in `{ "openrouter": { ... } }`. **Merge precedence** runs provider-level then model-level, with shared keys merged at depth 2 (sub-keys merge with model winning, arrays replace wholesale). And a closed list of **rejected keys** is silently stripped because they would clobber Tale's resolved request body or leak data:

| Category        | Keys                                                                                                                                                                                                                                                                                                                                      | Reason                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI SDK reserved | `user`, `reasoningEffort`, `textVerbosity`, `strictJsonSchema`                                                                                                                                                                                                                                                                            | The OpenAI-compatible adapter strips these. Set at the agent level instead.                                                                                                             |
| Body-overwrite  | `model`, `messages`, `tools`, `tool_choice`, `stream`, `temperature`, `max_tokens`, `max_completion_tokens`, `top_p`, `frequency_penalty`, `presence_penalty`, `response_format`, `stop`, `seed`, `n`, `logit_bias`, `logprobs`, `top_logprobs`, `stream_options`, `store`, `metadata`, `prompt`, `size`, `reasoning_effort`, `verbosity` | Would clobber Tale's resolved body, silently amplify cost (`n`), break usage telemetry (`stream_options`), leak data upstream (`store`, `metadata`), or bypass the reasoning-token cap. |

Files containing rejected keys are skipped at load with the reason logged in `skippedReasons`; sibling provider files keep loading.

### Gateways versus direct vendors

The same `providerOptions` block carries different **kinds** of knobs depending on whether the upstream is a routing gateway or a direct vendor.

**Gateways** sit in front of multiple backends. Their passthrough fields are routing controls — pick which backend serves the request, at what precision, with what fallback policy. OpenRouter exposes routing under a top-level `provider` key:

```json
"providerOptions": {
  "provider": {
    "quantizations": ["fp8"],
    "allow_fallbacks": false,
    "data_collection": "deny"
  }
}
```

Vercel AI Gateway routes primarily via model-ID prefix (`anthropic/claude-3.5`) and HTTP headers (`ai-gateway-order`). Tale's `providerOptions` only flows into the request body, so header-level routing controls and observability tags configured in the Vercel dashboard sit outside the provider file:

```json
"providerOptions": {
  "order": ["anthropic", "openai"]
}
```

**Direct vendors** host their own models. There's no routing layer — precision is fixed per model on the vendor side, and `quantizations` has no meaning. Their passthrough fields are model-behaviour knobs at the body's top level:

```json
"providerOptions": {
  "service_tier": "priority",
  "parallel_tool_calls": false,
  "prompt_cache_key": "agent-foo-v1"
}
```

Tale forwards verbatim. Each vendor's API reference is the source of truth for the exact field names; the upstream silently ignores fields it doesn't recognise, so a typo looks like a no-op rather than a failure.

**Verifying it landed.** Set `TALE_DEBUG_LLM_WIRE=1` on the convex container's env. The wrapper prints every outgoing chat, embedding, and image LLM request to stdout — URL, plus body keys with `messages` and `input` redacted — so you can confirm the merged options field arrived. The wrapper doesn't cover transcription, connection probes, or the direct-fetch image-gen path.

**Migration.** Existing `.json` files without a `providerOptions` block keep working unchanged; the block is optional. New models added in the bundled `examples/providers/openrouter.json` need to be merged into deployed configs by hand.

## Provider secrets storage

The two on-disk forms — SOPS-encrypted and plaintext — are content-detected at load time. The runtime picks the right path regardless of which process (convex, the CLI, or the Python services) is reading.

### Encrypted (`SOPS_AGE_KEY` set)

When `SOPS_AGE_KEY` or `SOPS_AGE_KEY_FILE` is set, Tale stores secrets [SOPS](https://github.com/getsops/sops)-encrypted with the configured age recipient. `tale init` provisions a key by default and uses this mode:

```json
{
  "apiKey": "ENC[AES256_GCM,...]",
  "sops": {
    "age": [{ "recipient": "age1...", "enc": "..." }],
    "version": "3.9.4"
  }
}
```

**Key rotation** uses the file form. Point `SOPS_AGE_KEY_FILE` at a file containing one or more age keys (one per line, `#` comments allowed), then:

1. Append the new key as a new line in the key file.
2. Re-save each provider's API key through **Settings > Providers**. Each save now produces ciphertext readable by both the old and the new keys.
3. Once every provider has been re-saved, remove the old key. New saves only encrypt to the new recipient; existing files keep decrypting because sops walks every key in the file.

The inline `SOPS_AGE_KEY` form does not support multiple keys — switch to the file form for rotation.

### Plaintext (`SOPS_AGE_KEY` not set)

`tale init` always provisions a key, so plaintext mode requires explicitly clearing `SOPS_AGE_KEY` in `.env` post-init and re-saving keys through the UI. New saves produce plaintext JSON at file mode `0600`:

```json
{ "apiKey": "sk-..." }
```

Plaintext is appropriate when an external system already manages credentials — Kubernetes Secrets, a Vault-injected file, a mounted bind volume. The platform logs a one-time warning at startup so the storage posture stays visible to operators.

### Switching modes

The file format is self-describing. A SOPS-encrypted file stays decryptable after switching to plaintext (provided you keep the key), and a plaintext file stays readable after enabling encryption — Tale only re-encrypts on the next save through the UI.

To prevent unrecoverable data loss, the platform refuses to overwrite an existing SOPS-encrypted file with plaintext when `SOPS_AGE_KEY` is no longer set. Restore the key, or remove the encrypted file before saving fresh credentials.

## Using the bundled examples

The repo ships ready-to-use example configs under `examples/providers/`. Copy any of them into your config directory and add the key through the UI.

### OpenRouter (multi-vendor gateway)

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
```

Get a key at [openrouter.ai/keys](https://openrouter.ai/keys) and add it through **Settings > Providers > OpenRouter** — the app writes the matching `openrouter.secrets.json` in whichever mode is configured. The committed `examples/providers/*.secrets.json` files are encrypted to the repo's age recipient and are not useful as drop-in templates.

### OpenAI (Whisper for transcription)

```bash
cp examples/providers/openai.json $TALE_CONFIG_DIR/providers/
```

Add your OpenAI key through **Settings > Providers > OpenAI**. The example declares `whisper-1` and `defaults.transcription`, so audio and video chat attachments route through here once a key is set. The end-user view lives at [Chat attachments](/platform/chat/attachments#audio-and-video-transcription).

## Self-hosted inference backends

Any server that speaks the OpenAI HTTP API can be a provider. Add a JSON file with the base URL and the models the server hosts. Common backends:

- [Ollama](https://ollama.com) — `http://localhost:11434/v1`
- [vLLM](https://docs.vllm.ai) — `http://localhost:8000/v1`
- [LocalAI](https://localai.io) — `http://localhost:8080/v1`
- [llama.cpp server](https://github.com/ggerganov/llama.cpp) — `http://localhost:8080/v1`
- [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) — `http://localhost:8000/v1` (transcription only)

### Ollama

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

Ollama needs no authentication. Set `apiKey` to any non-empty placeholder in the secrets file — the field is required by the schema, but the runtime forwards whatever's there to a server that ignores it.

### Local Whisper

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

Tale calls `{baseUrl}/audio/transcriptions` and expects the OpenAI `verbose_json` response shape. faster-whisper-server, vLLM, and LocalAI all support it.

## Docker host networking

When Tale runs in a Docker container and the inference backend runs on the Docker host (Ollama, vLLM, LocalAI), `localhost` inside the container points at the container — not the host. The fix depends on the host OS.

On Docker Desktop (Mac, Windows), reach the host through its DNS alias: `http://host.docker.internal:<port>/v1`. On Linux, add `extra_hosts: ["host.docker.internal:host-gateway"]` to the platform service in `compose.yml`, or use the host's LAN IP directly, or put Tale and the backend on the same Docker network and reference the backend by service name.

## Making models available to agents

A model defined in a provider file is reachable, but not yet visible. For it to appear in an agent's model selector, add its `id` to the agent's `supportedModels` array in `TALE_CONFIG_DIR/agents/<slug>.json`:

```json
{
  "supportedModels": ["llama3.3", "anthropic/claude-opus-4.7"]
}
```

The IDs match the `id` field on the provider's model definition exactly. Only entries tagged `chat` appear in the chat model selector; `embedding` models are picked up by the knowledge base, `transcription` models by the audio pipeline, and so on.

### Pinning to a specific provider

When the same model ID is defined in more than one provider file (`anthropic/claude-opus-4.7` in both `openrouter.json` and a direct `anthropic.json`), prefix the entry with `<provider>:` to pin routing:

```json
{
  "supportedModels": [
    "openrouter:anthropic/claude-opus-4.7",
    "anthropic:claude-opus-4.7"
  ]
}
```

Plain entries (no colon) resolve to the first provider that defines the ID. The agent save path emits a warning when an unqualified entry matches more than one provider; direct file edits bypass that save-time validation, so prefer explicit pinning for multi-provider setups.

## Where this fits

The provider files described here are the on-disk form of the same configuration the UI writes when an Admin saves from **Settings > Providers**. Pick whichever surface fits the change-management posture: the UI for day-to-day tweaks, the files when the configuration belongs in git alongside the rest of the infrastructure. Either way, this page is the canonical reference for what every field means.

[AI providers](/platform/admin/providers) is the UI counterpart for Admins. [Chat attachments](/platform/chat/attachments#audio-and-video-transcription) shows how transcription-tagged models reach end users. [Environment reference](/self-hosted/configuration/environment-reference) covers `TALE_CONFIG_DIR` and the other variables this page assumes.
