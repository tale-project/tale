---
title: Integrations (admin view)
description: Settings > Integrations is where Admins install, configure, and rotate the credentials behind Slack, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily, and MCP. This page covers the admin surface, not the per-integration feature list.
---

Settings > Integrations is the credentials surface for every third-party system Tale talks to on behalf of the organisation. Admins install integrations once; agents, workflows, and the documents pipeline use them everywhere else. This page covers the admin side — what the list shows, how installation and rotation work, what an Admin can scope, and how the surface differs from MCP servers.

The feature-level story of each integration (what it does, what scopes it asks for, what an agent can call) lives one tab over on the per-integration pages and in the cross-integration concept page. What follows is the operations surface: install, rotate, restrict, revoke.

<Frame caption="The integrations catalogue under Add integration — every connector Tale ships, filterable by category.">

![The integrations catalogue showing a grid of connector cards — Slack, Gmail, Google Drive, GitHub, Tavily, and more — each with a Connect action.](/images/platform/integrations-catalog.webp)

</Frame>

## What the list shows

Open **Settings > Integrations** to land on the org's installed integrations. Each row names an integration, shows its category (communication, storage, identity, knowledge, source control, commerce, AI), the credential type (OAuth2, API key, app token), and the connection status (connected, pending, error). The list is filterable by category and by status.

The catalogue of available integrations sits one click away under **Add integration**. The catalogue currently ships Slack, Microsoft Teams, Discord, Gmail, Outlook, Twilio, Microsoft 365, Google Drive, Confluence, WebDAV, Tavily, GitHub, Shopify, and AI image; the same catalogue is the source the integrations overview documents.

## Installing an integration

Pick an integration from the catalogue and click **Connect**. The integration declares the credential type it expects and the scopes it needs; Tale walks the OAuth dance for OAuth integrations and shows a form for API-key integrations. Once the credential lands, Tale verifies it with a no-op call to the upstream system before saving — a failure surfaces as a connection error with the upstream message attached.

Some integrations carry sub-options on install. Microsoft 365 lets you pick whether to enable OneDrive sync, SharePoint sync, both, or only single sign-on; GitHub lets you pick the repositories the org grants access to; Slack asks which channels the bot may post in. The sub-options can be changed later from the integration's row without re-installing.

## Updating definitions from the shipped catalogue

Each integration's definition — its configuration schema, connector, and icon — is copied into the organisation when the org is created and stays untouched afterwards, so a platform upgrade never changes it behind your back. **Update built-in integrations** in the **Add integration** menu replaces every shipped definition that differs from the current catalogue with the latest version. Credentials, secrets, and custom integrations you added yourself are never touched; the previous version of each replaced definition is preserved on the server so an operator can recover it.

## Rotating credentials

To rotate, open the integration's row and click **Rotate credentials**. OAuth integrations walk the dance again with the same scopes; API-key integrations show a field for the new key. The old credential stops working as soon as the new one is verified — there is no overlap window for credentials at the integration level. Reach for rotation on the cadence your security policy mandates, or whenever the upstream system reports the credential is compromised.

When a platform upgrade adds scopes to an OAuth integration you already connected, rotate once so the consent screen grants them. **Outlook** is the current case: after the upgrade that reads the account address for compose, existing Outlook connections must rotate before compose shows the real address instead of the bare provider name — until then sending still works; only the address capture waits on the new `User.Read` scope.

## Restricting an integration

Beyond the credential, an integration carries two scoping levers under its row:

- **Allowed roles.** Restrict which roles' agents and workflows may call the integration. The default is every writer role (Editor, Developer, Admin, Owner); narrowing it is how you keep, say, the Twilio integration out of Member-built agents.
- **Allowed teams.** Restrict which teams' agents and workflows may call the integration. Useful when the credential belongs to one team's work (the support team's Slack) and you do not want it leaking into another's.

Both levers are enforced at request time, not at install time — changing a lever takes effect on the next call.

## Revoking an integration

Click the row, then **Disconnect**. A disconnected integration stops authenticating immediately; agents and workflows that depend on it surface a configuration error on the next call. The row stays in the list with a disconnected badge so the audit trail survives. Reconnecting walks the credential flow again from scratch.

## Running two of the same integration

Some integrations are needed more than once — two mailboxes, two databases, two API tenants. Open the integration and choose **Duplicate** (also in the row's ⋯ menu) to create a second instance. Tale copies the integration's configuration under a new name (`Support mailbox (2)`), leaves its credential blank for you to fill in, and clones any automation bound to the original so the copy gets its own sync and its own inbox thread.

The copy starts disconnected and stays idle — no scheduled run fires until you enter its credentials and connect it, so an unconfigured duplicate never generates failing runs. Duplicate is offered only where a second instance can actually work: OAuth integrations (Gmail, Outlook, Slack) and GitHub are bound to their exact identity at the provider, so they cannot be duplicated.

## Slack bot and notifications

Slack is two-directional. Beyond the agent calling Slack (posting messages, reading channels), the org can let people talk to an agent from inside Slack and have system events pushed to a channel. Both are configured on the connected Slack row, and both ride the single OAuth credential — no second connection.

Each org brings its own Slack app, configured entirely from the Slack row — there is nothing to set on the deployment. When you connect Slack, the row shows a **Set up your Slack app** panel with a ready-to-paste app manifest and the two URLs it references: the Event Subscriptions Request URL (`/api/integrations/slack/events`) and the OAuth redirect URL. The manifest pre-fills the bot scopes, the `app_mention` and `message.im` events, and both URLs, so creating the app at api.slack.com/apps takes a couple of clicks. Paste the app's **Client ID**, **Client Secret**, and **Signing Secret** back into the row, then authorize with OAuth. The signing secret is what verifies inbound events, so the bot stays silent until it is set; inbound messages route back to the right org by Slack workspace.

On the connected Slack row an Admin picks **which agent answers Slack** (a mention in a channel or a direct message starts a threaded reply from that agent) and **which channels receive notifications**, with a per-event toggle. The shipped events are workflow failed, workflow completed, and security alerts; a Slack thread maps to one agent conversation, and the Slack author is preserved on it rather than recorded as the system.

## Integrations versus MCP servers

Two surfaces let an agent reach beyond Tale. **Integrations** are the first-party, vendor-specific connectors documented here. **MCP servers** are external processes exposing the Model Context Protocol; the org registers them under **Settings > MCP servers** and approves each tool the first time it is called. Reach for an integration when one exists for the target system; reach for [MCP servers](/platform/integrations/mcp-servers) when no integration covers what you need.

## Where this fits

Integrations are the credential half of the agent-to-outside-world story; the agent-side half (which tools an agent gets, how it calls them, what the trust boundary looks like) lives under [Agent tools](/platform/agents/tools). The natural next read for a new admin is [Integrations overview](/platform/integrations/overview) — it names every shipped integration grouped by what it does and gives the per-integration setup at a glance.
