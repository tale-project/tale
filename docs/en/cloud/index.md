---
title: Tale Cloud
description: Managed Tale — Ruler GmbH operates the stack in Switzerland and the EU, with the same features as the self-hosted edition.
---

Tale Cloud is the managed edition of the platform. Ruler GmbH operates the infrastructure, keeps it patched and backed up, and pins your tenant to a Swiss or EU data centre — your team focuses on building agents, curating knowledge, and shipping workflows. Cloud runs the identical codebase as [Self-hosted](/self-hosted), so every feature documented under [Platform](/platform) is available on day one.

Pick Cloud when Tale's capability matters more than where the bytes physically live, when ISO 27001 / SOC 2 / GDPR alignment is a hard requirement, and when the team would rather not run Docker Compose, manage upgrades, or watch metric dashboards. Pick [Self-hosted](/self-hosted) when sovereignty means "behind our firewall", when air-gap or custom networking is non-negotiable, or when a custom build of the platform is on the table.

## Cloud vs Self-hosted

The two editions ship the same product. The differences are operational.

| Dimension      | Cloud                                              | Self-hosted                                                   |
| -------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Operator       | Ruler GmbH                                         | Your team                                                     |
| Hosting        | Switzerland or EU, pinned per tenant               | Your infrastructure, anywhere                                 |
| Upgrades       | Automatic, blue-green, zero-downtime               | `tale deploy` on your cadence                                 |
| Feature parity | Identical to Self-hosted                           | Identical to Cloud                                            |
| Networking     | Public HTTPS on a `*.tale.cloud` or custom domain  | Whatever your VPC and proxy stack provides                    |
| Best for       | Teams who want Tale without the operational weight | Teams with sovereignty, air-gap, or custom-build requirements |

## Infrastructure

Tale Cloud runs on [Exoscale](https://www.exoscale.com/), a Swiss cloud provider. Tenants are pinned to one of [Exoscale's European data centres](https://www.exoscale.com/datacenters/) (Switzerland or EU), and Exoscale holds a [BSI C5 Type 2 attestation](https://www.exoscale.com/compliance/bsi-c5/) covering the compute, storage, and network infrastructure Tale runs on.

The same five-service architecture documented at [Self-hosted overview](/self-hosted/overview) backs the Cloud edition — Platform, RAG, Crawler, Database, Proxy — running blue-green so upgrades roll out without dropping requests. The difference is that Ruler GmbH operates and observes those services so the customer doesn't have to.

## Pages in this section

The Cloud chapters cover what changes when Tale is managed for you — onboarding, billing, regional data residency, the trust posture, and the subset of admin actions that only exist on Cloud (hosted SSO, custom domains, audit-log export). Each chapter follows the one-line-per-link shape: read the title, scan the description, open the page if it's yours.

- **Cloud onboarding** — sign up, create the organisation, invite seats, connect a provider. _(Page being rewritten as part of the docs overhaul; the [Member getting-started](/platform/member/overview) flow is the same on both editions until then.)_

Every feature walkthrough — chat, knowledge base, agents, automations, integrations, admin — lives in [Platform](/platform) and applies identically here. Once the tenant is provisioned, that's the section to live in.

## Where this fits

Cloud is the convenient front door to Tale. After onboarding, every meaningful page — the agent build flow, the knowledge-base curation, the automation editor, the governance and audit surfaces — sits under [Platform](/platform). The Cloud-specific chapters cover billing and the trust posture; the product itself is documented once for both editions.
