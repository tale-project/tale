---
title: Providers
description: Configure custom AI endpoints, understand provider definitions, and supply credentials from deployment secrets.
---

Configure an AI provider by keeping three things distinct: the connector definition, the organization’s credentials and the model server. The connector describes the endpoint and protocol; credentials control access; the endpoint operator runs the model service.

Use this page for custom provider definitions and environment-backed secrets. For creating credentials and choosing defaults in the app, follow [AI providers](/platform/admin/providers).

## Local provider endpoints

A local inference server needs both a provider definition and permission for the backend to reach its host. The definition does not install the server or load a model.

1. Make the inference server reachable from every backend role that will call it. `localhost` inside a container refers to that container, not the host machine. Test name resolution, network access and any TLS certificate from the actual runtime network.
2. For a private or loopback endpoint, set `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` in the backend deployment environment. This permits private provider hosts across that deployment; it is not a per-provider allowlist. Cloud-metadata endpoints remain blocked. Apply the change by recreating the affected containers; restarting them retains their existing Compose environment.
3. Declare the organization’s provider in `TALE_CONFIG_DIR/<orgSlug>/providers/local-models.yml`, or through the [managed configuration workflow](/self-hosted/configuration/config-releases). Use the native provider schema and a name that does not collide with a shipped definition.

For example, replace the private IP and port below with your own reachable server. HTTP is accepted only for hosts recognized as private or loopback; public endpoints require HTTPS. An internal DNS name alone does not bypass the request-time private-host check.

```yaml
name: local-models
displayName: Local models
apiFormat: openai
baseUrl: http://192.168.1.20:8000/v1
catalog:
  source: models-endpoint
auth:
  - method: api-key
  - method: env
```

This uses an OpenAI-compatible chat API and discovers models from `/v1/models`. Check the server’s actual compatibility; model listing alone does not prove that generation, tool calls or streaming work. If the server cannot list models, use `catalog.source: none` and enter exact model identifiers in the credential’s allowlist. Organization-defined providers do not load an organization-side static model file.

Then have an organization admin add a credential through [AI providers](/platform/admin/providers), refresh the catalog and select a specific model for a short chat. Verify the completed request in the intended inference server’s logs. Embeddings, speech and tool traffic require their own routing review; a local chat endpoint does not make them local.

## Verify sandbox model access

Chat calls a provider from the backend. Coding-agent sessions use `sandbox-llm-gateway`, so a successful chat does not prove the agent path. Make the endpoint resolvable and reachable from both the backend and the gateway; each HTTPS client must trust its certificate. A hostname such as `https://models.internal/v1` still needs the private-provider opt-in when DNS resolves it to a private address. Plain HTTP remains limited to hostname forms accepted by the provider schema, such as private IP literals, `localhost` and `.local`.

When a new sandbox session starts, the backend checks the custom provider’s hostname and DNS answers before provisioning its gateway configuration. Private destinations require `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1`; metadata destinations are refused even with it. This preflight does not pin DNS for the gateway’s later requests. Keep provider configuration and DNS under trusted operator control.

After recreating the affected backend processes, start a new sandbox session with the intended provider, model and compatible agent runtime. Use a harmless request and verify a completed reply and the matching inference-server log entry. Inspect `sandbox-llm-gateway` logs if chat works but the agent cannot reach its model. `SANDBOX_EGRESS_ALLOWLIST` controls general sandbox web access, not this separate model connection.

Coding agents also rely on the context window the catalog reports for the model: the `context_length` or `context_window` your server lists on `/v1/models`, or 128,000 tokens for a provider configured with `catalog.source: none`. Make the listing report the context your server actually serves. When that window, or a lower [context limit](/platform/admin/governance/policies-and-limits) for the person who started the run, is below 200,000 tokens, a managed Claude Code session compacts its conversation into a summary before the prompt outgrows it. Claude Code treats any value below 100,000 tokens as 100,000, so a model that serves less can still receive longer prompts than it holds. Give Claude Code a model with at least that much context.

