---
title: Integrations
description: The third-party systems Tale connects to — the catalog under Settings > Integrations, what each connector does, how connecting works, and how the surface differs from MCP.
---

Integrations are the bridges between Tale and the rest of your stack: agents call them as tools, workflows call them at steps, and the knowledge pipeline pulls documents through them. The org connects each one once under **Settings > Integrations**; from then on, anything in Tale can use it without re-authenticating. This overview names the shipped catalog and the two ways to extend it.

Prefer to watch first? Episode 7 walks the doors to the outside world — connectors, MCP, and the boundaries — in two and a half minutes, captions included.

<Video src="/videos/en/tutorials/ep7-integrations/ep7-integrations.en.mp4" poster="/videos/en/tutorials/ep7-integrations/ep7-integrations.en.webp" captions="/videos/en/tutorials/ep7-integrations/ep7-integrations.en.vtt" lang="en" title="Episode 7 — Integrations & the outside world" caption="Episode 7 — Integrations & the outside world (2:30)">

</Video>

<Frame caption="Settings > Integrations on the All integrations tab — the full catalog, each card one Connect away.">

![The Settings Integrations page showing a search field, an Add integration button, and a card grid of twelve services including Confluence, GitHub, Gmail, Slack, and Twilio.](/images/platform/integrations-catalog.webp)

</Frame>

## The catalog

The page has two tabs — **Connected** shows what the org already uses, **All integrations** the full catalog with a search field. Each card's description is the honest one-liner of what connecting buys you:

| Integration             | What it does                                                                                                                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confluence**          | Import Confluence Cloud pages into Tale's knowledge base.                                                                                                                                                   |
| **Discord**             | Post messages and manage channels in your Discord server.                                                                                                                                                   |
| **GitHub**              | Manage repositories, issues, and pull requests on GitHub.                                                                                                                                                   |
| **Gmail**               | Read, send, and organize email in Gmail.                                                                                                                                                                    |
| **Google Drive**        | Import files from Google Drive into Tale's knowledge base.                                                                                                                                                  |
| **IMAP / SMTP Mailbox** | Connect a private IMAP + SMTP mail server to the Inbox — no Gmail or Outlook account required; sending can go through a separate SMTP relay (Resend, SendGrid, Amazon SES, …) instead of the mailbox login. |
| **Microsoft Outlook**   | Manage Outlook mail, calendar, and contacts.                                                                                                                                                                |
| **Shopify**             | Sync products, customers, and orders from your Shopify store.                                                                                                                                               |
| **Slack**               | Send messages and interact with channels in Slack.                                                                                                                                                          |
| **Tavily**              | Real-time web search and page extraction for AI research.                                                                                                                                                   |
| **Microsoft Teams**     | Send messages and manage channels in Microsoft Teams.                                                                                                                                                       |
| **Twilio**              | Send SMS and make voice calls with Twilio.                                                                                                                                                                  |

## Connecting one

Click **Connect** on a card. OAuth-backed services walk the vendor's consent flow; token-backed ones ask for the credential in an **Authentication** section. The detail view also lists the integration's operations — the ones badged **Requires approval** hold in chat until a person signs off, which is how outbound writes stay accountable ([Configure approvals](/platform/approvals/configure)).

Documents imported through Confluence or Google Drive flow through the same indexing pipeline as direct uploads, and citations point back to the source — see [Documents](/platform/knowledge/documents).

## Extending beyond the catalog

**Add integration** uploads a custom connector — a small package of `config.json`, a `connector.js` or `.ts`, and an icon (as a `.zip` or individual files, 1 MB total). The preview shows its operations, allowed hosts, and connector code before you install, and the result appears in the catalog like any shipped entry.

When no connector fits and you can host the bridge yourself, register an [MCP server](/platform/integrations/mcp-servers) instead — a generic protocol surface rather than a vendor-specific connector.

<Note>

WebDAV is not in this catalog because it points the other way: it serves Tale's documents to your devices as a network drive. See [WebDAV](/platform/integrations/webdav).

</Note>

## Where this fits

Integrations are how agents act on the world outside Tale. For the agent author, [Agent tools](/platform/agents/tools) shows how an integration's operations surface as tools; for the approver, [Configure approvals](/platform/approvals/configure) is where the write operations are held; for the builder with no connector to reach for, [MCP servers](/platform/integrations/mcp-servers) is the open-ended alternative.
