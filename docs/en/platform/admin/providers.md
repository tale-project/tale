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

Open a chat and check the model picker. A model must be available through an enabled credential and permitted by the organization's model-access rules. Saving a credential alone does not prove the provider will accept requests; send a small test message with the intended model.

## Choose an authentication method

| Method | What you provide | When to use it |
| --- | --- | --- |
| **API key** | The provider's secret key | Standard metered API access. The stored secret is encrypted and later shown only as a masked fragment. |
| **Environment variable** | The name of a deployment variable | An operator manages the secret outside the UI. The name must start with `TALE_PROVIDER_KEY_`. |
| **Subscription key** | A supported vendor subscription secret | Runs through the vendor's supported agent runtime, rather than a direct API call. |
| **Subscription broker** | A broker endpoint and token-response configuration | The deployment obtains usable subscription tokens from a broker. |

Only methods supported by the selected provider appear. An environment reference does not create the variable: ask the operator to provision it using the [provider configuration guide](/self-hosted/configuration/providers).

For a subscription broker, configure how Tale authenticates to the broker, where its response contains the token array and token value, and which target environment variable receives the token. Choose a selection strategy and review the timeout, response-size, expiry, and active-status controls under **Advanced**. Obtain these values from the broker's actual response contract; they are not interchangeable with a provider API key.

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

From the row's menu, **Check models** reads the endpoint's model list again with this key, **Edit credential** changes the base URL, API format and model source beside the credential's name, and **Delete** removes the credential. Deleting a provider's last credential removes the provider itself, and the dialog says so beforehand. Every saved version of the definition stays in the organization's configuration history. Facts the form does not cover, such as a coding-agent endpoint, are set in the definition file the [provider configuration guide](/self-hosted/configuration/providers) describes.

## Select a default and restrict model access

Choose **Make default** from a credential's row menu. There is one default per provider; selecting another moves the badge. Disabled credentials cannot become the default. If no default exists, a caller must explicitly name a credential.

A credential's **Model allowlist** limits only that credential. [Models](/platform/admin/governance/content-models) sets default models and access rules for people, teams, and roles across providers. Both restrictions apply; widening one list cannot bypass the other.

The **Agent runtimes** section below the credentials is read-only. It shows available models and subscriptions for each runtime; change the credentials above to change that configuration.

## Recover a missing or failing model

- If a provider has no default, select the intended active credential and make it the default.
- If the catalog failed to load, use **Refresh catalogs** and inspect the provider's result. Live catalogs are cached; built-in catalogs change with the platform.
- If a model is missing, check both the credential's allowlist and organization model-access rules. For a catalog-free provider, check the exact model IDs.
- If a request is rejected, verify the credential's enable state, provider account access, endpoint, and provider-side quota before changing model rules.

## Rotate or retire credentials

Use the row's replacement action to rotate a secret while keeping its name and references. **Disable** pauses a credential without removing its configuration; **Enable** restores it. Confirm a replacement works with the intended model.

<Warning>

Deleting a credential removes access for callers that depend on it. Move those callers first. If you delete the default, select a replacement default so unnamed requests can resolve a credential.

</Warning>
