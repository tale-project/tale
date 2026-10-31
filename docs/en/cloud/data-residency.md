---
title: Understand Cloud data residency
description: Separate storage location from provider and connector data flows before choosing a Cloud deployment.
---

Data residency covers where your data is stored and where it is processed. Choosing a Cloud region addresses the hosted service; it does not by itself determine where every model provider or connected service handles your data.

## Confirm the hosting arrangement

Confirm your instance’s primary region, backup locations, retention, recovery objectives, and support process with Tale before onboarding. Use the service agreement and data-processing documents for the commitments that apply to your deployment. Do not infer a backup city or recovery guarantee from a region label in the product.

The Cloud service is operated by Tale. Configuration files, database credentials, and host environment variables are operator responsibilities. The [self-hosted configuration reference](/self-hosted/configuration/data-residency) explains the technical model for operators.

## Follow the data through a request

A chat message travels to your Tale instance. When the assistant uses knowledge, relevant content is retrieved from the organization’s knowledge store. The message and selected context are then sent to the model provider used for that response. A tool may contact another service, such as a website or a connected application.

| Data flow | What to confirm |
| --- | --- |
| Stored chats, documents, and configuration | The agreed hosting and backup locations |
| Knowledge indexing | Which embedding provider receives document content |
| Model inference | The selected provider’s endpoint, processing terms, and retention |
| Connectors and web tools | Which external systems receive requests and content |
| Operational records | The agreed handling of logs, backups, and support access |

A provider may offer regional or locally hosted endpoints. Verify the endpoint actually configured; its brand name alone does not establish where processing occurs.

<Tip>

Review the embedding provider as well as the chat model. A document can be sent for embedding during indexing before anyone asks a question about it.

</Tip>

## Keep prompts on EU endpoints {#eu-processing}

Where a model processes a prompt depends on the endpoint its provider calls, not on where Tale runs. With **Process prompts only in the EU/EEA** on, under **Settings > Governance > Models**, Tale sends a model call only to a vendor's EU endpoint or to a host your organization attests, and refuses any other call before the prompt leaves Tale. [Process prompts only in the EU/EEA](/platform/admin/governance/content-models#eu-processing) describes the switch and the calls it covers.

| Endpoint | Where a prompt is processed | With the switch on |
| --- | --- | --- |
| `eu.openrouter.ai` | In Europe as OpenRouter defines it: the EU/EEA, the UK and Switzerland | Allowed |
| `eu.api.openai.com` | In OpenAI's Europe region: the EEA and Switzerland | Allowed |
| `api.eu.mistral.ai` | In Mistral's data centers in EU and EFTA countries: the EEA and Switzerland | Allowed |
| Another host of OpenRouter, OpenAI or Mistral, such as `openrouter.ai`, `api.openai.com` or `us.api.openai.com` | Wherever the vendor routes the request, or in the United States for a US endpoint | Refused, and can't be attested |
| Azure OpenAI, a Standard or Regional Provisioned deployment in an EU/EEA region | In the Azure geography of its region, such as Sweden for Sweden Central | Allowed once you attest the host of its resource |
| Azure OpenAI, a Data Zone EU deployment | In the EU Data Boundary: the EU and the EFTA countries, Switzerland included | Allowed once you attest the host of its resource |
| Azure OpenAI, a Global or Developer deployment | In any Azure region | Refused, unless its resource is attested |
| Any other endpoint, such as a custom provider's server or a model server you run | Where that server runs the model. A proxy or router passes the prompt on, so it is processed where its upstream runs | Allowed once you attest its host |

Each vendor draws its own Europe: none of the three EU endpoints stops at the EU/EEA, and neither does Data Zone EU. If a requirement excludes Switzerland or the UK, use an Azure OpenAI Standard or Regional Provisioned deployment in an EU/EEA region, or a server that runs in the EU/EEA. Azure's Switzerland North, Switzerland West, UK South and UK West regions are outside the EU/EEA.

Tale attests a host, not a deployment: attesting an Azure resource admits every deployment in it, a Global one included. Keep Global and Developer deployments in a resource you don't attest.

