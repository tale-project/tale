---
title: Providers
description: The operator's side of AI providers — the connector files that ship with the platform, and the reserved environment variables that let a deployment hold the API keys instead of the database.
---

An AI provider in Tale has a connector and organization-scoped credentials. The connector declares its endpoint, catalog and authentication methods; credentials hold access policy and a key or environment reference. This page covers shipped connectors and the generic deployment path for an externally operated provider.

## Where the connectors live

Connector definitions are YAML files under `configs/platform/system/providers/`, one per provider, named for the provider's slug — `openrouter.yml`, `openai.yml`, `anthropic.yml`, `azure.yml`, and so on. They are part of the platform image and are upgraded with it. The matching built-in model catalogs sit beside them under `configs/platform/system/models/<slug>.yml`.

<Warning>

Shipped files are read-only image inputs and are replaced on upgrade. For an external provider, use the reviewed `modelSettings` deployment declaration described in [CLI installation](/self-hosted/install/cli-install#configure-external-providers). It creates an organization-owned connector under `TALE_CONFIG_DIR/<org>/providers/` through the same native schema, while credential and policy changes use native APIs.

</Warning>

## What a connector declares

A connector is short by design. It names the provider, the wire dialect its API speaks, the endpoint it answers on, where its model list comes from, and which authentication methods it accepts — nothing organisation-specific and no secrets.

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

`apiFormat` is the wire dialect — `openai` or `anthropic`. An `openai`-format connector may additionally declare `wireDialect: openai-modern`, as the shipped OpenAI and Azure connectors do: the platform then spells the output cap `max_completion_tokens` and holds a custom temperature back from reasoning models, because the current api.openai.com surface rejects `max_tokens` and non-default temperatures on those models — while third-party OpenAI-compatible endpoints keep the classic fields. `baseUrl` is the fixed endpoint; a connector that omits it declares `endpointMode: per-credential` instead, which is how Azure OpenAI works, since every Azure resource serves its own endpoint and each credential therefore carries its own URL. `catalog.source` is one of `static` (a shipped file under `configs/platform/system/models/`), `openrouter-api`, `models-endpoint`, or `none`. Each entry under `auth` is a method the provider's credentials may use, and a method may carry `constraints` that pin it to sandboxed execution on a named harness.

## Environment-variable key source

If your API keys already live in Kubernetes Secrets, Vault, or a cloud secret manager, a credential does not have to hold the secret. The **Environment variable** authentication method stores only the _name_ of a deployment variable, and the platform reads the value from the process environment at call time. This is the ops-managed path: the key never enters the application database, and rotating it is a deployment concern rather than an admin task.

The variable name is prefix-gated. It must begin with `TALE_PROVIDER_KEY_`, and the app fixes that prefix in the form so only the suffix is typed:

```bash
TALE_PROVIDER_KEY_OPENROUTER=sk-or-...
TALE_PROVIDER_KEY_OPENAI_PROD=sk-...
```

<Note>

The gate is fail-closed: any name outside the reserved prefix is rejected, which is what stops a credential from naming an unrelated deployment secret such as `SOPS_AGE_KEY` or `BETTER_AUTH_SECRET` and having it sent as a bearer token to a provider endpoint. Names are capped at 40 characters — a longer name would silently never reach the backend runtime.

</Note>

Define the variable so the backend can read it — it resolves the provider credential at request time. A variable added or changed after boot needs a restart of `backend-api` and `backend-worker` before it is visible. Values are trimmed, which spares you the trailing newline a mounted secret file often carries and the `401` it produces.

## Broker secrets from the environment

A **Subscription broker** credential authenticates to the broker before it can fetch a token pool, and that broker secret can come from the deployment too. Its variables carry their own reserved prefix, `TALE_TOKEN_SOURCE_`, kept separate from provider keys so the two namespaces cannot be confused for one another. The same fail-closed rule applies: a name outside the prefix is rejected. In the credential form the field is **Secret from environment variable**, and leaving it empty means the broker secret is stored encrypted with the credential instead.

## What is organisation data, not deployment config

Credentials, names, model allowlists, defaults and enabled state remain organization data. The app manages them normally. Managed deployment can create exact environment-backed credentials through the native API after proving the declared organization and operator; it does not write credential database rows directly.

<Tip>

Keep connector facts, credential access and server operation separate. Managed deployment validates declared catalog and native policy state; it does not install an inference server or prove the model’s runtime behavior.

</Tip>

## Where this fits

Use managed deployment for reviewed external provider settings, and the [environment reference](/self-hosted/configuration/environment-reference) for secret injection. For app-managed credentials, defaults and catalog refresh, follow [AI providers](/platform/admin/providers); [Model catalog](/platform/models) explains what members see.
