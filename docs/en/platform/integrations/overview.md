---
title: Integrations overview
description: Connect Tale to REST APIs and SQL databases through named, sandboxed connectors.
---

An integration is a developer-defined connector that exposes a remote system as a fixed set of named operations agents and automations can call by name with typed parameters. Once installed, those operations become tools — selectable in an agent's tool list, invocable from an **Action** step in an automation, gated by approval when they write. Configuration lives under **Settings > Integrations** and is reserved to Developer and Admin; everyone else sees the resulting tools without seeing the connector behind them.

This page covers the integration model itself — the two connector types, the authentication shapes, the read/write split, the bundled examples, and how to install one. The related connections at the bottom of **Settings > Integrations** (mailboxes for the inbox, OneDrive for knowledge imports, API keys for the Tale API itself) sit there for discoverability but use their own setup surfaces; they are covered briefly at the end. The "bring your own tool catalogue" path via an external MCP server has a page of its own at [MCP servers](/platform/integrations/mcp-servers).

## The two connector types

Connectors come in two shapes, each suited to a different remote system.

A **REST API** connector wraps any HTTP service. The connector's `config.json` declares the operations it publishes, the authentication methods it supports, and an allowed-hosts list — the sandboxed connector code can only reach those hosts, so a misbehaving connector cannot exfiltrate to an unrelated domain. Supported authentication methods are API key (in a header or query parameter), bearer token, HTTP basic, and OAuth 2.0 (authorisation code flow with automatic refresh-token rotation).

A **SQL** connector connects to PostgreSQL, MySQL, or Microsoft SQL Server. The agent never writes SQL freehand. Instead, the connector declares a fixed list of named operations, each pairing a pre-written query with a parameter schema; the agent picks an operation and supplies validated values for the placeholders. Read-only database credentials are still the right move — the connector model gates the queries Tale will run, but the database account itself stays in your DBA's hands.

## Operations

An operation is the unit an agent or automation calls. Every operation has:

- A **name** — the identifier the caller picks (`create_order`, `list_customers`, `lookup_reservation`).
- A **description** — what the operation does and when to use it. The agent reads this to pick.
- A **parameter schema** — JSON Schema describing inputs. The platform validates before the call runs.
- An **operation type** — `read` or `write`. Defaults to `read`.
- A **requires-approval** flag — when true, every invocation generates an approval card.

Operations are the connector's contract. New behaviour means adding (or editing) an operation in `config.json` and shipping the change; the agent never composes ad-hoc HTTP requests or SQL queries against the underlying system.

## Read, write, and approvals

Operations marked `write` default to requiring approval before they execute. When an agent or automation calls one, the platform pauses the call, posts an approval card in the relevant chat or **Approvals** inbox, and waits for a human accept or reject. Only on accept does the call run. Read operations execute immediately. The full doctrine — who can approve, how the card looks, what happens on reject — is at [Approvals](/platform/workspace/approvals); use it for billing actions, mass email, production data writes, and anything else that benefits from a second pair of eyes.

## Authentication and secrets

A connector's `secretBindings` array names the credentials it reads at runtime via `secrets.get('<key>')`. When you connect the integration in **Settings > Integrations**, the form prompts for exactly those keys; the values are stored encrypted at rest, scoped to your organisation, and never returned to the UI once saved. OAuth 2.0 connectors go through the standard authorisation-code flow, store both access and refresh tokens, and refresh the access token automatically before it expires. SQL connectors store the server, port, database, username, and password in the same encrypted store.

The **Setup guide** field on a connector renders any Markdown the author provided into the manage dialog under **Configuration guide** — that is the right place to tell the user where to generate the API key, which OAuth scopes to grant, or which database role to create. After credentials are entered, **Test connection** invokes the connector's `testConnection` hook before saving; a failed test surfaces the error message inline so credentials can be fixed without leaving the dialog.

## Bundled examples

Thirteen ready-to-use connectors ship in the repository at `examples/integrations/`. Each one is a complete `config.json` plus connector source; fork it as the starting point for your own variant, or install it as-is.

