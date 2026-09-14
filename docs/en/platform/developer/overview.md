---
title: Developer
description: Build automations and connect Tale to your clients, scripts, and external services.
---

As a Developer, configure the technical connections and automations that support your team’s work. You have content-editing capabilities as well as access to technical settings such as providers, connectors, and API credentials. Member administration remains with Owners and Admins.

## Choose a connection or workflow

<CardGroup cols="2">

<Card title="Create an API key" icon="key" href="/platform/admin/api-keys">

Authorize a script or service to call Tale and plan for rotation and revocation.

</Card>

<Card title="Connect an MCP client" icon="network" href="/develop/mcp-endpoint">

Let an external client discover and use Tale’s exposed tools.

</Card>

<Card title="Connect an external service" icon="plug" href="/platform/admin/connectors">

Add a credential, choose its default, and recover expired authorization.

</Card>

<Card title="Build an automation" icon="workflow" href="/platform/automations/catalog">

Start from a goal, blank workflow, or package, then test and deploy a version.

</Card>

</CardGroup>

## Work from a concrete boundary

For incoming requests, start with the [API reference](/develop/api-reference) or [webhooks](/develop/webhooks). For an agent calling another system, prefer a supported connector; direct credentials in a sandbox require careful scoping. [Project agents](/platform/projects/project-agents) explains equipment. Deployment files and environment variables belong in the [self-hosted configuration guide](/self-hosted/configuration/environment-reference).
