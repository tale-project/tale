---
title: Connectors
description: The connectors Tale ships, the credentials your organisation stores against them, and how a connector's actions reach automations and agent runs.
---

A connector is two things at once: a **connector** that ships with the platform, and the **credentials** your organisation stores against that connector. The connector carries the vendor knowledge — which actions exist, what each one takes and returns, how signing in works — and is identical in every organisation. The credentials are yours, and a connector holds as many as you need: one per workspace, store, mailbox, or bot. Thirteen connectors ship today, and each one waits in the **Add credential** catalog under **Settings > Connectors** for its first credential.

Prefer to watch first? Episode 7 walks the doors to the outside world — connectors, MCP, and the boundaries — in two and a half minutes, captions included.

<Video src="/videos/en/tutorials/ep7-connectors/ep7-connectors.en.mp4" poster="/videos/en/tutorials/ep7-connectors/ep7-connectors.en.webp" captions="/videos/en/tutorials/ep7-connectors/ep7-connectors.en.vtt" lang="en" title="Episode 7 — Connectors & the outside world" caption="Episode 7 — Connectors & the outside world (2:30)">

</Video>

## What a connector is

There is nothing to install. Every connector arrives with the platform, which is why the catalog looks the same in every organisation and why an upgrade keeps it current without anyone maintaining it. A connector is a definition: a display name and a one-line description, the category tags it belongs to, the authentication methods it accepts, and the list of actions it can perform against the vendor.

Because the definition is shared, the only thing your organisation decides is which accounts Tale may act as. That decision is a credential, and it is the whole of setup.

## The connectors that ship

Thirteen connectors ship, each tagged with the category it belongs to — Knowledge, Messaging, Email, Developer, Commerce, Search, or Files. **Sign-in** is the authentication method the connector accepts, which decides what the credential form asks for; **Actions** is how many operations it exposes, the same count its card in the **Add credential** catalog shows.

| Connector               | What connecting it buys you                                                                                 | Sign-in             | Actions |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------- | ------- |
| **Confluence**          | Import Confluence Cloud pages into Tale's knowledge base.                                                   | Username & password | 2       |
| **Discord**             | Post messages and manage channels in your Discord server.                                                   | Token               | 8       |
| **GitHub**              | Manage repositories, issues, and pull requests on GitHub.                                                   | Token               | 19      |
| **Gmail**               | Read, send, and organize email in Gmail.                                                                    | OAuth               | 9       |
| **Google Drive**        | Import files from Google Drive into Tale's knowledge base.                                                  | OAuth               | 2       |
| **IMAP / SMTP Mailbox** | Connect a private IMAP + SMTP mail server to Conversations — no Gmail or Outlook account required.          | Username & password | 3       |
| **Microsoft Outlook**   | Manage Outlook mail, calendar, and contacts.                                                                | OAuth               | 10      |
| **Shopify**             | Sync products, customers, and orders from your Shopify store.                                               | API key             | 9       |
| **Slack**               | Send messages and interact with channels in Slack.                                                          | OAuth               | 7       |
| **Tavily**              | Real-time web search and page extraction for AI research.                                                   | API key             | 2       |
| **Microsoft Teams**     | Send messages and manage channels in Microsoft Teams.                                                       | OAuth               | 9       |
| **Twilio**              | Send SMS and make voice calls with Twilio.                                                                  | Username & password | 7       |
| **WebDAV Files**        | Read, write, and list files in the organisation's WebDAV store — the same files the `/dav` endpoint serves. | Username & password | 4       |

Pages and files pulled in through Confluence or Google Drive run through the same indexing pipeline as a direct upload, and answers cite them back to the source — see [Documents](/platform/knowledge/documents). OneDrive and SharePoint import from Knowledge → Documents (per-user authorization), not as an org connector. The WebDAV connector is the write side of the same store your devices mount as a network drive, covered in [WebDAV](/platform/connectors/webdav).

## Credentials on a connector

A connector holds as many credentials as your organisation needs. One Slack workspace per business unit, one Shopify store per market, one mailbox per support queue — each is a separate row under the connector, with its own secret and its own state. That is what lets a single automation library serve several teams without any of them borrowing another's account.

Each credential carries four things:

