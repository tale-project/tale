---
title: Connectors
description: How a connector is declared, what one of its actions promises a caller, and where your own code goes when no connector fits.
---

Connectors are the vendor-specific half of how Tale reaches other systems, and they are part of the platform rather than something an organisation assembles. Each one is a YAML file in the source tree that declares who it talks to, how it authenticates, and every action it can perform — which is why the catalog is identical in every deployment and why an upgrade is all it takes to move it forward. Read this when you want to know what a connector actually promises a caller, or when you are deciding between contributing one and reaching your own service from a project agent or an automation.

The organisation-facing side — adding credentials, defaults, reconnecting a lapsed grant — is [Connector credentials](/platform/admin/connectors), and the catalog itself is [Connectors](/platform/connectors/overview).

## How a connector is declared

Every connector is one directory under `configs/platform/system/connectors/`, named for its slug, holding a `connector.yml` and the icon the settings page renders. The slug is the directory name, the connector's declared `name`, and the first half of the node type an automation uses to place one of its actions — `<connector>.<action>`. Fourteen vendor connectors appear in Settings today (plus a handful of platform-auth connectors that stay out of the picker).

The file opens with the connector's identity and its authentication contract, then lists the actions:

```yaml
name: tavily
displayName: Tavily
description: Real-time web search and page extraction for AI research.
tags:
  - Search
allowedHosts:
  - api.tavily.com
auth:
  - method: api-key
actions:
  - name: search
    description: >-
      Search the open web via Tavily. Returns top results with title, URL,
      content snippet, and score.
    effects: read
    input:
      type: object
      required: [query]
      properties:
        query: { type: string, description: 'Natural-language search query.' }
        max_results: { type: number, description: 'Max results (1-10).' }
    output: '{ answer?: string, results: Array<{ title: string, url: string, content: string, score: number }> }'
```

`allowedHosts` is the egress boundary — an action body that reaches anywhere else is refused rather than proxied. A connector whose API lives at a customer address instead of a vendor one adds `endpointMode: per-credential`, and each credential then carries the origin its calls are built from; Confluence and Shopify are the two shipped cases.

<Info>

Connectors are read from the platform's own tree, not from an organisation's configuration, and there is no upload path that adds one at runtime. Adding a connector is a source contribution — see [Contributor setup](/develop/contributor-setup). Reaching your own service without touching the source goes through a project agent's **Secrets** or an automation's `transform` node — the section on choosing a surface below says how.

</Info>

## What an action declares

An action is a contract, and every field of it is visible to the caller before the call happens:

- **Name and description.** The name completes the node type; the description is what an agent reads when it decides whether this action is the right one.
- **Input.** A JSON Schema — object type, required fields, and a description per property. Automations validate a node's configuration against it, and agents fill it from the same schema.
- **Output.** A signature describing the shape that comes back, so a workflow author knows what the next step can reference.
- **Effects.** Either `read` or `write`. Write actions gate behind the organisation's approval policy, and a call that cannot reach an approval decision is refused rather than performed ungated.

Actions resolve their credential at call time: the one the caller names, or the connector's default when the caller names none. That is the seam that lets the same automation run against a different account by pointing it at a different credential name. Mail sync and inbox triage are different on purpose — `conversation.sync_mailbox` and `conversation.list_mailbox_messages` walk every active credential on the connector so every connected mailbox is covered without naming each one.

## The authentication methods

A connector declares the methods it accepts, and a credential is stored against exactly one of them. The four are fixed, because each one describes a different way a secret reaches the vendor.

| Method    | UI label            | What the credential holds                                                                        |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `api-key` | API key             | A single secret the action body places itself — a vendor header, a query param, or a body field. |
| `bearer`  | Token               | A token sent as the Authorization header, under the scheme the connector names.                  |
| `basic`   | Username & password | A username and password sent as HTTP Basic, which is also the shape a mailbox login takes.       |
| `oauth2`  | OAuth               | An authorization-code grant: access token, refresh token, expiry, and the granted scopes.        |

Secrets are encrypted at rest in a single envelope and never travel back out to a caller. A listing shows a masked preview computed when the credential was written, so reading the credential list never touches ciphertext.

## Registering an OAuth app

An `oauth2` connector declares the vendor's authorize and token URLs plus the scopes it requests, and something has to supply the app those URLs authenticate against. Two places can, and the more specific one wins:

- **Per organization** — an org admin opens **Settings > Connectors** and, under **OAuth apps**, pastes the client ID and secret from the vendor registration (plus the directory ID for a single-tenant Microsoft app; Tale then authorizes against that tenant instead of `/common`). The secret is encrypted at rest and never shown again. On a multi-org deployment this is what lets each organization bring its own vendor app.
- **Per deployment** — environment variables named per connector as `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID` and `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET`, with the slug upper-cased and its dashes turned into underscores. They are the deployment-wide default wherever an organization has not configured its own app.

Slack is the exception: its app stays environment-only (`CONNECTOR_OAUTH_SLACK_*` plus the signing secret), because inbound event verification runs before any organization is known.

Register this exact callback as an allowed redirect URI on the vendor side, built from the deployment's `SITE_URL` and any `BASE_PATH` prefix:

```text
${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback
```

When `SITE_URL` is unset the consent flow refuses to start rather than guessing an origin from the request.

Personal OneDrive / Google Drive import for Knowledge is **not** an org connector — but it resolves its OAuth app the same way, and the **google-drive** app is shared between the two lanes: one Google OAuth client, with both redirect URIs registered, serves the connector and Knowledge import. See [Documents](/platform/knowledge/documents) and the cloud-import redirect under [Environment reference](/self-hosted/configuration/environment-reference).

<Warning>

The redirect URI has to match byte for byte — scheme, host, path, and no trailing slash. A mismatch fails at the vendor's consent screen with a `redirect_uri` error before Tale ever sees the callback, which is the single most common reason a fresh OAuth connector will not connect.

</Warning>

## Choosing a surface

Two surfaces reach systems outside Tale, and the choice is about who owns and runs the bridge.

| Surface           | Reach for it when                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Shipped connector | A connector already exists for the target system. Your work is a credential, and the vendor contract is maintained for you.               |
| Your own code     | Nothing shipped covers the system — an internal API, a homegrown tool, a host only your network can reach. A project agent calls it from its sandbox with a **Secrets** entry; an automation calls it from a `transform` node. |

Registering an external MCP server is not part of this version — Tale's one MCP surface is the inbound endpoint under **Settings > API > MCP**, where your MCP client drives Tale. [MCP servers](/platform/connectors/mcp-servers) says what replaced the registration form; [MCP endpoint](/develop/mcp-endpoint) is the reference for the surface that does ship.

## Where this fits

A connector is a declared contract — hosts, authentication, and a typed action list — that ships with the platform and is fed by credentials the organisation owns. Read [Connectors](/platform/connectors/overview) for what is in the catalog, [Connector credentials](/platform/admin/connectors) for how those credentials are managed day to day, and [MCP servers](/platform/connectors/mcp-servers) for the one MCP surface this version ships.
