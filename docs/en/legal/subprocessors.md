---
title: Subprocessors
description: The third-party processors Tale Cloud uses to deliver the service, what each one processes, and where the processing happens.
noindex: true
---

A subprocessor is a third party Tale engages to process customer personal data on its behalf. The list below covers Tale Cloud; self-hosted operators control their own infrastructure and the subprocessor list for those deployments is whichever providers you choose. Material additions are announced 30 days in advance and org Owners are notified by email.

Read this when an auditor asks who else touches your data. Come back when a procurement review needs the current vendor list and the location of each. This page mirrors **Appendix A** of the [Data Processing Agreement](https://tale.dev/legal/data-processing-agreement) — both are updated in the same change. The endpoints and data flows of the Tale platform itself are described in the public [API documentation](https://demo.tale.dev/docs).

## No use of customer data for model training

Tale does not use customer data — prompts, inputs, outputs, embeddings, audio, images, or any derived artifacts — to train, fine-tune, or improve any AI model. Each AI subprocessor below is contractually bound, via its enterprise or API terms with Tale, to the same. This may only be varied by a separate written opt-in agreement signed by both parties; continued use of the services, in-product toggles, or implicit consent do not count. The binding clause lives at [Data Processing Agreement § 5](https://tale.dev/legal/data-processing-agreement#5-ai-processing--no-use-for-training-or-improvement).

## Current subprocessors

Each subprocessor name links to that provider's publicly available DPA (or equivalent terms). Certifications and trust pages are listed in the next section. Platform hosting follows your org's data-residency choice: the first table applies to orgs in the EU/EEA, the second to Swiss orgs. AI calls (LLM inference, audio, and image processing) are processed in the EU/EEA for all orgs — no AI subprocessor Tale engages operates a Swiss region, and none of those calls is processed in third countries such as the USA.

### Orgs in the EU/EEA

| Subprocessor (legal entity)                           | Registered address                                  | Type of service                                                                                                            | Place of processing                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [Akenes SA (Exoscale)](https://www.exoscale.com/dpa/) | Boulevard de Grancy 19A, 1006 Lausanne, Switzerland | Cloud infrastructure (datacenter): hosting of the Tale Cloud platform — VMs, container runtime, database, and storage.     | Germany (Frankfurt region).                                                                                               |
| [OpenRouter, Inc.](https://openrouter.ai/privacy)     | 169 Madison Avenue, New York, NY 10016, USA         | LLM inference (chat, vision, embeddings), audio (speech-to-text and text-to-speech), plus image processing and generation. | European Union (in-region routing via `eu.openrouter.ai`: prompts and responses are processed exclusively within the EU). |

### Swiss orgs

| Subprocessor (legal entity)                           | Registered address                                  | Type of service                                                                                                            | Place of processing                                        |
| ----------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Akenes SA (Exoscale)](https://www.exoscale.com/dpa/) | Boulevard de Grancy 19A, 1006 Lausanne, Switzerland | Cloud infrastructure (datacenter): hosting of the Tale Cloud platform — VMs, container runtime, database, and storage.     | Switzerland (Zurich; disaster-recovery replica in Geneva). |
| [OpenRouter, Inc.](https://openrouter.ai/privacy)     | 169 Madison Avenue, New York, NY 10016, USA         | LLM inference (chat, vision, embeddings), audio (speech-to-text and text-to-speech), plus image processing and generation. | European Union (in-region routing via `eu.openrouter.ai`). |

For Swiss orgs, platform hosting stays entirely in Switzerland. The AI subprocessor does not offer a Swiss region; those calls are processed in the EU/EEA — every EU/EEA country is on the Swiss Federal Council's adequacy list under Art. 16 FADP, so the transfer requires no additional safeguards.

Two notes on the AI subprocessor (OpenRouter): it is engaged only when an AI feature routes a call to it — an org that uses no LLM inference, audio, or image features sends it no data. Model providers reachable through OpenRouter (Anthropic, Google, Meta, Mistral, OpenAI, etc.) are upstream providers of OpenRouter, not Tale's direct subprocessors — the default audio models (Whisper for speech-to-text, gpt-4o-mini-tts for text-to-speech) are OpenAI models reached this way. They operate under OpenRouter's own contractual terms; in-region routing restricts every call to provider endpoints inside the EU.

## Certifications and trust pages

Each subprocessor maintains its own security certifications and publishes them on a trust page:

- **Exoscale (Akenes SA)** — ISO/IEC 27001:2022, ISO/IEC 27017, ISO/IEC 27018, SOC 2 Type II, PCI DSS v4.0, HDS, BSI C5, TISAX. Trust page: [exoscale.com/compliance](https://www.exoscale.com/compliance/).
- **OpenRouter, Inc.** — SOC 2; evidence available through the access-gated trust portal [trust.openrouter.ai](https://trust.openrouter.ai). EU Standard Contractual Clauses apply to transfers outside the EU/EEA.

## Scope of processing

For each subprocessor:

- **Exoscale (Akenes SA)** runs the Tale Cloud middleware, application state, and supporting infrastructure on VMs and container infrastructure in your org's selected region (Switzerland: Zurich with disaster recovery in Geneva; EU: Frankfurt). Encryption at rest is provided by Exoscale's storage layer.
- **OpenRouter** processes prompts and responses for the specific LLM call routed to it (chat, vision, embeddings), audio payloads for speech-to-text and the text input for text-to-speech, plus image prompts and generated images. The data is sent over OpenRouter's in-region routing (`eu.openrouter.ai`) and is not retained by Tale as a separate copy.

## Sub-subprocessors

Each subprocessor above engages its own subprocessors (cloud hosting, CDN, secret stores). Their lists are public and linked from each provider's trust page; Tale tracks material changes to the upstream lists through the same 30-day notice mechanism.

## Self-hosted: what changes

If you run Tale on your own infrastructure, the only data Tale processes on your behalf is the support and update traffic you opt into (image pulls from the registry, optional telemetry, support tickets). The hosting and model providers in the table above are operated by you, not by Tale; the subprocessor list for your deployment is whatever stack you assemble.

## Where this fits

Subprocessors are the vendor inventory; the [Data Processing Agreement](https://tale.dev/legal/data-processing-agreement) is the contract under which they operate (Appendix A is the canonical list); the [Privacy policy](/legal/privacy) is the user-facing policy; [Trust and compliance](/cloud/trust-and-compliance) is the operational evidence. An auditor usually wants the four together — the vendor list, the contract, the policy, and the controls — so the linked pages are mutually consistent and updated in the same change.
