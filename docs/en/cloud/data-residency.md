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

## Review a new integration

Before connecting a service, identify what data the intended task will send and which account the connector uses. Check the service’s processing terms, restrict its access, and test with non-sensitive example content. Record the decision alongside your [security review](/cloud/trust-and-compliance).

## Change the region

Arrange a region change with Tale. It requires a migration plan covering stored data, backups, external endpoints, downtime, and validation. Creating a second organization does not move the first organization’s data.

The [migration planning guide](/cloud/migrate-to-self-hosted) lists the questions and verification steps that also apply when moving between Cloud regions.
