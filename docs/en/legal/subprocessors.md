---
title: Subprocessors
description: The third-party processors Tale Cloud uses to deliver the service, what each one processes, and where the processing happens.
noindex: true
---

A subprocessor is a third party Tale engages to process customer personal data on its behalf. The list below covers Tale Cloud; self-hosted operators control their own infrastructure and the subprocessor list for those deployments is whichever providers you choose. Material additions are announced 30 days in advance and org Owners are notified by email.

Read this when an auditor asks who else touches your data. Come back when a procurement review needs the current vendor list and the location of each.

## Current subprocessors

| Subprocessor | Purpose                                            | Data categories                                       | Location      |
| ------------ | -------------------------------------------------- | ----------------------------------------------------- | ------------- |
| Convex       | Application database and backend platform.         | Account data, product data, operational metadata.     | United States |
| Cloudflare   | DNS, edge TLS, and DDoS protection for Tale Cloud. | Connection metadata, IP addresses, request headers.   | Global edge   |
| Anthropic    | Claude model API for chat and agent execution.     | Prompt and response payloads for routed Claude calls. | United States |
| OpenAI       | GPT model API for chat and agent execution.        | Prompt and response payloads for routed OpenAI calls. | United States |
| OpenRouter   | Model router for third-party model providers.      | Prompt and response payloads for routed router calls. | United States |

Two notes on the model providers (Anthropic, OpenAI, OpenRouter): each is engaged only when the customer's org configuration routes a call to that provider. An org that uses only Anthropic models has no data flowing to OpenAI or OpenRouter, and the reverse. The configured providers per org are visible to org Owners under **Settings > Providers**.

## Scope of processing

For each subprocessor:

- **Convex** processes everything the platform stores — the database is the durable substrate for account, product, and operational data. Encryption at rest is provided by Convex.
- **Cloudflare** processes connection-layer data only. TLS terminates at the edge and re-encrypts to the origin; Cloudflare does not see application-layer payloads in the clear beyond what is needed to route the request.
- **Anthropic, OpenAI, OpenRouter** each process the prompt and response payload for the specific inference call routed to them. The data is sent over the provider's API, not stored on Tale's side as a separate copy, and the provider's own retention policy applies to that copy. Tale's contractual terms with each provider forbid use of customer payloads for model training.

## Sub-subprocessors

Each subprocessor above engages its own subprocessors (cloud hosting, CDN, secret stores). Their lists are public and linked from each provider's trust page; Tale tracks material changes to the upstream lists through the same 30-day notice mechanism.

## Self-hosted: what changes

If you run Tale on your own infrastructure, the only data Tale processes on your behalf is the support and update traffic you opt into (image pulls from the registry, optional telemetry, support tickets). The model providers, database, and edge in the table above are operated by you, not by Tale; the subprocessor list for your deployment is whatever stack you assemble.

## Where this fits

Subprocessors are the vendor inventory; [Privacy policy](/legal/privacy) is the policy under which they operate; [Trust and compliance](/cloud/trust-and-compliance) is the operational evidence. An auditor usually wants the three together — the vendor list, the policy, and the controls — so the linked pages are mutually consistent and updated in the same change.
