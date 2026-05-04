---
title: Integrations overview
description: Connect Tale to REST APIs and SQL databases through developer-defined connectors.
---

An integration is a developer-defined connector that exposes a remote system's capabilities — REST endpoints or SQL queries — as a fixed set of named operations. Once installed, those operations are tools the chat assistant, agents, and automation steps can call by name with typed parameters. Configuration lives in **Settings > Integrations** and requires the Developer role or higher; consumers just call the operations the connector publishes.

The platform supports two connector types: `rest_api` for HTTP services and `sql` for direct database access. Anything else listed under **Settings > Integrations** in the UI — e-mail mailboxes, Microsoft OneDrive, API keys for the Tale API itself — is a related connection that uses its own configuration surface, not the connector model. Those are covered at the bottom of this page.

## Integration types

### REST API

REST connectors wrap any HTTP-based service. The connector's manifest lists the supported authentication methods and the hosts it is allowed to reach; sandboxed connector code handles each operation. Supported authentication methods:

| Method           | How it works                                             |
| ---------------- | -------------------------------------------------------- |
| **API key**      | Pass a key in a header or query parameter.               |
| **Bearer token** | `Authorization: Bearer <token>` header on every request. |
| **Basic auth**   | Username and password, base64-encoded.                   |
| **OAuth 2.0**    | Authorization-code flow with automatic token refresh.    |

The `allowedHosts` field in the manifest acts as a network allow-list — the connector can only reach the hosts it declares. See [Create an agent](/platform/agents/create) for how to grant an agent access to an integration's operations.

### SQL

SQL connectors connect to PostgreSQL, MySQL, or Microsoft SQL Server. The agent does **not** write SQL freehand. Instead, the integration's manifest registers a fixed list of named operations, each with a pre-written query and a parameter schema; the agent picks an operation and supplies values for the placeholders. Read-only credentials are still strongly recommended, because write operations and approval gates only constrain what the connector publishes — they do not constrain what the database account itself is allowed to do.

## Operations

Every integration exposes a list of operations. An operation has a `name` (the identifier the agent calls), a `description` (what it does and when to use it), a `parametersSchema` (a JSON Schema describing inputs), an optional `operationType` of `read` or `write`, and an optional `requiresApproval` flag. The agent picks an operation by name and supplies validated parameters; it never composes ad-hoc HTTP calls or SQL. This is how a connector stays predictable: a new operation only exists if a developer adds it to the manifest.

## Read, write, and approvals

Operations marked `operationType: write` default to requiring approval before they execute. When an agent or automation invokes such an operation, an approval card appears in the chat — a human accepts or rejects it, and only on accept does the call run. See [Approvals](/platform/workspace/approvals) for the full flow. Use this for billing actions, mass e-mail, production data writes, and anything else where you want a human in the loop. Read operations execute directly with no approval step.

## Authentication and secrets

The manifest's `secretBindings` array names the credential keys a connector reads at runtime via `secrets.get('<key>')`. When you connect the integration in **Settings > Integrations**, the UI prompts for exactly those keys and stores the values encrypted at rest, scoped to your organisation. OAuth 2.0 connectors use the standard authorisation-code flow, store both access and refresh tokens, and refresh access tokens automatically when they expire. SQL connectors store the database server, port, database name, username, and password in the same encrypted store.

## Setup guide and test connection

Connectors can ship a Markdown `setupGuide` that the platform renders under **Configuration guide** in the manage dialog — use it to point users at where to generate the API key, which OAuth scopes to grant, or what database role to create. After credentials are entered, **Test connection** invokes the connector's lightweight `testConnection` hook before saving; a failed test surfaces the connector's error message inline so users can fix the credentials without leaving the dialog.

## Bundled examples

The repository ships thirteen ready-to-use connectors at [github.com/tale-project/tale/tree/main/examples/integrations](https://github.com/tale-project/tale/tree/main/examples/integrations). Fork one as the starting point for a custom connector against the same vendor, or install one as-is.

| Example          | Type     | Auth         | What it covers                                                     |
| ---------------- | -------- | ------------ | ------------------------------------------------------------------ |
| **AI image**     | rest_api | bearer_token | Image generation against OpenAI-compatible providers.              |
| **Circuly**      | rest_api | basic_auth   | Products, customers, and subscriptions in Circuly.                 |
| **Discord**      | rest_api | bearer_token | Guilds, channels, and messages via the Discord Bot API.            |
| **GitHub**       | rest_api | bearer_token | Repositories, issues, pull requests, and code search.              |
| **Gmail**        | rest_api | oauth2       | Messages, labels, threads, and drafts in Gmail.                    |
| **Google Drive** | rest_api | oauth2       | Sync files from Drive folders into Tale documents.                 |
| **Outlook**      | rest_api | oauth2       | Mail, calendar, and contacts via Microsoft Graph.                  |
| **Protel**       | sql      | basic_auth   | Direct SQL access to a Protel hotel PMS — reservations and folios. |
| **Shopify**      | rest_api | api_key      | Products, customers, and orders in the Shopify Admin API.          |
| **Slack**        | rest_api | oauth2       | Channels, messages, users, and file uploads.                       |
| **Tavily**       | rest_api | api_key      | Open-web search and page extraction tuned for LLM agents.          |
| **Teams**        | rest_api | oauth2       | Teams, channels, messages, and chats via Microsoft Graph.          |
| **Twilio**       | rest_api | basic_auth   | SMS, voice calls, and phone-number management.                     |

## Install or build a custom integration

There are two ways to install a connector. Both end up with the same `config.json` plus connector code on the server.

**Upload from the UI.** Open **Settings > Integrations**, click **Add integration**, then drop a `.zip` package or select `config.json`, the connector source (`connector.ts` or `connector.js`), and an icon individually. The total upload is capped at 1 MB. After upload, fill in credentials and click **Test connection**.

**Author as project code.** A project scaffolded by `tale init` has an `integrations/` directory; each subdirectory is one connector (`integrations/<slug>/{config.json, connector.ts, icon.svg}`). The platform live-reloads on save, so iterating is the same as editing any other source file. The full file format and sandbox API are documented in [Build an integration](/develop/integrations); for AI-assisted authoring inside an editor, see [AI-assisted development](/develop/ai-assisted-development).

## Related connections

A few other items live under **Settings > Integrations** for discoverability but are not `rest_api` or `sql` connectors — they have their own configuration surfaces.

**E-mail (Conversations inbox).** Connect an IMAP+SMTP mailbox to power the [Conversations](/platform/workspace/conversations) inbox. Incoming e-mails become threads; replies sent from the platform are delivered as normal e-mails. Configured separately from connectors.

**Microsoft OneDrive.** Connect a Microsoft 365 account so users can import OneDrive files directly into the [knowledge base](/platform/workspace/knowledge-base) without downloading them first. Configured through the knowledge-base import flow, not as a connector.

## API keys

API keys grant programmatic access to the Tale API itself. They live under **Settings > Integrations > API keys** because that is the same admin surface, not because they are connectors. Each key inherits the role of the user who created it; revoke at any time from the same screen. Endpoint details are in the [API reference](/develop/api-reference).
