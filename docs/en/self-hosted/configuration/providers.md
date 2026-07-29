---
title: Providers
description: The operator's side of AI providers — the connector files that ship with the platform, and the reserved environment variables that let a deployment hold the API keys instead of the database.
---

An AI provider in Tale is two halves that live in two different places. The **connector** — the wire format, the endpoint, the model catalog source, the authentication methods a provider accepts — ships with the platform as a file you read but do not edit. The **credentials** are organisation data, created and rotated in the app under **Settings > AI providers**. This page is the operator's half: what the shipped files contain, and the one lever a deployment genuinely owns, which is holding provider API keys in environment variables.

## Where the connectors live

Connector definitions are YAML files under `configs/platform/system/providers/`, one per provider, named for the provider's slug — `openrouter.yml`, `openai.yml`, `anthropic.yml`, `azure.yml`, and so on. They are part of the platform image and are upgraded with it. The matching built-in model catalogs sit beside them under `configs/platform/system/models/<slug>.yml`.

<Warning>

These files are read-only inputs, not deployment configuration. Editing one inside a running container is overwritten by the next upgrade, and there is no organisation-level override for them. When a provider you need is not in the shipped set, that is a platform change rather than a config change.

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

`apiFormat` is the wire dialect — `openai` or `anthropic`. `baseUrl` is the fixed endpoint; a connector that omits it declares `endpointMode: per-credential` instead, which is how Azure OpenAI works, since every Azure resource serves its own endpoint and each credential therefore carries its own URL. `catalog.source` is one of `static` (a shipped file under `configs/platform/system/models/`), `openrouter-api`, `models-endpoint`, or `none`. Each entry under `auth` is a method the provider's credentials may use, and a method may carry `constraints` that pin it to sandboxed execution on a named harness.

## Environment-variable key source

If your API keys already live in Kubernetes Secrets, Vault, or a cloud secret manager, a credential does not have to hold the secret. The **Environment variable** authentication method stores only the _name_ of a deployment variable, and the platform reads the value from the process environment at call time. This is the ops-managed path: the key never enters the application database, and rotating it is a deployment concern rather than an admin task.

The variable name is prefix-gated. It must begin with `TALE_PROVIDER_KEY_`, and the app fixes that prefix in the form so only the suffix is typed:

```bash
TALE_PROVIDER_KEY_OPENROUTER=sk-or-...
TALE_PROVIDER_KEY_OPENAI_PROD=sk-...
```

<Note>

The gate is fail-closed: any name outside the reserved prefix is rejected, which is what stops a credential from naming an unrelated deployment secret such as `SOPS_AGE_KEY` or `BETTER_AUTH_SECRET` and having it sent as a bearer token to a provider endpoint. Names are capped at 40 characters, the limit of the platform-to-Convex environment sync — a longer name would silently never reach the backend runtime.

</Note>

Define the variable so that both the platform container and the Convex backend can read it. The platform syncs its environment to Convex at boot, so the in-process actions resolve the same value; a variable added or changed after boot needs a restart of the platform container before it is visible. Values are trimmed, which spares you the trailing newline a mounted secret file often carries and the `401` it produces.

## Broker secrets from the environment

A **Subscription broker** credential authenticates to the broker before it can fetch a token pool, and that broker secret can come from the deployment too. Its variables carry their own reserved prefix, `TALE_TOKEN_SOURCE_`, kept separate from provider keys so the two namespaces cannot be confused for one another. The same fail-closed rule applies: a name outside the prefix is rejected. In the credential form the field is **Secret from environment variable**, and leaving it empty means the broker secret is stored encrypted with the credential instead.

## What is organisation data, not deployment config

Credentials, their names, their model allowlists, which one is the default, and which are enabled are all organisation data. They are created in the app, they are scoped to one organisation, and there is no file on disk you edit to add one — including on a self-hosted instance.

<Tip>

That split is the quickest way to place a task. Anything about _which provider exists and what it can do_ is a shipped connector; anything about _who may call it and with what key_ is a credential in the app. The only overlap is the environment-variable key path, where the deployment holds the secret and the credential holds its name.

</Tip>

## Where this fits

An operator's whole surface here is provisioning environment variables and knowing which connectors the platform ships; everything else about providers happens in the app. The UI walkthrough — adding credentials, picking a default, narrowing an allowlist, refreshing catalogs — is [AI providers](/platform/admin/providers), what your users end up seeing is [Model catalog](/platform/models), and the variables themselves are listed alongside the rest of the deployment's configuration in the [environment reference](/self-hosted/configuration/environment-reference).
