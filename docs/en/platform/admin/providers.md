---
title: AI providers
description: Connect provider credentials, make models available, and diagnose missing model choices.
---

Connect an AI provider before asking Tale to run chats or agents. Under **Settings > AI providers**, Owners, Admins, and Developers manage the credentials their organization uses. The provider defines the connection and supported authentication; a credential supplies your organization's access to it.

<Frame caption="Each row is one credential. The Default badge identifies the credential used when a caller does not name one.">

![The AI providers settings page shows a credential with its provider, authentication method, and Default badge.](/images/get-started/settings-providers.webp)

</Frame>

## Add your first credential

1. Select **Add credential** and choose the provider. The catalog shows configured providers first; choosing one again adds another credential.
2. Choose an **Authentication method** if the provider offers more than one.
3. Check the **Name**. It starts as the provider's name, with a number added when another credential for that provider already uses it: `OpenRouter`, then `OpenRouter 2`. A name that identifies the purpose, such as `Production key` or `Finance team`, makes several credentials for one provider easier to tell apart. Fill in that method's required fields.
4. Review **Model allowlist**. For a provider with a catalog, leaving it empty allows the credential to use that catalog. Providers without a catalog need explicit model IDs.
5. Select **Add credential**. Check the new row and make it the default for that provider when ordinary requests should use it.

For **API key** or **Environment variable** credentials, open a chat and send a short test message with the intended model. A model must be available through an enabled credential and permitted by the organization's model-access rules. Verify subscription credentials with a task or automation agent, as described below. Saving a credential alone does not prove the provider will accept requests.

## Choose an authentication method

| Method | What you provide | When to use it |
| --- | --- | --- |
| **API key** | The provider's secret key | Standard metered API access. The stored secret is encrypted and later shown only as a masked fragment. |
| **Environment variable** | The name of a deployment variable | An operator manages the secret outside the UI. The name must start with `TALE_PROVIDER_KEY_`. |
| **Subscription key** | A supported vendor subscription secret | Runs through the vendor's supported agent runtime in tasks and automations, never in chat. |
| **Subscription broker** | A broker endpoint and token-response configuration | The deployment obtains usable subscription tokens from a broker for the vendor's agent runtime in tasks and automations, never in chat. |

Only methods supported by the selected provider appear. An environment reference does not create the variable: ask the operator to provision it using the [provider configuration guide](/self-hosted/configuration/providers).

## Use subscriptions in tasks, not in chat

A **Subscription key** or **Subscription broker** credential works only inside the agent runtime it is bound to: Claude Code for an Anthropic subscription and for the Moonshot and Z.ai coding plans, Codex for a ChatGPT subscription, Gemini CLI for Gemini, and Hermes for Nous Portal. Vendors do not permit subscription tokens in other applications, and Anthropic refuses them from any client other than Claude Code. Chat calls the provider's API from Tale itself, so it cannot use a subscription credential.

Tale therefore runs a subscription in tasks and automations, where its runtime works in a sandbox. Chat offers only models that an **API key** or **Environment variable** credential serves. The app says so in three places: the add form shows **Tasks and automations only** when you choose a subscription method, every subscription row in the credentials table carries the same note, and the chat model list names the subscriptions it leaves out.

To chat with a model you reach through a subscription, add an API key or environment-variable credential for the same provider, or connect a provider such as OpenRouter that serves the model.

## Paste a Claude OAuth token

To use one Anthropic subscription without a broker, choose **Subscription key** and paste a Claude OAuth token, such as one from `claude setup-token`. Tale hands the token to Claude Code as `CLAUDE_CODE_OAUTH_TOKEN` in tasks and automations.

Tale does not refresh a pasted token. When it expires, or you move to another Claude account, use the row's replacement action to paste a new one, then run the task again. [Rotate or retire credentials](#rotate-or-retire-credentials) describes that action.

## Connect a subscription broker

