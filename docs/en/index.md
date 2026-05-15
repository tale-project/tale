---
title: Welcome to Tale
description: Sovereign AI platform — chat, knowledge, agents, and automations, available as a managed cloud service or fully self-hosted.
---

Tale is a sovereign AI platform. You chat with models over your own documents, build custom agents that handle a job, run multi-step automations that work in the background, and manage customer conversations — all with your choice of AI providers and your data pinned to a region you control. The platform ships in two editions, **[Cloud](/cloud)** and **[Self-hosted](/self-hosted)**, and every feature, API, and role is identical between them. Only the operational surface differs: in Cloud we run the stack; in Self-hosted you do.

This page is the front door for both editions and every role. Pick the edition that matches how Tale will be hosted, then jump to the section indexed by what you do day to day.

## Choose your edition

If you are still deciding how Tale will be hosted, the two options trade off control for convenience.

- **[Cloud](/cloud)** — we run the stack, keep it patched, and host your data in Switzerland or the EU. Pick this when you want Tale's capabilities without operating the infrastructure, and when Swiss/EU data residency is enough.
- **[Self-hosted](/self-hosted)** — you run the Docker Compose bundle on your own VPC, hardware, or air-gapped environment. Pick this when data sovereignty, custom networking, custom models, or a custom build is a hard requirement.

If you already know the edition and want the feature reference, go straight to **[Platform](/platform)** — the canonical documentation for every user-visible feature, identical across both editions.

## Choose your role

Tale has six roles — Owner, Admin, Developer, Editor, Member, Disabled — each with a distinct permission set. The role-indexed documentation lives under [Platform](/platform) and applies to both editions.

- **[Member](/platform/member/overview)** — read-only end user.
- **[Editor](/platform/editor/overview)** — content management and approvals.
- **[Developer](/platform/developer/overview)** — agents, automations, integrations.
- **[Admin](/platform/admin/overview)** — organisation settings.

If you are integrating Tale with other systems or contributing to the source, **[Develop](/develop/api-reference)** is the section to open — REST API, webhooks, SDK patterns, and contributor workflows all live there.

## What makes Tale different

- **Your data, your region.** Cloud pins every tenant to Switzerland or the EU, with explicit subprocessor disclosure. Self-hosted leaves the network entirely, including prompts and document content.
- **Any model.** OpenAI, Anthropic, Google, Mistral, Meta, or self-hosted models via Ollama, vLLM, or LocalAI — switchable per-agent without migration.
- **Built for teams.** Six roles from read-only Member up to full Owner, organised into teams with scoped knowledge and access.
- **Certified.** ISO 27001 and SOC 2 Type II, Swiss-based, GDPR-compliant by default.

## Support and community

- [GitHub](https://github.com/tale-project/tale) — source code, issues, discussions.
- [tale.dev](https://tale.dev) — product site and release announcements.