Each vendor sets its own conditions for its EU endpoint, such as a plan or an approval, may keep account, billing and other operational data outside the region, and serves there only the models it offers there. Check the terms of [OpenRouter](https://openrouter.ai/docs/guides/features/sovereign-ai), [OpenAI](https://developers.openai.com/api/docs/guides/your-data), [Mistral](https://docs.mistral.ai/inference/regional-inference) and [Azure OpenAI](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types) before you rely on one.

### Move the organization onto EU endpoints

1. Give every provider the organization uses an endpoint from the table. For OpenRouter, OpenAI or Mistral, define a [custom provider](/platform/admin/providers#define-a-custom-provider) whose base URL is the vendor's EU endpoint, such as `https://eu.openrouter.ai/api/v1`.
2. Attest the hosts of your Azure resources and your own servers under **Endpoints attested as processing in the EU/EEA**, then turn on **Process prompts only in the EU/EEA**, as [Process prompts only in the EU/EEA](/platform/admin/governance/content-models#eu-processing) describes.
3. Send a chat message and select **Show info** under the reply. **Region** in **Message information** reads **Europe** for a vendor's EU endpoint, or the region Azure OpenAI reported, such as Sweden Central. A server of your own usually reports none, so the line reads **Not reported**: the switch decides by the endpoint before the call, whatever this line says. [See how a reply was produced](/platform/chat/basics#reply-details) explains the line.

### Recognize a refusal

While the switch is on, the model pickers offer only models whose endpoint it lets through, and a picker that leaves models out says why. A call to any other endpoint, such as one to a model chosen before the switch was turned on, is refused before anything is sent. The refusal says why and what an admin can change, and where it shows depends on what made the call:

- **Chat**: the reply isn't generated, and the chat shows the reason. The same rule holds for chat titles, **Improve with AI**, task turns and image generation.
- **Automations**: the `llm` step fails with **The model access policy stopped the step**.
- **Transcription and voice output**: dictation and audio uploads in the chat say that the audio transcription model isn't known to process in the EU/EEA, and voice output says that the voice provider isn't allowed.
- **Knowledge**: indexing documents, emails and websites is refused, and so is searching them. A document that failed shows the reason. Once its endpoint is fixed or attested, select **Retry indexing**: a policy change doesn't queue the document again, but saving the embedding model or its credential does.
- **API**: the [model endpoints for API keys](/platform/admin/governance/content-models#model-endpoints) list only the models the switch lets through, and a call that names another answers `403` with `MODEL_API_MODEL_FORBIDDEN` and the reason. A model of a catalog provider is refused there even on an EU endpoint, because the model gateway calls the vendor's own endpoint for it.
- **Guardrails**: the [moderation provider](/platform/admin/governance/guardrails#moderation) receives no text, and its check fails with the error class `eu_processing`, as if the provider were unavailable. Fail-open lets the message through, and fail-closed refuses it: a call to the model endpoints for API keys then answers `503` with `MODEL_API_GUARDRAIL_UNAVAILABLE`. Saving the provider with such an endpoint is refused, and the message says what to change.

On the Models page, the image generation and audio transcription settings also warn when their model's endpoint isn't known to process in the EU/EEA. A refusal is recorded in the [audit log](/platform/admin/governance/audit-logs) under **Settings > Governance > Logs** as **Model access denied**, with the surface, provider, model and host.

Two parts don't follow the switch yet: the picker for the model that reads images still offers every model, and the model traffic of agent runtimes such as Claude Code or Codex in a sandbox is not held to it.

## Review a new integration

Before connecting a service, identify what data the intended task will send and which account the connector uses. Check the service’s processing terms, restrict its access, and test with non-sensitive example content. Record the decision alongside your [security review](/cloud/trust-and-compliance).

## Change the region

Arrange a region change with Tale. It requires a migration plan covering stored data, backups, external endpoints, downtime, and validation. Creating a second organization does not move the first organization’s data.

The [migration planning guide](/cloud/migrate-to-self-hosted) lists the questions and verification steps that also apply when moving between Cloud regions.
