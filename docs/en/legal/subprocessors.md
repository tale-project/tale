---
title: Subprocessors
description: Find Tale Cloud's authoritative subprocessor list and understand how hosting, model providers, and your own integrations fit together.
noindex: true
---

A subprocessor is a third party engaged to process personal data on a customer's behalf. **Appendix A of the [Data Processing Agreement (DPA)](https://tale.dev/legal/data-processing-agreement)** is Tale Cloud's authoritative list: it names the legal entities, service, place of processing, and data categories. Use that appendix and your agreement for a procurement or privacy review.

## Read the list by service

The published appendix distinguishes platform hosting from AI processing. It lists **Akenes SA (Exoscale)** for infrastructure and **OpenRouter, Inc.** for the AI calls routed through that service. A provider's registered address and the contractual processing location are separate facts.

| What you are checking | Where to look |
| --- | --- |
| Hosting region and recovery location | The appendix's EU/EEA and Swiss customer tables, plus your service agreement |
| Data sent for a model call, transcription, or image feature | The service and data-category columns, and the AI-processing section of the DPA |
| Model providers reached through an intermediary | The appendix's notes on upstream providers and the intermediary's terms |
| Training restrictions | Section 5 of the DPA, including the separate written opt-in requirement |
| Changes to the list and objection process | Section 6 of the DPA; follow its notification and subscription conditions |
| Security evidence | The appendix's trust links and [Tale's trust guide](/cloud/trust-and-compliance) |

## Account for organization integrations

An administrator can configure additional model providers and connectors. Review those destinations and their terms as part of your organization's own data-handling decisions; a list of Tale's contracted Cloud subprocessors is not an inventory of every service your organization may choose to connect.

For example, a chat using an external model sends the input needed for that call to its configured provider. A connector can send a search query or action arguments to another system. Uploaded documents may also be processed by the configured embedding service. The [data-residency guide](/cloud/data-residency) explains these distinct paths.

## If you run Tale yourself

Your operator selects the hosting, model providers, object storage, and integrations. Tale Cloud's vendor list does not describe that deployment automatically. Use the [self-hosted data-residency reference](/self-hosted/configuration/data-residency) to inspect configuration and document your own processing destinations.

For a review pack, collect the current DPA, your service agreement, the applicable privacy information, and the security evidence relevant to your deployment. Contact Tale through the route in the DPA if you need clarification or supporting evidence.
