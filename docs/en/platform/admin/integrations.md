---
title: Integrations (admin view)
description: Settings > Integrations is where Admins install, configure, and rotate the credentials behind Slack, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily, and MCP. This page covers the admin surface, not the per-integration feature list.
---

Settings > Integrations is the credentials surface for every third-party system Tale talks to on behalf of the organisation. Admins install integrations once; agents, workflows, and the documents pipeline use them everywhere else. This page covers the admin side — what the list shows, how installation and rotation work, what an Admin can scope, and how the surface differs from MCP servers.

The feature-level story of each integration (what it does, what scopes it asks for, what an agent can call) lives one tab over on the per-integration pages and in the cross-integration concept page. What follows is the operations surface: install, rotate, restrict, revoke.

## What the list shows

Open **Settings > Integrations** to land on the org's installed integrations. Each row names an integration, shows its category (communication, storage, identity, knowledge, source control, commerce, AI), the credential type (OAuth2, API key, app token), and the connection status (connected, pending, error). The list is filterable by category and by status.

The catalogue of available integrations sits one click away under **Add integration**. The catalogue currently ships Slack, Microsoft Teams, Discord, Gmail, Outlook, Twilio, Microsoft 365, Google Drive, Confluence, WebDAV, Tavily, GitHub, Shopify, Protel, Circuly, and AI image; the same catalogue is the source the integrations overview documents.

## Installing an integration

Pick an integration from the catalogue and click **Connect**. The integration declares the credential type it expects and the scopes it needs; Tale walks the OAuth dance for OAuth integrations and shows a form for API-key integrations. Once the credential lands, Tale verifies it with a no-op call to the upstream system before saving — a failure surfaces as a connection error with the upstream message attached.

Some integrations carry sub-options on install. Microsoft 365 lets you pick whether to enable OneDrive sync, SharePoint sync, both, or only single sign-on; GitHub lets you pick the repositories the org grants access to; Slack asks which channels the bot may post in. The sub-options can be changed later from the integration's row without re-installing.

## Rotating credentials

To rotate, open the integration's row and click **Rotate credentials**. OAuth integrations walk the dance again with the same scopes; API-key integrations show a field for the new key. The old credential stops working as soon as the new one is verified — there is no overlap window for credentials at the integration level. Reach for rotation on the cadence your security policy mandates, or whenever the upstream system reports the credential is compromised.

## Restricting an integration

Beyond the credential, an integration carries two scoping levers under its row:

- **Allowed roles.** Restrict which roles' agents and workflows may call the integration. The default is every writer role (Editor, Developer, Admin, Owner); narrowing it is how you keep, say, the Twilio integration out of Member-built agents.
- **Allowed teams.** Restrict which teams' agents and workflows may call the integration. Useful when the credential belongs to one team's work (the support team's Slack) and you do not want it leaking into another's.

Both levers are enforced at request time, not at install time — changing a lever takes effect on the next call.

## Revoking an integration

Click the row, then **Disconnect**. A disconnected integration stops authenticating immediately; agents and workflows that depend on it surface a configuration error on the next call. The row stays in the list with a disconnected badge so the audit trail survives. Reconnecting walks the credential flow again from scratch.

## Integrations versus MCP servers

Two surfaces let an agent reach beyond Tale. **Integrations** are the first-party, vendor-specific connectors documented here. **MCP servers** are external processes exposing the Model Context Protocol; the org registers them under **Settings > MCP servers** and approves each tool the first time it is called. Reach for an integration when one exists for the target system; reach for [MCP servers](/platform/integrations/mcp-servers) when no integration covers what you need.

## Where this fits

Integrations are the credential half of the agent-to-outside-world story; the agent-side half (which tools an agent gets, how it calls them, what the trust boundary looks like) lives under [Agent tools](/platform/agents/tools). The natural next read for a new admin is [Integrations overview](/platform/integrations/overview) — it names every shipped integration grouped by what it does and gives the per-integration setup at a glance.