- **Name** — the name an action uses to pick this credential. Write it for whoever reads the automation months from now: `Support inbox`, `EU store`, `Release bot`.
- **Authentication method** — **API key**, **Token**, **Username & password**, or **OAuth**, chosen from what the connector accepts.
- **Default** — one credential per connector can hold this. An automation node — or an agent's call through the broker — that names no credential uses the default.
- **State** — a credential is either in use or **Disabled**. Disabling keeps the row and its configuration but stops anything calling through it.

Leave a connector without a default and it still works for callers that name a credential outright, but a caller that names none has nothing to fall back on. The connector's section says as much, and the fix is to promote one of the existing credentials.

<Note>

Confluence and Shopify have no single vendor host — the API lives at your own Atlassian site or your own `myshopify.com` store. Both therefore ask each credential for an **Instance URL**, and their section carries the line _Each credential names its own instance_. Point Confluence at the address you open Confluence at, and Shopify at the store's admin origin rather than its storefront domain.

</Note>

## Connecting one

Where you start depends on what the connector accepts. Token-shaped connectors open a form and take the secret directly; OAuth connectors send you to the vendor's consent screen and return with the credential already filled in. Both paths end in the same place — a named row under the connector.

<Steps>

<Step title="Open Settings > Connectors">

The page is the table of credentials your organisation already holds — one row per credential with its name, its connector, and its authentication method. On a fresh organisation the table is empty; the shipped catalog waits behind **Add credential**.

</Step>

<Step title="Pick the connector">

**Add credential** opens the catalog: connectors you already hold a credential for come first, the rest follow with their category tags and action counts, and search narrows the list. Picking one moves you to the setup step.

<Frame caption="Add credential opens on the catalog — the thirteen shipped connectors, with the ones you already hold a credential for listed first.">

![The Add credential dialog over the Settings > Connectors table, listing the shipped connectors as cards with their category tags and action counts, a search field at the top, and the already-configured Tavily connector at the head of the list.](/images/platform/connectors-add-credential.webp)

</Frame>

</Step>

<Step title="Add the credential">

A connector that takes a key, a token, or a username and password shows its form and takes the secret directly. An OAuth connector offers **Connect** instead, which runs the vendor's consent flow and binds the result to a new row.

</Step>

<Step title="Name it, and make it the default">

Give the credential a name your automations can point at, and promote it if it should be the one used when nobody names a credential. The connector's actions become available to automations — and, on the read side, to project agents — as soon as the row exists.

</Step>

</Steps>

The per-method detail — what each form asks for, how to replace a secret, what happens when an authorization expires — lives on [Connector credentials](/platform/admin/connectors).

## Actions in automations and agent runs

Every action a connector declares has a name, a description, an input schema, an output signature, and a declared effect of `read` or `write`. Automations place an action as a node in the workflow editor; a project agent reaches the read actions from its sandbox through a broker that runs them with the stored credential and hands back only the result. Chat reaches none of them — the chat assistant's tools are fixed and read-only. Either way the call resolves a credential first — the one the caller names, or the connector's default — and fails clearly when neither exists.

<Warning>

Write actions change something in the other system: a message posted, an issue opened, an SMS sent. They run only from an automation, and they gate behind your organisation's approval policy, so the run parks and a person releases the call on the run's detail page. Read [Configure approvals](/platform/approvals/configure) before pointing an automation at one.

</Warning>

## When no connector fits

Thirteen connectors cover the systems most teams reach for, and they cannot cover an internal API, a homegrown tool, or a vendor nobody has written a connector for. Registering your own MCP server for agents to call is not part of this version — what bridges that gap is your own code in one of two places. A [project agent](/platform/projects/project-agents) holds **Secrets** — an API key handed to it as an environment variable — and calls the service straight from its sandbox. An [automation](/platform/automations/catalog) calls connector actions and runs your own JavaScript in `transform` nodes, on a schedule or a webhook.

The one MCP surface Tale ships points the other way: your MCP client connects to Tale under **Settings > API > MCP**, as [MCP servers](/platform/connectors/mcp-servers) explains.

## Where this fits

Connectors are how Tale reaches the systems your work already lives in, and credentials are how you decide which accounts it may act as. From here, [Connector credentials](/platform/admin/connectors) is the operations side — adding, replacing, disabling, and reconnecting the rows under each connector. [Project agents](/platform/projects/project-agents) shows how a connector's actions arrive in an agent's equipment, [Configure approvals](/platform/approvals/configure) holds the write ones, and [MCP servers](/platform/connectors/mcp-servers) says what replaced outbound MCP servers in this version.