Subscription brokers support Anthropic subscriptions through Claude Code and OpenAI ChatGPT subscriptions through Codex. These credentials serve task and automation agents; chats require direct API credentials, for the [reasons above](#use-subscriptions-in-tasks-not-in-chat).

| Provider and runtime | Target variable |
| --- | --- |
| Anthropic · Claude Code | `CLAUDE_CODE_OAUTH_TOKEN` |
| OpenAI · Codex | `TALE_SUBSCRIPTION_TOKEN` |

When adding the credential, choose **Subscription broker** and obtain the endpoint and authentication details from your operator. Use an endpoint that serves only the selected provider. For Tale AI gateway, that is `/api/tokens/anthropic` or `/api/tokens/openai`.

Set **Token array path** to `$.tokens`, **Token field** to `access_token`, and **Target environment variable** to the value above. Under **Advanced**, use `status` for **Status field**, `active` for **Active status value**, and `expires_at` for **Expiry field**, and leave **Expiry safety margin (ms)** at its default. The gateway itself holds back an account whose token is about to be refreshed while another account can take the work; Tale still uses it when no other available account can take the turn, for example while the others cool down after a rate limit. Other brokers may use different paths. OpenAI pools must also supply the vendor's `account_id` for every usable token; the broker's own `id` is a separate account identifier.

For OpenAI, restrict **Model allowlist** to model IDs your ChatGPT plan supports. The OpenAI API catalog can include models that the subscription cannot use.

To run a GPT-6 model on the ChatGPT subscription, save the OpenAI broker credential, then configure a [project agent](/platform/projects/project-agents) with **Agent type** set to **Codex**. Under **Model**, search for the model ID, such as `gpt-6.1-sol`, and select the entry marked **OpenAI · Subscription**. [Run the GPT-6 models](#run-the-gpt-6-models) explains where else each model runs.

Choose **Token selection** according to how you want to distribute new agent turns:

- **Random**, the initial choice, picks uniformly from the usable accounts for each selection.
- **First usable** always takes the first usable account in the broker's order. Use it for an ordered preference, not to spread work.
- **Round-robin** picks the usable account that was selected least recently. All backend processes share the selection history for this organization and credential, including concurrent requests. Reordered responses and backend restarts preserve that history; stable broker account IDs also preserve it across token refreshes. This distributes selections; it does not promise equal token usage or equal numbers of running agents.

Save the credential, then run a short task or automation with the matching provider and agent runtime. Check that the agent completes a reply. If no account is usable, ask the operator to check account authorization, token expiry and planned refreshes, and reported quota. The [broker configuration reference](/self-hosted/configuration/providers#connect-a-subscription-broker) explains the optional account metadata, defaults and recovery.

## Run the GPT-6 models

The OpenAI catalog includes GPT-6 Astra (`gpt-6-astra`), GPT-6 Sol (`gpt-6-sol`), GPT-6 Luna (`gpt-6-luna`) and GPT-6.1 Sol (`gpt-6.1-sol`).

- **Chat** offers all four through an OpenAI **API key** or **Environment variable** credential, automatic model selection included. Astra and GPT-6.1 Sol make tool calls only through OpenAI's Responses API, so Tale calls them through it. GPT-6 Sol and Luna accept the chat's tools only with reasoning switched off, so the picker offers no effort levels for them.
- **Project agents and automations** run Astra and GPT-6.1 Sol only on **Codex**, the runtime that speaks the Responses API, on an API-key, environment-variable or ChatGPT-subscription credential. The model picker offers them for no other runtime.

## Configure Azure or another custom endpoint

Azure OpenAI requires **Endpoint URL**, typically `https://<resource>.openai.azure.com/openai/v1`. Each credential belongs to that resource. Azure model IDs are the deployment names configured in the Azure resource, so enter those names in **Model allowlist**; an empty list provides no models when there is no catalog to inherit.

Use the provider's documented endpoint and model identifiers. A display name from a marketing page is not necessarily the identifier accepted by its API.

## Define a custom provider

An organization can connect an endpoint the shipped catalog does not list: a self-hosted model server such as vLLM or Ollama, or an internal gateway that speaks the OpenAI or Anthropic API. Select **Add credential** and choose **Custom provider**, the entry pinned under the catalog:

1. Enter a **Provider name**. It names the provider and this credential, and the provider's identifier is derived from it.
2. Choose the **API format** the endpoint speaks and enter its **Base URL**, the API root the platform appends its paths to. A public host needs `https`.
3. Under **Models**, keep **Discover from the endpoint** to read the server's `/models` listing with this key, or choose **Enter model IDs** and list the exact IDs in the **Model allowlist** for an endpoint that cannot list them.
4. Fill in the **API key** (or the environment variable) and select **Add credential**.

The credential row now shows the provider with a **Custom** badge, and the provider appears in the **Add credential** catalog with the same badge; choosing it there adds another credential for it. A private or loopback address also needs the deployment's private-host opt-in, which an operator sets; saving the credential does not grant it. Ask your operator to prepare endpoint access and deployment policy, then follow [Connect a local model server](/tutorials/admin/connect-local-provider). If coding agents will use the provider, test an agent session too: their model traffic passes through a separate gateway, which also needs network access and certificate trust.

From the row's menu, **Check models** reads the endpoint's model list again with this key, **Edit credential** changes the base URL, API format and model source beside the credential's name, and **Delete** removes the credential. In the edit, **Save** changes the provider and the credential together: a duplicate name or a stale version is refused before either changes. If someone saved the provider or this credential after you opened the dialog, your save is refused instead of overwriting their change; reopen the dialog to load the current settings. Deleting a provider's last credential removes the provider itself, and the dialog says so beforehand. Every saved version of the definition stays in the organization's configuration history. Facts the form does not cover, such as a coding-agent endpoint, are set in the definition file the [provider configuration guide](/self-hosted/configuration/providers) describes.

If the connection drops during **Save**, the outcome may be unknown. Reload the page and check both the provider settings and the credential before retrying; a connection error does not prove that the save was rolled back.

## Select a default and restrict model access

Choose **Make default** from a credential's row menu. There is one default per provider; selecting another moves the badge. Disabled credentials cannot become the default. If no default exists, a caller must explicitly name a credential.

A credential's **Model allowlist** limits only that credential. [Models](/platform/admin/governance/content-models) sets default models and access rules for people, teams, and roles across providers. Both restrictions apply; widening one list cannot bypass the other.

The **Agent runtimes** section below the credentials is read-only. It shows available models and subscriptions for each runtime; change the credentials above to change that configuration. A runtime is marked **Recently failing** when at least half of its runs in the last 30 minutes failed, counting from three runs. When that check can't be read, a notice above the list says so, with **Try again**.

## Recover a missing or failing model

- If a provider has no default, select the intended active credential and make it the default.
- If the catalog failed to load, use **Refresh catalogs** and inspect the provider's result. Live catalogs are cached; built-in catalogs change with the platform.
- If a model is missing, check both the credential's allowlist and organization model-access rules. For a catalog-free provider, check the exact model IDs.
- If a request is rejected, verify the credential's enable state, provider account access, endpoint, and provider-side quota before changing model rules.

## Rotate or retire credentials

Use the row's replacement action to rotate a secret while keeping its name and references. **Disable** pauses a credential without removing its configuration; **Enable** restores it. Confirm a replacement works with the intended model.

<Warning>

Deleting a credential removes access for callers that depend on it. Move those callers first. If you delete the default, select a replacement default so unnamed requests can resolve a credential. A credential the knowledge embedding model resolves — the one named under **Settings > Data residency > Embedding model**, or that provider's last active default — cannot be deleted: the delete dialog names the dependency and Tale refuses the delete. Choose another credential for the embedding model first.

</Warning>
