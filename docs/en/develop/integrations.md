---
title: Integrations
description: Building custom integrations — REST connectors, SQL databases, MCP servers — and where each one fits next to the shipped integration catalogue.
---

Integrations are the seams between Tale and the rest of your stack. The shipped catalogue covers the common SaaS systems (Slack, GitHub, Microsoft 365, Google Drive, Shopify, and the rest); when your target system is not there, you build the bridge yourself. Three surfaces let you do that: a JSON-declared REST connector, a SQL adapter for relational databases, or an MCP server when you need a self-hosted process to broker the calls.

Read this when you are extending the integration catalogue. Come back when an operation you declared does not appear in the agent toolbelt — the answer is almost always a schema mismatch against the reference under `.tale/reference/integrations/`.

## A worked custom REST connector

The smallest useful integration is a single REST operation declared in JSON. Drop a folder into the project and the integration appears under **Settings > Integrations** without a code change:

```text
integrations/
  acme-billing/
    config.json
    connector.ts        # optional, for non-trivial request shaping
    icon.svg
```

`config.json` declares the auth method, the allowed hosts, and the operations:

```json
{
  "slug": "acme-billing",
  "name": "ACME Billing",
  "auth": { "type": "apiKey", "header": "X-API-Key" },
  "allowedHosts": ["api.acme.example.com"],
  "operations": [
    {
      "name": "list_invoices",
      "method": "GET",
      "path": "/v1/invoices",
      "query": { "since": "string?" }
    }
  ]
}
```

The operation surfaces on agents as a tool family the moment the org connects credentials. The connector file is optional — reach for it when the response shape needs flattening or pagination loops the manifest cannot express.

## Surface choices

| Surface       | Reach for it when                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| REST manifest | The target system speaks JSON over HTTPS and the auth is API key or OAuth2. Covers most SaaS APIs.                                    |
| SQL adapter   | The target is a relational database (Postgres, MySQL, SQL Server) and you want agents to read tables under a row-level access policy. |
| MCP server    | The bridge needs to be a long-lived process — local files, a CLI you own, a system that cannot be reached from Tale's network.        |
| Connector TS  | The REST manifest covers 80 % of the API but one operation needs response shaping the manifest cannot declare.                        |

The shipped integrations under [Platform > Integrations](/platform/integrations/overview) are the catalogue of REST manifests Tale ships — read their configs in `examples/default/integrations/` for the patterns you will copy.

## SQL adapters

A SQL adapter exposes a Tale-shaped tool surface over a SQL database. You declare the connection (driver, host, credential ref) and the tables the integration is allowed to read; the adapter generates a `query_<table>` operation per declared table and a `run_named_query` operation for the queries you whitelist by name. Writes go through declared mutations only — there is no raw `execute` operation.

Per-row authorisation is the operator's responsibility: declare a tenant column on each table and Tale will inject the tenant filter into every generated query. Operations that touch a table without a tenant column fail validation at deploy time.

## MCP servers

When the integration cannot be expressed as a JSON manifest — a CLI, a local toolchain, anything network-isolated from Tale — write an MCP server and register it under **Settings > MCP servers**. Each tool the server exposes appears in the agent toolbelt with per-tool approval the first time it is called. The transport is stdio for self-hosted Tale; for Tale Cloud, the server lives on your network and Tale calls it over a signed HTTPS tunnel.

The full MCP integration walk-through lives at [MCP server from scratch](/tutorials/developer/mcp-server-from-scratch) — that page is the build; this page is the chooser.

## Where this fits

Custom integrations are how Tale reaches systems the shipped catalogue does not cover. The [Integrations overview](/platform/integrations/overview) lists what is already there; once your custom integration is declared, [Agent tools](/platform/agents/tools) explains how its operations surface on an agent. If you need the bridge to live outside Tale entirely — a process you start, a host you control — the [MCP servers reference](/platform/integrations/mcp-servers) covers the other half.
