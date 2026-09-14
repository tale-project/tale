---
title: Connectors
description: How a connector is declared, what one of its actions promises a caller, and where your own code goes when no connector fits.
---

A connector gives Tale a reusable way to call a service. Its definition describes authentication, permitted destinations, and actions; each organization supplies its own credentials. Use this page to inspect that contract or contribute a new connector.

If your goal is to connect an account in the app, use [Connector credentials](/platform/admin/connectors). To choose an existing integration, browse the [connector catalog](/platform/connectors/overview).

## How a connector is declared

Definitions live in `configs/platform/system/connectors/<slug>/connector.yml`, alongside the connector's icon. The directory slug must match `name`. An automation calls an action using `<connector>.<action>`, for example `tavily.search`. Vendor connectors appear in Settings; internal connectors with platform authentication do not.

This is the identity and authentication excerpt from the shipped Tavily definition. It is not a complete connector: the file also needs its action definitions.

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
```

### Set the destination boundary

| Field | Meaning |
| --- | --- |
| `endpointMode: fixed` | Default. Live HTTP calls use fixed vendor URLs; `allowedHosts` contains exact hosts |
| `endpointMode: per-credential` | Each credential supplies an HTTPS `endpointUrl`; actions read its origin as `ctx.endpoint`, without a trailing slash |
| `allowedHosts` in per-credential mode | Host suffixes: `atlassian.net` allows its subdomains |
| `configFields` | Non-secret per-credential values such as server host, port, region, or API version |

Confluence and Shopify use per-credential origins. Keep secrets out of `configFields`; use the encrypted credential payload. For JavaScript actions, `ctx.http` enforces the declared HTTP destination boundary. Native backends, such as mailbox protocols, implement their own transport checks; an HTTP allowlist alone does not describe their whole security boundary.

<Info>

Adding a connector is a source contribution. The runtime reads the platform catalog, with no organization-level connector upload. Start from [Contributor setup](/develop/contributor-setup), then inspect a shipped connector with the same authentication and transport before adding yours.

</Info>

## What an action declares

| Field | Contract for the author and caller |
| --- | --- |
| `name`, `description` | Stable snake_case action name and an explanation of when to use it |
| `input` | Object JSON Schema, validated before execution; describe fields and mark required ones |
| `output` | TypeScript-style signature describing the result; this is documentation, not a runtime output validator |
| `effects` | `read` or `write`; writes pass through approval policy |
| `mock` | Required deterministic JavaScript implementation; same input, same output, no network I/O |
| `backend` | Optional live implementation: `yaml-js` with `live`, or `native` with an `impl` identifier |
| `exampleInput` | Optional small, meaningful example for discovery and testing |

A connector with no live backend can run in mock mode but refuses live execution. Write actions do not run if the platform cannot obtain an approval decision. See the [approval-policy reference](/self-hosted/configuration/approvals) for rule precedence and pending decisions.

When inspecting a result contract, read the live implementation too. For example, Tavily's search input describes `max_results`, but the shipped action caps the returned results at five. The output signature alone does not explain that bound.

### Resolve the right account

Credentials are selected at call time: the one named by the caller, otherwise the connector's default. Changing a default can therefore change which account a later run uses. Name the credential explicitly when the account is part of your integration's contract.

Mailbox discovery has a deliberate exception: `conversation.sync_mailbox` and `conversation.list_mailbox_messages` enumerate every active credential for the connector. They cover all connected mailboxes instead of limiting themselves to the default.

## The authentication methods

A connector can support several methods; a stored credential uses exactly one.

| Method    | UI label            | What the credential holds                                                                        |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `api-key` | API key             | A single secret the action body places itself — a vendor header, a query param, or a body field. |
| `bearer`  | Token               | A token sent as the Authorization header, under the scheme the connector names.                  |
| `basic`   | Username & password | A username and password sent as HTTP Basic, which is also the shape a mailbox login takes.       |
| `oauth2`  | OAuth               | An authorization-code grant: access token, refresh token, expiry, and the granted scopes.        |

The internal `platform` method has no stored credential and cannot be combined with vendor methods. It is reserved for native platform capabilities such as task and document actions.

Credential secrets are encrypted at rest. Lists return a masked preview and metadata rather than plaintext; the authorized live runtime resolves the secret when it performs the action. A successful credential save proves storage, not that the vendor accepts the credential or grants the required scopes.

## Registering an OAuth app

The connector declares authorization/token URLs and requested scopes. Configure the vendor application separately, then connect an account using that application.

| Source | Precedence and configuration |
| --- | --- |
| Organization app | Takes precedence. An administrator supplies client ID and secret in **Settings > Connectors > OAuth apps** |
| Deployment app | Default when no organization app is configured: `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID` and `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET` |

In environment variable names, uppercase the slug and replace dashes with underscores. For a single-tenant Microsoft app, also configure its directory ID so authorization uses that tenant rather than `/common`. Organization app secrets are encrypted and not revealed again.

### Register the callback exactly

All organization OAuth connectors use this redirect URI:

```text
${SITE_URL}${BASE_PATH}/api/connectors/oauth2/callback
```

Match the scheme, host, path, and absence of a trailing slash exactly. Tale refuses to begin consent when `SITE_URL` is missing; it does not infer a public callback from the incoming request. A `redirect_uri` refusal on the vendor screen usually means the registered URI differs from the one Tale sent.

Personal OneDrive/Google Drive knowledge imports are a separate flow. Google Drive shares its OAuth application between connector and import, so register both redirect URIs on that Google client. Find the import callback in the [environment reference](/self-hosted/configuration/environment-reference).

### Configure Slack's event endpoint

Slack's app is deployment-only: `CONNECTOR_OAUTH_SLACK_*` and `CONNECTOR_SLACK_SIGNING_SECRET`. Its incoming event must be verified before Tale knows the organization, so an organization app cannot supply this secret.

Register `${SITE_URL}${BASE_PATH}/api/connectors/slack/events` as the Events Request URL. Without the signing secret, even the registration handshake returns `503`. With valid configuration, Tale verifies signatures and identifies the organization from the Slack workspace. The endpoint currently acknowledges events; it does not turn inbound Slack messages into conversations or automatically run an automation.

## Choosing a surface

| Need | Use |
| --- | --- |
| A supported vendor action | A shipped connector and an organization credential |
| A reusable action missing from the catalog | A source contribution with schema, deterministic mock, live backend, and tests |
| Project-specific calls to your own service | A project agent's **Secrets** and sandbox code, within that sandbox's network permissions |
| Custom logic inside an automation | A `transform` node, within the runner's available capabilities and network rules |

A secret provides authentication; it does not make an unreachable private service reachable. Confirm network access from the actual sandbox or runner before designing an integration around it.

External MCP-server registration is not available. Tale's [MCP endpoint](/develop/mcp-endpoint) lets an external client call Tale; it does not add an outbound connector to another MCP server.

## Where this fits

Test three things separately when contributing: schema validation, deterministic mock behavior, and the live vendor path. Check failure handling as well as success: missing credential, wrong scope, denied destination, invalid input, vendor refusal, and an approval wait for writes. The [contributor guide](/develop/contributor-setup) explains the local source environment; the [credential guide](/platform/admin/connectors) explains the administrator's setup.
