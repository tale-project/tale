---
title: AI providers
description: Configure and manage AI model providers for your organisation.
---

Tale connects to AI models through **providers** — OpenAI-compatible API endpoints. Each provider has a base URL, an API key, and one or more model definitions. Out of the box, Tale ships with an [OpenRouter](https://openrouter.ai) example provider that gives access to models from OpenAI, Anthropic, Google, Mistral, Meta, and others through a single API key.

This page covers day-to-day provider management in the admin UI. For connecting self-hosted models (Ollama, vLLM, LocalAI, etc.), see [Bring your own model](/platform/integrations/providers).

## Managing providers

Providers are managed in **Settings > Providers** in the management UI. Admins can:

- **Add a provider** with a name, display name, base URL, API key, and one or more models.
- **Edit a provider** to update its display name, description, base URL, and default models. The description is shown in the provider list to help users understand what the provider is for. Default models let you pre-select which model is used for chat, vision, and embedding when users pick this provider.
- **Delete a provider** to remove it entirely.

Each model definition includes an ID (must match the model name expected by the API), a display name, and one or more tags (`chat`, `vision`, `embedding`) that control where the model appears in the platform.

### Provider files

Provider configuration is stored as JSON files in the `providers/` directory inside `TALE_CONFIG_DIR`:

- `providers/<name>.json` — public config (base URL, models, tags).
- `providers/<name>.secrets.json` — SOPS-encrypted API key.

You can also edit these files directly instead of using the UI. See [environment reference](/self-hosted/configuration/environment-reference) for the `TALE_CONFIG_DIR` location.

## Using the example provider

The repository includes a ready-to-use OpenRouter provider config in `examples/providers/`. To use it:

1. Copy the example files to your config directory:

```bash
cp examples/providers/openrouter.json $TALE_CONFIG_DIR/providers/
cp examples/providers/openrouter.secrets.json $TALE_CONFIG_DIR/providers/
```

2. Set your OpenRouter API key. You can get one at [openrouter.ai/keys](https://openrouter.ai/keys).

3. Encrypt the secrets file with SOPS or update the API key via the UI in **Settings > Providers > OpenRouter**.

The example provider includes models across multiple vendors:

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

## Making models available in chat

After adding a provider with models, you also need to add the model IDs to the agent's `supportedModels` list. Agent configurations are stored in `TALE_CONFIG_DIR/agents/`. Edit the relevant agent JSON file and add the exact model IDs as defined in your provider config (`models[*].id`):

```json
{
  "supportedModels": ["llama3.3", "anthropic/claude-opus-4.6"]
}
```

The IDs must match the `id` field in the provider's model definition exactly.

Only models listed in `supportedModels` with the `chat` tag appear in the model selector dropdown.