| Example          | Type     | Auth         | What it covers                                                   |
| ---------------- | -------- | ------------ | ---------------------------------------------------------------- |
| **AI image**     | rest_api | bearer_token | Image generation against OpenAI-compatible providers.            |
| **Circuly**      | rest_api | basic_auth   | Products, customers, and subscriptions in Circuly.               |
| **Discord**      | rest_api | bearer_token | Guilds, channels, and messages via the Discord Bot API.          |
| **GitHub**       | rest_api | bearer_token | Repositories, issues, pull requests, and code search.            |
| **Gmail**        | rest_api | oauth2       | Messages, labels, threads, and drafts in Gmail.                  |
| **Google Drive** | rest_api | oauth2       | Sync files from Drive folders into Tale documents.               |
| **Outlook**      | rest_api | oauth2       | Mail, calendar, and contacts via Microsoft Graph.                |
| **Protel**       | sql      | basic_auth   | Direct SQL against a Protel hotel PMS — reservations and folios. |
| **Shopify**      | rest_api | api_key      | Products, customers, and orders in the Shopify Admin API.        |
| **Slack**        | rest_api | oauth2       | Channels, messages, users, and file uploads.                     |
| **Tavily**       | rest_api | api_key      | Open-web search and page extraction tuned for LLM agents.        |
| **Teams**        | rest_api | oauth2       | Teams, channels, messages, and chats via Microsoft Graph.        |
| **Twilio**       | rest_api | basic_auth   | SMS, voice calls, and phone-number management.                   |

## Install or build one

Two paths land a connector on the same `config.json` plus source on the server.

**From the UI.** Open **Settings > Integrations > Add integration** and drop a `.zip` package or select `config.json`, `connector.ts` (or `connector.js`), and an icon individually. The total upload is capped at 1 MB. After upload, fill in credentials and click **Test connection**.

**From project code.** A project scaffolded by `tale init` has an `integrations/` directory; each subdirectory is one connector (`integrations/<slug>/{config.json, connector.ts, icon.svg}`). The platform live-reloads on save, so iterating is the same as editing any other source file. The file format and sandbox API are documented at [Build an integration](/develop/integrations); for AI-assisted authoring inside an editor, see [AI-assisted development](/develop/ai-assisted-development).

## MCP servers

Beyond `rest_api` and `sql` connectors, Tale also consumes external Model Context Protocol servers. An MCP server is a third-party process that publishes its own tool catalogue over a small standardised RPC; Tale registers the server once and its tools become available to agents alongside connector operations. The mental rule: reach for an MCP server when a third party already publishes one for their product, and reach for a connector when you control the wrapper and want Tale's read/write semantics and the **Configuration guide** UX. The full reference for the registration flow, the three supported transports, and the approval semantics on the discovered tools is at [MCP servers](/platform/integrations/mcp-servers).

## Related connections

Three items live under **Settings > Integrations** for discoverability but are not `rest_api` or `sql` connectors — each has its own setup surface.

**Email mailboxes (for Conversations).** Connect an IMAP+SMTP mailbox to power the [Conversations](/platform/workspace/conversations) inbox. Incoming messages become threads; replies sent from the platform are delivered as normal email.

**Microsoft OneDrive.** Connect a Microsoft 365 account so users can import OneDrive files directly into the [knowledge base](/platform/workspace/knowledge-base) without downloading them first. Configured through the knowledge-base import flow, not as a connector.

**API keys.** API keys grant programmatic access to the Tale API itself. They live under **Settings > Integrations > API keys** because the surface is the same admin tab, not because they are connectors. Each key inherits the role of the user who created it; revoke at any time from the same screen. Endpoint details are in the [API reference](/develop/api-reference).

## Where this fits

Integrations are the bridge between Tale's AI and the systems where the real data lives. An agent without integrations can only talk; an agent with the right operation can create the ticket, query the database, send the email, post the Slack message. To grant an agent access to a specific operation, the next page is [Create an agent](/platform/agents/create); for the API-key counterpart that lets your code call Tale instead of Tale calling out, open [API reference](/develop/api-reference).
