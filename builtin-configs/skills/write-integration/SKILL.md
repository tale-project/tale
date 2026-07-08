---
name: write-integration
icon: lucide:plug
description: 'Use this skill whenever you create or update an integration in a Tale organization — a connector definition for a REST API, SQL database, or IMAP/SMTP mailbox. Triggers include: "connect X", "add an operation to an integration", "set up OAuth / an API key for …", or a workflow or automation that needs an external system. Never author a connector without it — and never create one before listing the existing integrations; if one already reaches the system, add the missing operation to it instead. Workflows call integrations from action steps (write-workflow); automations declare them in requires.integrations (write-automation).'
---

# write-integration

An integration is a bundle directory `integrations/<slug>/` whose `config.json` declares the
connector. The **slug is the directory name** — there is no slug field. Credentials are NEVER in
the file: they live in the platform's credential store; the file only names its `authMethod` and
`secretBindings`.

## Reuse before you create — tick every box

- [ ] List the existing integrations first.
- [ ] One already reaches the target system → use it; add the missing operation to it if needed.
- [ ] Nothing reaches it → only then author a new connector.

Two connectors to the same system with different operation sets is the defect this box exists to
prevent.

## Required fields

- `title` (1–200 chars).
- `authMethod` — `api_key` | `bearer_token` | `basic_auth` | `oauth2` (list alternates in
  `supportedAuthMethods`; OAuth needs `oauth2Config` with `authorizationUrl`, `tokenUrl`,
  optional `scopes`).

## The fields that matter

- `type` — `rest_api` | `sql` | `imap_smtp` and `description` (≤2000), `version` (integer).
- `operations` — the callable surface, one entry per operation: `name` (required), `title`,
  `description`, `operationType` (`read` | `write`), `requiresApproval` (route the call through an
  approval card), `requiredScopes`, `parametersSchema` (a JSON-Schema object for the params).
- `connectionConfig` — `domain`, `apiVersion`, `apiEndpoint`, `timeout`, `rateLimit`, plus any
  connector-specific keys.
- `allowedHosts` — restrict which hosts the connector may call.
- SQL connectors: `sqlConnectionConfig` (`engine` `mssql` | `postgres` | `mysql`, `readOnly`,
  `options`, `security` caps like `maxResultRows`) and `sqlOperations` — each with a
  **parameterized** `query` plus `parametersSchema`; never splice user input into SQL text.
- `capabilities` — `canSync`, `canPush`, `canWebhook`, `syncFrequency`.
- `bundles` — `agents` / `workflows` auto-installed when the credential connects and
  cascade-disabled on disconnect.
- `setupGuide` — ≤5000 chars of markdown shown in the integration config UI (never sent to the
  model).

## Minimal valid example

```json
{
  "title": "Status Page",
  "type": "rest_api",
  "authMethod": "api_key",
  "connectionConfig": { "apiEndpoint": "https://api.example.com/v1" },
  "operations": [
    {
      "name": "get_status",
      "operationType": "read",
      "description": "Fetch the current system status"
    }
  ]
}
```

## Validation

`config.json` must parse against the shared integration schema — a failing field is rejected with
its path and message. Mark every mutating operation `operationType: "write"` (and usually
`requiresApproval: true`) so it routes through approval; a write mislabelled as read bypasses the
approval card.

Siblings: `write-workflow` (action steps that call operations), `write-agent`
(`integrationBindings`), `write-automation` (shipping the connector definition inside a bundle).
