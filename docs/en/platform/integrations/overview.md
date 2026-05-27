---
title: Integrations
description: Third-party systems Tale can read from and write to — communication, storage, identity, dev, knowledge — plus how the integration surface differs from MCP.
---

Integrations are the bridges between Tale and the rest of your stack. Agents call them as tools, workflows trigger them at steps, and the documents pipeline pulls files from them. Each integration is a single JSON config plus a credential the org stores once; once connected, anything in Tale can use it without re-authentication. This overview names the shipped integrations grouped by what they do.

The shape of an integration is the same across every entry below — an OpenAI-compatible REST surface or an OAuth2 dance, with operations declared in a JSON config under `examples/default/integrations/`. Custom integrations follow the same shape; you do not need a code change to add one.

## How integrations differ from MCP

Two surfaces let an agent reach beyond Tale. **Integrations** are first-party, OAuth- or API-key-secured connectors the org configures once under **Settings > Integrations**. **MCP servers** are external processes (often self-hosted) exposing the Model Context Protocol; the org registers them under **Settings > MCP servers** and approves each tool the first time it is called. Reach for an integration when one exists for your target system; reach for [MCP servers](/platform/integrations/mcp-servers) when no integration covers what you need and you can host the bridge yourself.

## Communication

| Integration | What it does                                         | Setup                              |
| ----------- | ---------------------------------------------------- | ---------------------------------- |
| **Slack**   | Read channels, send messages, react to events.       | OAuth2 from the Slack workspace.   |
| **Teams**   | Same shape for Microsoft Teams — channels and chats. | OAuth via Microsoft Entra ID.      |
| **Discord** | Bot-driven message send and channel read.            | Discord bot token.                 |
| **Gmail**   | Read inbox, send mail, label.                        | OAuth via Google.                  |
| **Outlook** | Read inbox, send mail, calendar reads.               | OAuth via Microsoft Entra ID.      |
| **Twilio**  | SMS, voice, WhatsApp Business.                       | Twilio account SID and auth token. |

## Storage and documents

| Integration       | What it does                                                                                                                  | Setup                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Microsoft 365** | OneDrive and SharePoint document sync into [Knowledge](/platform/knowledge/documents); single sign-on via Microsoft Entra ID. | OAuth via Microsoft Entra ID; the same tenant powers SSO and document sync. |
| **Google Drive**  | Pull files from Drive folders into Knowledge.                                                                                 | OAuth via Google.                                                           |
| **Confluence**    | Pull Confluence pages into Knowledge; agents cite the source page.                                                            | API token + base URL (cloud or self-hosted).                                |
| **WebDAV**        | Read folders from any WebDAV server (Nextcloud, ownCloud, generic).                                                           | Server URL, username, password.                                             |

Documents synced via any of these flow through the same indexing pipeline as direct uploads — see [Documents](/platform/knowledge/documents). The source field on each indexed document names the integration so citations point back to the original.

## Identity

Microsoft 365 also covers identity. Connecting it under **Settings > Integrations** enables OneDrive and SharePoint reads; connecting it under **Settings > Authentication** enables single sign-on for the whole org through the same Entra ID tenant. The two paths share credentials and provisioning rules — see [Members and roles](/platform/admin/members-and-roles) for the role mapping.

## Knowledge and research

| Integration | What it does                                                                           | Setup                      |
| ----------- | -------------------------------------------------------------------------------------- | -------------------------- |
| **Tavily**  | Open-web search and page extraction for [Deep research](/platform/chat/deep-research). | API key from `tavily.com`. |

## Source control

| Integration | What it does                                             | Setup                         |
| ----------- | -------------------------------------------------------- | ----------------------------- |
| **GitHub**  | Read repositories, search code, react to issues and PRs. | GitHub App or personal token. |

## Vertical: commerce and hospitality

| Integration | What it does                                         | Setup                    |
| ----------- | ---------------------------------------------------- | ------------------------ |
| **Shopify** | Read orders, customers, and products.                | Shopify Admin API token. |
| **Protel**  | Hotel PMS — read reservations and guest data.        | API key + property ID.   |
| **Circuly** | Subscription commerce platform — read subscriptions. | API key.                 |

## AI services

| Integration  | What it does                                                            | Setup                                                                                        |
| ------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **AI image** | Image-generation surface that wraps the configured image-tagged models. | No setup — uses the model providers under [Settings > Providers](/platform/admin/providers). |

## Adding a custom integration

Custom integrations follow the same JSON shape as the ones above. Drop a config into `TALE_CONFIG_DIR/integrations/<slug>/config.json` declaring the operations, auth method, and allowed hosts; the integration appears in **Settings > Integrations** for users to connect. The shape and validation rules live alongside the shipped configs in `examples/default/integrations/`.

For richer or self-hosted bridges, [MCP servers](/platform/integrations/mcp-servers) are the alternative surface — every MCP server you register adds its tools to the agent toolbelt with per-tool approval.

## Where this fits

Integrations are how agents act on the world outside Tale. The next read depends on what you came to do — for the agent author, [Agent tools](/platform/agents/tools) explains how an integration's operations surface as a tool family on the agent; for the org admin, [Settings > Integrations](/platform/admin/integrations) is where credentials are stored and rotated; for the developer wiring something new, [MCP server from scratch](/tutorials/developer/mcp-server-from-scratch) is the end-to-end build of a custom bridge.
