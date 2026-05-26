---
title: Subprocessors
description: The third-party processors Tale Cloud uses to deliver the service, what each one processes, and where the processing happens.
noindex: true
---

A subprocessor is a third party Tale engages to process customer personal data on its behalf. The list below covers Tale Cloud; self-hosted operators control their own infrastructure and the subprocessor list for those deployments is whichever providers you choose. Material additions are announced 30 days in advance and org Owners are notified by email.

Read this when an auditor asks who else touches your data. Come back when a procurement review needs the current vendor list and the location of each. This page mirrors **Appendix A** of the [Data Processing Agreement](/legal/data-processing-agreement) — both are updated in the same change. The endpoints and data flows of the Tale platform itself are described in the public [API documentation](https://demo.tale.dev/docs).

## No use of customer data for model training

Tale does not use customer data — prompts, inputs, outputs, embeddings, audio, images, or any derived artifacts — to train, fine-tune, or improve any AI model. Each AI subprocessor below is contractually bound, via its enterprise or API terms with Tale, to the same. This may only be varied by a separate written opt-in agreement signed by both parties; continued use of the services, in-product toggles, or implicit consent do not count. The binding clause lives at [Data Processing Agreement § 5](/legal/data-processing-agreement#5-ai-processing--no-use-for-training-or-improvement).

## Current subprocessors

Each subprocessor name links to that provider's publicly available DPA (or equivalent terms). Certifications and trust pages are listed in the next section.

| Subprocessor                                                    | Purpose                                                              | Data categories                                                                          | Location      | Training on customer data                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------- |
| [Exoscale](https://www.exoscale.com/dpa/)                       | Cloud hosting for Tale Cloud middleware (VMs and container runtime). | Application data in transit through the middleware; no persistent storage on this layer. | Switzerland   | No (infrastructure only; no AI training).             |
| [Convex](https://www.convex.dev/legal/dpa)                      | Application database and backend platform.                           | Account data, application data, operational metadata.                                    | United States | No (storage only; no AI training).                    |
| [Cloudflare](https://www.cloudflare.com/trust-hub/gdpr/)        | DNS, edge TLS termination, DDoS protection.                          | Connection metadata, IP addresses, request headers.                                      | Global edge   | No.                                                   |
| [OpenRouter](https://openrouter.ai/privacy)                     | LLM inference (chat, vision, embeddings).                            | Prompts and responses routed for the specific inference call.                            | United States | No — contractually prohibited.                        |
| [OpenAI](https://openai.com/policies/data-processing-addendum/) | Audio processing only: Speech-to-Text (Whisper) and Text-to-Speech.  | Audio payloads and transcribed or synthesized text for the specific call.                | United States | No — contractually prohibited (enterprise/API terms). |
| [Vercel AI Gateway](https://vercel.com/legal/dpa)               | Image processing and generation.                                     | Image prompts and generated images for the specific call.                                | United States | No — contractually prohibited.                        |

Two notes on the AI subprocessors (OpenRouter, OpenAI, Vercel AI Gateway): each is engaged only when the relevant feature routes a call to it. An org that uses no audio features sends no data to OpenAI; one that uses no image generation sends no data to Vercel AI Gateway. Model providers reachable through OpenRouter (Anthropic, Google, Meta, Mistral, etc.) are upstream providers of OpenRouter, not Tale's direct subprocessors — they operate under OpenRouter's own contractual terms.

## Certifications and trust pages

Each subprocessor maintains its own security certifications and publishes them on a trust page:

- **Exoscale** — ISO/IEC 27001:2022, ISO/IEC 27017, ISO/IEC 27018, SOC 2 Type II, PCI DSS v4.0, HDS, BSI C5, TISAX. Trust page: [exoscale.com/compliance](https://www.exoscale.com/compliance/).
- **Convex** — SOC 2 Type II, HIPAA (with BAA). Trust page: [convex.dev/security](https://www.convex.dev/security).
- **Cloudflare** — ISO/IEC 27001:2022, ISO 27701, ISO 27018, SOC 2 Type II, PCI DSS Level 1, BSI C5, EU Cloud CoC. Trust page: [cloudflare.com/trust-hub](https://www.cloudflare.com/trust-hub/).
- **OpenRouter** — no separately published certifications. The provider operates under its [Terms of Service](https://openrouter.ai/terms) and [Privacy Policy](https://openrouter.ai/privacy); EU Standard Contractual Clauses apply to cross-border transfers.
- **OpenAI** — SOC 2 Type 2, ISO/IEC 27001:2022, ISO/IEC 27701:2019, CSA STAR (API and ChatGPT Enterprise tiers). Trust page: [trust.openai.com](https://trust.openai.com).
- **Vercel AI Gateway** — covered by Vercel's enterprise certifications: SOC 2 Type 2, ISO/IEC 27001, PCI DSS, HIPAA, TISAX L2, EU-US / Swiss-US / UK Data Privacy Framework. Trust page: [security.vercel.com](https://security.vercel.com/).

## Scope of processing

For each subprocessor:

- **Exoscale** runs the Tale Cloud middleware on VMs and container infrastructure in Switzerland. Application data passes through this layer in transit but is not persistently stored here — durable state lives in Convex.
- **Convex** processes everything the platform persists — the database is the durable substrate for account, application, and operational data. Encryption at rest is provided by Convex.
- **Cloudflare** processes connection-layer data only. TLS terminates at the edge and re-encrypts to the origin; Cloudflare does not see application-layer payloads in the clear beyond what is needed to route the request.
- **OpenRouter** processes prompts and responses for the specific LLM call routed to it (chat, vision, embeddings). The data is sent over OpenRouter's API and is not retained by Tale as a separate copy.
- **OpenAI** processes audio payloads for Speech-to-Text (Whisper) and the text input for Text-to-Speech. OpenAI is not used for chat or any non-audio inference.
- **Vercel AI Gateway** processes image prompts and the generated images for the specific call. It is not used for chat, audio, or embedding workloads.

## Sub-subprocessors

Each subprocessor above engages its own subprocessors (cloud hosting, CDN, secret stores). Their lists are public and linked from each provider's trust page; Tale tracks material changes to the upstream lists through the same 30-day notice mechanism.

## Self-hosted: what changes

If you run Tale on your own infrastructure, the only data Tale processes on your behalf is the support and update traffic you opt into (image pulls from the registry, optional telemetry, support tickets). The model providers, database, and edge in the table above are operated by you, not by Tale; the subprocessor list for your deployment is whatever stack you assemble.

## Where this fits

Subprocessors are the vendor inventory; the [Data Processing Agreement](/legal/data-processing-agreement) is the contract under which they operate (Appendix A is the canonical list); the [Privacy policy](/legal/privacy) is the user-facing policy; [Trust and compliance](/cloud/trust-and-compliance) is the operational evidence. An auditor usually wants the four together — the vendor list, the contract, the policy, and the controls — so the linked pages are mutually consistent and updated in the same change.
