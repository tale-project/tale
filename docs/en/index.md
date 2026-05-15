---
title: Welcome to Tale
description: Sovereign AI platform — chat over your own documents, build custom agents, run automations, and manage customer conversations, on hardware you control.
kind: index
---

Tale is a sovereign AI platform: chat with models over your own documents, build custom agents that handle a job end to end, run multi-step automations in the background, and manage customer conversations from one inbox — with your choice of AI providers and your data pinned to a region you control. The platform ships in two editions, [Cloud](/cloud) and [Self-hosted](/self-hosted), and every feature, API, and role is identical between them. The only thing that differs is who runs the stack.

This page is the front door for both editions and every role. Pick the edition that matches how Tale gets hosted, then jump to the section indexed by what you do day to day. If you already know your edition and want the feature reference, go straight to [Platform](/platform) — the canonical documentation for every user-visible feature, identical across both editions.

## Choose an edition

The two editions trade off control for convenience. Both ship the same product; the difference is who operates the infrastructure.

- **[Cloud](/cloud)** — Tale operates the stack and pins your data to Switzerland or the EU. Pick this when sovereignty means "EU jurisdiction" and not "behind our firewall", and when running infrastructure isn't where the team should spend its hours.
- **[Self-hosted](/self-hosted)** — install Tale on your own VPC, on-premises hardware, or in an air-gapped environment with a single CLI command. Pick this when data residency means "our datacentre", when network controls have to wrap the whole stack, or when custom models and a custom build are non-negotiable.

## Choose a role

Tale ships six roles — Owner, Admin, Developer, Editor, Member, and Disabled — each with a distinct permission set. The role-indexed documentation under [Platform](/platform) applies to both editions.

- **[Member](/platform/member/overview)** — chat with agents, browse the knowledge base, read conversations and approvals others have assigned to you.
- **[Editor](/platform/editor/overview)** — curate the knowledge base, handle the conversation inbox, approve workflow runs, and maintain the prompt library.
- **[Developer](/platform/developer/overview)** — build agents, automations, and integrations; manage API keys, webhooks, and structured-data entities.
- **[Admin](/platform/admin/overview)** — configure members and roles, teams, AI providers, branding, governance policies, and the audit log.

If you're integrating Tale with other systems or contributing to the source, [Develop](/develop/api-reference) is the section to open — REST API, webhooks, the integration SDK, and contributor workflows all live there.

## What makes Tale different

Four properties most teams compare against the alternatives:

- **Your data, your region.** Cloud pins every tenant to Switzerland or the EU, with explicit subprocessor disclosure and the option to bring your own AI keys. Self-hosted leaves the network entirely — prompts, document content, and embeddings never traverse Tale's infrastructure.
- **Any model, swappable per agent.** OpenAI, Anthropic, Google, Mistral, Meta, DeepSeek, Moonshot, Qwen — or self-hosted models via Ollama, vLLM, or LocalAI — switchable on a per-agent basis without re-indexing, re-training, or migration.
- **One product for the whole organisation.** Six roles cover read-only viewers up to org owners, organised into teams with scoped knowledge access. Members chat with agents; editors curate; developers build automations; admins govern.
- **Compliance you can show your auditor.** ISO 27001 and SOC 2 certified, Swiss-based (Ruler GmbH), GDPR-aligned by default — with audit logs and data subject request tooling built in.

## Where this gets used

The page-shape contract treats this index as the front door, not a tour. Once you've picked an edition and a role, the meaningful next step is one of:

- [Platform](/platform) — the canonical feature reference, identical across both editions. Start here once you're inside the product.
- [Cloud onboarding](/cloud) or [Self-hosted install](/self-hosted) — edition-specific setup. Skip this if Tale is already running for you.
- [Tutorials](/tutorials/overview) — role-indexed worked examples, end to end, on a fresh instance.

For source, issues, and release announcements, [GitHub](https://github.com/tale-project/tale) and [tale.dev](https://tale.dev) are the canonical channels.
