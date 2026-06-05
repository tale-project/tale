---
title: Providers
description: The two-file provider format on disk — `<name>.json` for the public shape, `<name>.secrets.json` for the keys — plus the workflow for adding, swapping, and disabling a model provider.
---

Tale stores every model provider as two files under `providers/` — a `<name>.json` for the public shape (base URL, models, capabilities) and a `<name>.secrets.json` for the API keys. The split exists so the config is safe to commit and the secrets get the encrypted treatment SOPS gives them. The `tale-platform` container reads both at boot and watches them for changes; restarting the container is not required to pick up edits.

The reference is the file format on disk and the order operations follow when adding a provider. The UI-driven flow ("Settings > Providers") sits on top of the same files; both produce identical results.

## The config file

`providers/<name>.json` describes the provider's public shape. The `displayName` shows up in the UI, the `models` array names everything reachable through this provider, and each model declares its tags (`chat`, `vision`, `embedding`, `transcription`, `text-to-speech`).

```json
{
  "displayName": "OpenAI",
  "description": "Whisper + GPT-4o-mini-tts for voice mode.",
  "baseUrl": "https://api.openai.com/v1",
  "defaults": {
    "transcription": "whisper-1",
    "text-to-speech": "gpt-4o-mini-tts"
  },
  "models": [
    {
      "id": "whisper-1",
      "displayName": "Whisper v1",
      "tags": ["transcription"],
      "cost": { "centsPerAudioMinute": 0.6 }
    }
  ]
}
```

The full set of fields lives in [`examples/default/providers/`](https://github.com/tale-project/tale/tree/main/examples/default/providers) — `openai.json`, `openrouter.json`, and `vercel-gateway.json` cover the three shapes you are likely to need.

## The secrets file

`providers/<name>.secrets.json` is a flat JSON object with the API key under the field name the provider expects:

```json
{
  "apiKey": "sk-..."
}
```

With `SOPS_AGE_KEY` or `SOPS_AGE_KEY_FILE` set, this file is stored encrypted on disk. With both unset, it is plaintext at file mode 0600 — reach that mode only on disks encrypted at rest. The full encryption walkthrough lives in [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops).

## Environment-variable key source

If your secrets already live in Kubernetes Secrets, Vault, or a cloud secret manager, you can point a provider at an **environment variable** instead of a secrets file. Add a `secretsEnv` to the config file (it names the variable; the name itself is not a secret, so it stays in the committable config):

```json
{
  "displayName": "OpenRouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "secretsEnv": "TALE_PROVIDER_KEY_OPENROUTER",
  "models": [
    {
      "id": "openai/gpt-4o",
      "displayName": "GPT-4o",
      "tags": ["chat", "vision"],
      "secretsEnv": "TALE_PROVIDER_KEY_OPENAI_DIRECT"
    }
  ]
}
```

Two guardrails apply:

- **Reserved prefix (required).** The variable name must start with `TALE_PROVIDER_KEY_` (e.g. `TALE_PROVIDER_KEY_OPENROUTER`). Any other name is rejected, so a config that names a non-prefixed variable resolves to no key. This stops a config-write actor from pointing `secretsEnv` at an unrelated deployment secret (e.g. `SOPS_AGE_KEY`) and having it sent to a provider URL. The prefix gate is hardcoded — there is no deployment switch to set.
- **Length.** The name must be 40 characters or fewer — the platform syncs env vars to its Convex backend, which caps variable names at 40.

Resolution order, highest first: model-level `secretsEnv` → provider-level `secretsEnv` → the secrets file (`modelKeys[id]` then `apiKey`). Each tier is skipped when it yields nothing, so a configured-but-empty variable falls back to the file. Env values are trimmed (a trailing newline from a mounted secret is a common cause of `401`s).

Unlike the secrets **file** — which the watcher re-reads on every request — an env-var **value** is read once at process start. Changing it requires **restarting the `tale-platform` container** (it re-syncs env to Convex at boot) and recreating the `tale-rag` / `tale-crawler` containers (they read `os.environ` directly). The variable must be present everywhere the key is consumed: the platform syncs it to Convex automatically; the Python services receive it via their compose `env_file`.

## Adding a provider

The order matters — the watcher reads the config file first to know the provider exists, then resolves the secret on the first request.

1. Drop the config file at `providers/<name>.json`.
2. Drop the secrets file at `providers/<name>.secrets.json` (encrypted or plaintext per your SOPS mode).
3. Refresh **Settings > Providers** in the UI — the new provider appears within a few seconds (the watcher polls every 2 s).
4. Pick the new provider's default model under **Settings > Models** so agents that resolve "default" land on it.

If the config file is malformed, the platform logs a warning and skips the provider; the rest stay reachable.

## Swapping a key

Edit the secrets file in place — the watcher picks up the change and the next request to that provider uses the new key. Existing in-flight requests still hold the old key; cancel and retry to force re-resolution. (Keys sourced from an [environment variable](#environment-variable-key-source) are the exception: changing the value requires a container restart, not just a file edit.)

## Disabling a provider

Either delete both files, or set `"disabled": true` at the top level of the config. Disabling keeps the file on disk for later (handy when you want to keep the model list around but stop billing); deleting removes it entirely. Agents that named the provider explicitly start failing at the next request — switch them to a fallback first.

## Where this fits

Providers are the one half-and-half between server config (this page) and UI (the **Providers** screen). The keys themselves live in `providers/*.secrets.json`; the SOPS handling lives in [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops). The model-level defaults that agents resolve against are documented under [Platform > Models](/platform/models).