## Where the connectors live

Shipped definitions live at `configs/platform/system/providers/<slug>/provider.yml`. Their static catalogs live at `configs/platform/system/models/<slug>/models.yml`; for example, Anthropic uses `providers/anthropic/provider.yml` and `models/anthropic/models.yml`. These files belong to the image and change with its release.

<Warning>

Shipped files are read-only image inputs and are replaced on upgrade. For an external provider, use the reviewed `configuration` deployment declaration described in [CLI installation](/self-hosted/install/cli-install#configure-the-platform). It creates an organization-owned connector under `TALE_CONFIG_DIR/<org>/providers/` through the same native schema, while credential and policy changes use native APIs.

</Warning>

## What a connector declares

A definition describes protocol, endpoint, catalog, and accepted authentication methods. It contains no organization credentials. These two excerpts show the format:

<CodeGroup>

```yaml anthropic.yml
name: anthropic
displayName: Anthropic
apiFormat: anthropic
baseUrl: https://api.anthropic.com
catalog:
  source: static
auth:
  - method: api-key
  - method: env
  - method: subscription-broker
    constraints:
      execution: sandbox
      harness: claude-code
```

```yaml openrouter.yml
name: openrouter
displayName: OpenRouter
apiFormat: openai
baseUrl: https://openrouter.ai/api/v1
catalog:
  source: openrouter-api
auth:
  - method: api-key
  - method: env
```

</CodeGroup>

| Field | Meaning |
| --- | --- |
| `apiFormat` | The request format: `openai` or `anthropic`. |
| `wireDialect: openai-modern` | For OpenAI-format endpoints: use `max_completion_tokens` and omit custom temperature for reasoning models. Leave it unset for endpoints that need the classic fields. |
| `baseUrl` | A fixed endpoint shared by credentials. |
| `endpointMode: per-credential` | Use an endpoint supplied with each credential instead of `baseUrl`, as Azure OpenAI does. |
| `catalog.source` | `static`, `openrouter-api`, `models-endpoint`, or `none`. Static entries use the model catalog described above. |
| `auth` and `constraints` | Allowed credential methods and any execution requirements, such as a named sandbox harness. |

## Environment-variable key source

For **Environment variable** authentication, the credential stores a variable name; the backend reads its value from its process environment when making a request. Inject the value through your deployment secret manager. This method does not store the API key in the application database.

Only names beginning with `TALE_PROVIDER_KEY_` are accepted. The complete name may contain at most 40 characters; the suffix uses letters, digits, or underscores. The form supplies the prefix automatically.

```bash
TALE_PROVIDER_KEY_OPENROUTER=sk-or-...
TALE_PROVIDER_KEY_OPENAI_PROD=sk-...
```

<Note>

The reserved prefix prevents a credential from selecting unrelated secrets such as `SOPS_AGE_KEY` or `BETTER_AUTH_SECRET`. Validation rejects an invalid name before it can be saved.

</Note>

After adding or rotating the value, recreate both `backend-api` and `backend-worker` with the updated environment. A Compose restart retains old environment values. Leading and trailing whitespace is removed before use; verify a real request after the rollout.

## Broker secrets from the environment

A **Subscription broker** credential can also read its broker secret from the deployment environment. Use the separate `TALE_TOKEN_SOURCE_` prefix in **Secret from environment variable**. Names outside that namespace are rejected. Leaving the field empty uses the secret encrypted with the credential instead. Recreate the consuming processes when rotating an environment-backed value.

## Keep organization settings with the organization

Credential names, allowed models, defaults, and enabled state remain organization data, normally managed under [AI providers](/platform/admin/providers). A managed configuration release can create exact environment-backed credentials through native APIs after verifying the organization and operator. It does not install an inference server or prove model behavior; complete the local endpoint checks above after deployment.
