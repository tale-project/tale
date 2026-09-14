---
title: Connect a local model server
description: Coordinate the local endpoint with an operator, add a provider credential and verify a model request.
---
Connect a local model server when your organization wants a model served from its own infrastructure. You need an enabled inference endpoint, an exact model ID, access to **Settings > AI providers**, and an operator who can configure the deployment’s network policy. Tale does not install or load the model server for you.

A local chat provider controls where that model request goes. Embeddings, speech, tools and other providers have their own routes; connecting this server does not make all organization traffic local.

## Agree on the endpoint with the operator

Ask the operator for the provider name, compatible API format, base URL, model IDs and authentication method. The address must work from the backend processes, not just from your browser. Inside a container, `localhost` names that container.

For a self-hosted deployment, the operator follows [Local provider endpoints](/self-hosted/configuration/providers#local-provider-endpoints). Private hosts require an explicit deployment opt-in. Public endpoints require HTTPS; supported private addresses can use HTTP when the operator accepts that network arrangement. Adding a proxy hostname does not bypass the private-host policy.

Ollama, LM Studio and vLLM can expose compatible APIs, but compatibility depends on the enabled server features and model. Check the actual model list and a supported chat call before configuring Tale.

## Add the organization’s credential

1. Open **Settings > AI providers** and select **Add credential**.
2. Choose the provider definition the operator prepared.
3. Name the credential for its purpose and choose the supported authentication method.
4. Supply the server’s real token, or the environment-variable reference the operator provided. If the inference server ignores authentication, agree on the required placeholder with its operator; do not reuse an unrelated secret.
5. Review **Model allowlist**, then save. Make the credential the provider default if ordinary calls should use it.

<Frame caption="A provider credential belongs to the organization; its default and model allowlist affect model selection.">

![The AI providers settings page shows a provider credential and its default badge.](/images/get-started/settings-providers.webp)

</Frame>

With a model catalog, an empty allowlist permits that catalog. A provider without a catalog needs explicit model IDs. Use **Refresh catalogs** after changing the server’s available models. The organization’s model-access policy also applies.

## Prove one request reaches the server

Start a chat and explicitly select the local model. Leave **Auto** for later: this check needs a known provider and model. Send a short, harmless prompt, such as “Reply with ready.”

Ask the operator to confirm the request in the intended inference server’s logs. Check that Tale displays a completed reply. A saved credential or a populated model list proves less than a completed generation; timing depends on model size, hardware and load.

If coding agents will use this provider, repeat the check in a new sandbox session with the intended model and compatible runtime. Ask the operator to verify the gateway’s DNS, connectivity and TLS trust as well as the backend’s. General sandbox web-access rules do not configure model access. A chat reply and an agent reply verify different paths.

## Resolve a failed check

| Symptom | What to check |
| --- | --- |
| Provider missing from the selection | Definition location, validation errors and organization scope. |
| Private-host refusal | The deployment’s explicit private-provider opt-in; a DNS name alone does not change the rule. |
| Empty model list | Server model discovery, loaded models, credential allowlist and model policy. |
| Connection or certificate error | Backend network reachability, container hostname and TLS trust. |
| Model rejected or no reply | Exact upstream model ID, authentication, API compatibility and server capacity. |
| Chat works but an agent cannot reach the model | Gateway DNS, network access, TLS trust, private-provider opt-in and runtime compatibility. |

[AI providers](/platform/admin/providers) covers credential rotation and defaults. Keep the endpoint and model ID in the operating handoff so another admin can repeat this test after a server change.
