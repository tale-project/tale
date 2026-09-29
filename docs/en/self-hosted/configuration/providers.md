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
3. Declare the organization’s provider in `TALE_CONFIG_DIR/<orgSlug>/providers/local-models.yml`, or through the [managed configuration workflow](/self-hosted/configuration/config-releases). Use the native provider schema and a name that does not collide with a shipped definition. An organization admin can also create the same file from the app: **Add credential** > **Custom provider** under **Settings > AI providers**; see [Define a custom provider](/platform/admin/providers#define-a-custom-provider).

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

## Configure audio transcription

The organization policy lives at `TALE_CONFIG_DIR/<org>/governance/transcription-model.yml`, with policy type `transcription_model`. The [Models page](/platform/admin/governance/content-models) edits the same selection. An absent file or an empty object means automatic selection:

```yaml
{}
```

To pin a model, supply both fields. This example uses the shipped OpenAI Whisper model and still requires an active, usable organization credential:

```yaml
providerSlug: openai
modelId: whisper-1
```

A partial pin is invalid. An unavailable pin never falls back to another model; restore its credential or the credential’s allowed models, or explicitly return to automatic selection. A configuration read or validation failure also refuses server transcription. The policy covers audio/video file transcription, video-link audio fallback and server dictation. Browser speech recognition remains independent.

With an active default credential for OpenRouter, Tale also discovers dedicated speech-to-text models from `/models?output_modalities=transcription`. The same credential and its allowed models apply. Use the exact identifier from that catalog when pinning a model, or keep automatic selection. See [OpenRouter’s speech-to-text guide](https://openrouter.ai/docs/guides/overview/multimodal/stt) for the provider’s endpoint contract.

For a custom OpenAI-compatible endpoint, use `catalog.source: models-endpoint` and have its `/models` response declare the audio model with an exact `id` and either `type: transcription` or `architecture.output_modalities: [transcription]`. A pure transcription model may omit `context_window` or report `0`; other models still require a positive value. An audio-input chat model or a text-to-speech model is not automatically a transcription candidate.

Tale sends bearer-authenticated multipart `file` and `model` fields to `POST <baseUrl>/audio/transcriptions`. For OpenRouter it requests `response_format: json`, because some of its models reject `verbose_json`. Other compatible endpoints must accept `response_format: verbose_json`. The JSON response provides the transcript as `text`. Tale prefers a valid `duration` and falls back to valid `usage.seconds`. When neither is usable, it uses a local duration measurement where available. Timestamped `segments` can supply video timestamps; without them, the transcript remains plain text. Listing the model does not prove this API works. Refresh the catalog, select the model, then test a short recording and verify the request in that endpoint’s logs.

## Verify sandbox model access

Chat calls a provider from the backend. Coding-agent sessions use `sandbox-llm-gateway`, so a successful chat does not prove the agent path. Make the endpoint resolvable and reachable from both the backend and the gateway; each HTTPS client must trust its certificate. A hostname such as `https://models.internal/v1` still needs the private-provider opt-in when DNS resolves it to a private address. Plain HTTP remains limited to hostname forms accepted by the provider schema, such as private IP literals, `localhost` and `.local`.

When a new sandbox session starts, the backend checks the custom provider’s hostname and DNS answers before provisioning its gateway configuration. Private destinations require `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1`; metadata destinations are refused even with it. This preflight does not pin DNS for the gateway’s later requests. Keep provider configuration and DNS under trusted operator control.

After recreating the affected backend processes, start a new sandbox session with the intended provider, model and compatible agent runtime. Use a harmless request and verify a completed reply and the matching inference-server log entry. Inspect `sandbox-llm-gateway` logs if chat works but the agent cannot reach its model. `SANDBOX_EGRESS_ALLOWLIST` controls general sandbox web access, not this separate model connection.

Coding agents also rely on the context window the catalog reports for the model: the `context_length` or `context_window` your server lists on `/v1/models`, or 128,000 tokens when the listing publishes neither, as for a provider configured with `catalog.source: none`. Make the listing report the context your server actually serves. When that window, or a lower [context limit](/platform/admin/governance/policies-and-limits) for the person who started the run, is below 200,000 tokens, a managed Claude Code session compacts its conversation into a summary before the prompt outgrows it. Claude Code treats any value below 100,000 tokens as 100,000, so a model that serves less can still receive longer prompts than it holds. Give Claude Code a model with at least that much context.

A managed Claude Code session on a model other than Claude also leaves out the attribution line Claude Code otherwise puts at the start of every system prompt. That line changes with each request, so a server that caches prompt prefixes would recompute the whole conversation on every turn.

## Where the connectors live

Shipped definitions live at `configs/platform/system/providers/<slug>/provider.yml`. Their static catalogs live at `configs/platform/system/models/<slug>/models.yml`; for example, Anthropic uses `providers/anthropic/provider.yml` and `models/anthropic/models.yml`. These files belong to the image and change with its release.

<Warning>

Shipped files are read-only image inputs and are replaced on upgrade. For an external provider, use the reviewed `configuration` deployment declaration described in [CLI installation](/self-hosted/install/cli-install#configure-the-platform). It creates an organization-owned connector under `TALE_CONFIG_DIR/<org>/providers/` through the same native schema, while credential and policy changes use native APIs. The **Custom provider** entry of **Add credential** in the app writes the same organization-owned file and keeps every saved version under `.history/`.

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
| `embedding` | Whether the provider serves embeddings: `supported` when its catalog ships a curated vector width, `unsupported` when the vendor offers no embedding model, so **Settings > Data residency > Embedding model** refuses it, or `unknown`, the default, when an admin enters the model and its vector width. Declare `unsupported` only where the vendor's own documentation says so. |
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

## Connect a subscription broker

A subscription broker supplies a pool of OAuth access tokens; Tale chooses a usable account for each agent turn. The shipped integrations are Anthropic with Claude Code and OpenAI ChatGPT with Codex, for task and automation agents. Keep direct API credentials for chats and other direct model calls. An OAuth token is not a provider API key.

Use a separate endpoint for each provider. Tale AI gateway exposes `/api/tokens/anthropic` and `/api/tokens/openai`, authenticated with its API key as a bearer token. Its combined `/api/tokens` endpoint is not the right source for a single-provider credential. The backend must reach the broker under the same host policy described for provider endpoints above.

The following example is the broker credential document built by the [AI providers form](/platform/admin/providers#connect-a-subscription-broker), not a provider definition file. Replace the hostname with your broker and provision `TALE_TOKEN_SOURCE_AI_GATEWAY` in both backend processes with that broker's API key. The mapped property names match Tale AI gateway; adapt them for another broker.

```json
{
  "endpoint": "https://broker.example.com/api/tokens/anthropic",
  "httpMethod": "GET",
  "auth": {
    "method": "bearer",
    "secretEnv": "TALE_TOKEN_SOURCE_AI_GATEWAY"
  },
  "responseMapping": {
    "tokensPath": "$.tokens",
    "tokenField": "access_token",
    "statusField": "status",
    "activeValue": "active",
    "expiresField": "expires_at"
  },
  "targetEnvVar": "CLAUDE_CODE_OAUTH_TOKEN",
  "selection": "round-robin"
}
```

For OpenAI, change the endpoint suffix to `/api/tokens/openai` and `targetEnvVar` to `TALE_SUBSCRIPTION_TOKEN`. Every usable OpenAI item must also contain its vendor `account_id`. Tale passes that value as `TALE_SUBSCRIPTION_ACCOUNT_ID`, alongside the token, to Codex's ChatGPT connection. Do not substitute the gateway's `id` or `CODEX_ACCESS_TOKEN` for these values. Restrict the credential's model allowlist to model IDs supported by the ChatGPT plan; the OpenAI API catalog may contain models that are unavailable to subscriptions.

For Anthropic OAuth, use `CLAUDE_CODE_OAUTH_TOKEN`. The legacy `ANTHROPIC_AUTH_TOKEN` target remains supported when explicitly configured; it uses Claude Code's generic bearer-authentication path. Tale clears competing provider credential variables before supplying the chosen token. A target variable unsupported by the selected runtime is refused.

### Account identity and quota

Alongside the mapped token, status and expiry fields, a broker may provide these standard fields on each token item. Their names are fixed and require no additional response mapping.

| Field | Role |
| --- | --- |
| `id` | Broker account identifier |
| `provider` | Provider identifier |
| `account_id` | Vendor account identifier |
| `available` | Availability for new work |
| `available_at` | Time it becomes available again |
| `hold` | Why an unavailable account is held back |
| `usage` | Usage snapshot |

Keep `id` stable when the account's access token rotates, so retries recognize the same account. It is distinct from the vendor's `account_id` required by OpenAI. If `provider` names a different provider than the credential, the item is excluded.

`available: false` excludes the account until the ISO timestamp in `available_at`. If no reset is known, omit that timestamp or use `null`; the account then stays excluded until the broker reports it available. Status and token expiry are checked separately. Tale AI gateway computes availability from a `usage` snapshot containing `checked_at` and `windows`, each with its kind, utilization and reset time.

Older brokers can omit the optional metadata. Without `id`, retry identity falls back to a hash of the token, so it cannot recognize an account after its token changes. Missing quota information leaves an account eligible; it does not establish that quota remains.

Tale AI gateway excludes an account when a fresh usage snapshot reports a global session or weekly window at 100% and its reset has not passed. A vendor's explicit limit signal (`usage.limited: true`) also makes the account unavailable, even when its displayed utilization is lower or missing. Model-specific limits do not exclude the whole account. Usage is considered stale after 15 minutes, so unknown or stale readings leave the account eligible; an exhausted window with no reset time is held only while its reading is fresh. The next token request refreshes stale usage where the vendor supports it. After the applicable reset, the account can rejoin the pool. Provider-side rejection is still possible between usage refreshes. The gateway also reports an account as unavailable until its planned token refresh, `refresh_at`, once that refresh is less than an hour away (its default hand-out floor) and another account can take the work. Such an account carries `hold: "refresh"`, while a spent quota reads `hold: "quota"`. The gateway decides that another account can take the work without seeing Tale's own rules: the cooldown after an HTTP 429 described below, and the `account_id` that OpenAI requires. When those leave no available account, Tale uses the account held for its refresh whose refresh is furthest away instead of refusing the work. A turn therefore starts on a token that is about to be revoked only when the pool has nothing better, and a pool of one account is never held back this way. A broker that sends no `hold` field keeps every unavailable account excluded.

### Selection and recovery

`random` is the form's initial selection; `first` follows broker order. `round-robin` chooses the usable account selected least recently, with selection history stored per organization and credential. Concurrent requests from different backend processes update that history atomically; response reordering and backend restarts do not reset it. Preserving the account's history across token refreshes requires a stable `id`. These strategies distribute account selections, not tokens or active-agent capacity. Existing credentials retain their saved strategy.

When an account returns HTTP 429, Tale excludes it from new selections for this organization and credential for 60 seconds. Retries prefer accounts not yet tried during that run's failure streak. If every otherwise usable account was tried, retries may reuse one; quota and cooldown exclusions still apply. When every account is cooling down, an automatic task or automation retry is queued at once but starts only when the first account is available again. That wait uses no automatic retry when the refused run was itself retrying a failure on an HTTP 429.

An HTTP 401 during a turn served by a broker token can mean the token rotated while the agent worked. Tale requests credentials from the broker again and resumes the conversation when its handle and sandbox session remain available; otherwise it starts a fresh turn. The first two consecutive interruptions of this kind do not spend an automatic retry or exclude the account, so a replacement token on the same account can be used. A third counts like any other failure. This bound also handles a 401 caused by invalid authorization rather than rotation. An interruption after at least fifteen minutes of work starts the count again.

Unless overridden, pool requests time out after 10 seconds and accept at most 262,144 bytes. A mapped token expiry must be further away than the expiry safety margin, `expirySkewMs`, which defaults to five minutes. Keep the status and expiry mappings when using Tale AI gateway so inactive or nearly expired tokens are skipped; its own hand-out floor already holds back accounts that are about to be refreshed. The gateway's `refresh_at` field is the moment its refresh ends a token, earlier than the vendor's `expires_at`. Mapping `refresh_at` as the expiry and raising `expirySkewMs` (at most 3,600,000 ms) makes that rule strict: no turn starts on a token with less than the margin left, but while every account is that close to its refresh, the pool refuses new work, and a pool of one account does so before every refresh. Expiry values may be ISO timestamps or Unix timestamps in seconds or milliseconds.

The minimum remaining lifetime protects the start of a turn, not its full length. Long task or automation runs can outlast a token and need the bounded recovery described above. A broker retry does not guarantee that the account will provide working credentials.

If the pool has no usable account, inspect broker authorization, account status, token expiry and planned refreshes, quota resets and the response mapping. Renew the account authorization, or wait for the quota reset or the token refresh, as appropriate. Then verify a completed task or automation reply with the intended provider and runtime. A successful broker fetch alone does not test the vendor connection.

## Broker secrets from the environment

A **Subscription broker** credential can read its broker secret from the deployment environment. Use the separate `TALE_TOKEN_SOURCE_` prefix in **Secret from environment variable** and leave **Broker secret** empty. Names outside that namespace are rejected. If you supply both, the stored broker secret takes precedence. Recreate the consuming processes when rotating an environment-backed value.

When the replacement configuration still uses broker authentication, leaving both secret fields empty preserves its existing stored secret. Entering an environment reference without a new broker secret switches to the environment source. Choosing **None** for broker authentication removes the stored secret from the replacement configuration.

## Keep organization settings with the organization

Credential names, allowed models, defaults, and enabled state remain organization data, normally managed under [AI providers](/platform/admin/providers). A managed configuration release can create exact environment-backed credentials through native APIs after verifying the organization and operator. It does not install an inference server or prove model behavior; complete the local endpoint checks above after deployment.
