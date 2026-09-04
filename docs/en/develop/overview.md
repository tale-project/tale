---
title: Develop
description: Develop covers the API-consumer surface — REST API, the MCP endpoint, webhooks, connectors, AI-assisted development workflow, status page, rate limits.
---

Develop is the section for integrators and contributors — anyone wiring Tale into another system, building on top of the API, or shipping a change to the source. The pages here describe the external surface (REST, webhooks, the MCP endpoint) and the contributor workflow.

If you are inside the product as a Developer-role user (staffing project agents, building automations), the Platform tab covers your day to day; Develop is for when you are outside the product, talking to it across the wire.

Prefer to watch first? The bonus episode walks the developer surface — keys, APIs, webhooks, harnesses — in two minutes.

<Video src="/videos/en/tutorials/ep10-developers/ep10-developers.en.mp4" poster="/videos/en/tutorials/ep10-developers/ep10-developers.en.webp" captions="/videos/en/tutorials/ep10-developers/ep10-developers.en.vtt" lang="en" title="Bonus — Tale for developers" caption="Bonus — Tale for developers (2:08)">

</Video>

## Pages in this section

<CardGroup cols="2">

<Card title="API reference" icon="code" href="/develop/api-reference">

Endpoints, authentication, pagination, error model, versioning.

</Card>

<Card title="MCP endpoint" icon="network" href="/develop/mcp-endpoint">

Point an MCP client at Tale — one inbound endpoint, twenty-two tools for authoring and running automations.

</Card>

<Card title="Webhooks" icon="webhook" href="/develop/webhooks">

Inbound webhook triggers (you → Tale), token handling, idempotency, retries.

</Card>

<Card title="AI-assisted development" icon="sparkles" href="/develop/ai-assisted-development">

Using Tale agents to author Tale workflows, the `.agents/` skill files.

</Card>

<Card title="Connectors" icon="plug" href="/develop/connectors">

Third-party connectors from a developer perspective.

</Card>

<Card title="Status page" icon="activity" href="/develop/status-page">

Cloud incident reporting, self-hosted metrics pointers.

</Card>

<Card title="Rate limits" icon="gauge" href="/develop/rate-limits">

Per-key, per-IP, per-org limits and how to interpret 429s.

</Card>

</CardGroup>

## Where this fits

Develop is the smallest section because most users never need it; the audience is concentrated in two roles (in-product Developer, out-of-product contributor) but it is load-bearing for both. If you are wiring something external to Tale, [API reference](/develop/api-reference) is the first read; if you are contributing to the source, [Contributing](/self-hosted/contributing-docker) — under the Self-hosted tab — is.
