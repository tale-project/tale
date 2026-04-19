---
title: Integrations overview
description: Connect Tale to REST APIs, SQL databases, email, and cloud storage.
---

Integrations let Tale talk to external systems. Developers configure them once; agents, automations, and the chat assistant then use them to read and write data in those systems. Configuration lives in **Settings > Integrations** and requires the Developer role or higher.

## Integration types

### REST API

Connect any HTTP-based API by entering the base URL and credentials. Supported authentication methods:

| Method           | How it works                                             |
| ---------------- | -------------------------------------------------------- |
| **API key**      | Pass a key in a header or query parameter.               |
| **Bearer token** | `Authorization: Bearer <token>` header on every request. |
| **Basic auth**   | Username and password, base64-encoded.                   |
| **OAuth 2.0**    | Authorization-code flow with automatic token refresh.    |

Once added, the integration exposes each configured endpoint as a tool the AI agent can call. See [Create an agent](/platform/agents/create) for how to grant tool access.

### SQL

Connect a PostgreSQL, MySQL, or Microsoft SQL Server database. The AI agent and automations can query it using plain language that is translated to SQL against the schema you've registered.

Read-only credentials are strongly recommended — queries the AI generates are executed as-is against the database.

### E-mail (conversations)

Connect an IMAP + SMTP mailbox to power the [Conversations](/platform/workspace/conversations) inbox. Incoming e-mails become conversation threads. Replies sent from the platform are delivered as normal e-mail responses.

### Microsoft OneDrive

Connect a Microsoft 365 account to enable OneDrive document sync. Users can then import files from OneDrive directly into the knowledge base without downloading them to their device first. See [Knowledge base](/platform/workspace/knowledge-base).

## API keys

Generate API keys for programmatic access to the Tale API. Keys inherit the permissions of the user who created them, scoped to that user's role. Keys can be revoked at any time from **Settings > Integrations > API keys**.

For endpoint details see the [API reference](/develop/api-reference).

## Approvals

Integrations can require approval before each operation. When an agent or automation triggers an integration call, an approval card appears in the chat — see [Approvals](/platform/workspace/approvals). This is useful for destructive or expensive operations (billing actions, mass e-mails, production data changes).
