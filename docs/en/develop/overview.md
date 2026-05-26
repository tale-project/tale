---
title: Develop
description: Develop covers the API-consumer surface — REST API, webhooks, integration SDK, AI-assisted development workflow, status page, rate limits.
---

Develop is the section for integrators and contributors — anyone wiring Tale into another system, building on top of the API, or shipping a change to the source. The pages here describe the external surface (REST, webhooks, OpenAI-compatible endpoints) and the contributor workflow.

If you are inside the product as a Developer-role user (building agents, automations, custom tools), the Platform tab covers your day to day; Develop is for when you are outside the product, talking to it across the wire.

## Pages in this section

**[API reference](/develop/api-reference)** — endpoints, authentication, OpenAI-compatible endpoints, error model, versioning.

**[Webhooks](/develop/webhooks)** — outbound (Tale → you) and inbound (you → Tale), signing, idempotency, retries.

**[AI-assisted development](/develop/ai-assisted-development)** — using Tale agents to author Tale workflows, the `.agents/` skill files.

**[Integrations](/develop/integrations)** — third-party integrations from a developer perspective.

**[Status page](/develop/status-page)** — Cloud incident reporting, self-hosted metrics pointers.

**[Rate limits](/develop/rate-limits)** — per-key, per-IP, per-org limits and how to interpret 429s.

## Where this fits

Develop is the smallest section because most users never need it; the audience is concentrated in two roles (in-product Developer, out-of-product contributor) but it is load-bearing for both. If you are wiring something external to Tale, [API reference](/develop/api-reference) is the first read; if you are contributing to the source, [Contributing](/self-hosted/contributing-docker) — under the Self-hosted tab — is.
