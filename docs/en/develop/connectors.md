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

A connector named with ordinary words, such as `task` (Tasks), also declares `i18n.de.displayName` and `i18n.fr.displayName`. A connector named after a product, such as Tavily, keeps its name in every language.

### Set the destination boundary

| Field | Meaning |
| --- | --- |
| `endpointMode: fixed` | Default. Live HTTP calls use fixed vendor URLs; `allowedHosts` contains exact hosts |
| `endpointMode: per-credential` | Each credential supplies an HTTPS `endpointUrl`; actions read its origin as `ctx.endpoint`, without a trailing slash |
| `allowedHosts` in per-credential mode | Host suffixes: `atlassian.net` allows its subdomains |
| `configFields` | Non-secret per-credential values such as server host, port, region, or API version; a field's `label`, `description` and `optionLabels` (what the form's select shows for each `enum` value, such as `tls: Implicit TLS`) take `i18n.de` and `i18n.fr` overrides for the credential form. `required` makes a field mandatory for every credential; `requiredFor` lists the authentication methods it is mandatory for, such as Outlook's `mailbox` for `client-credentials`; `fixed: true` sets a field when the credential is added and refuses an edit that changes it, for a value that decides where the credential acts, such as Outlook's `mailbox`; `format: email` makes a `string` field take a mail address only, checked by the form and the server, such as Outlook's `mailbox` |
| `livePrelude` | Optional JavaScript every `yaml-js` live body of the connector starts with, in the body's scope: helpers the actions share, such as Outlook's Graph root and refusal messages |
| `git` | Optional: the credential also opens the vendor's Git remotes over HTTPS. `host` is a fixed Git host, such as `github.com`, or `endpoint` for the host of each credential's own instance address (per-credential connectors only), which must pass the connector's `allowedHosts` and the private-address policy, as its HTTP calls do; `username` is what Git sends beside the token, and a `basic` credential sends its own instead |

Confluence, Forgejo, GlitchTip and Shopify use per-credential origins. GitHub and Forgejo declare `git`: an agent equipped with either clones and pushes in its sandbox with the credential it [uses for repository access](/platform/projects/project-agents#repository-access), and the sandbox's Git answers no other host with it. Keep secrets out of `configFields`; use the encrypted credential payload. For JavaScript actions, `ctx.http` enforces the declared HTTP destination boundary. Native backends, such as mailbox protocols, implement their own transport checks; an HTTP allowlist alone does not describe their whole security boundary.

<Info>

Adding a connector is a source contribution. The runtime reads the platform catalog, with no organization-level connector upload. Start from [Contributor setup](/develop/contributor-setup), then inspect a shipped connector with the same authentication and transport before adding yours.

</Info>

## What an action declares

| Field | Contract for the author and caller |
| --- | --- |
| `name`, `description` | Stable snake_case action name and an explanation of when to use it |
| `title`, `i18n` | The action in words for people: a short English `title` in sentence case, without the connector's name ("List issues"), plus `i18n.de.title` and `i18n.fr.title` (and `de-CH` where the Swiss spelling differs). The automation canvas shows a node as "GitHub · List issues" in the reader's language; a shipped action without all three fails the catalog's tests |
| `input` | Object JSON Schema, validated before execution; describe fields and mark required ones |
| `output` | TypeScript-style signature describing the result; this is documentation, not a runtime output validator |
| `effects` | `read` or `write`; writes pass through approval policy |
| `mock` | Required deterministic JavaScript implementation; same input, same output, no network I/O |
| `scenarios` | Optional named cases of what the service answers, which a test can pick for a step in a mock run; data, never code. See [Declare scenarios for tests](#scenarios) |
| `backend` | Optional live implementation: `yaml-js` with `live`, or `native` with an `impl` identifier |
| `exampleInput` | Optional small, meaningful example for discovery and testing |
| `idempotent` | Optional; set `true` on a write only when a second call with the same `ctx.idempotencyKey` changes nothing the first did not. An interrupted automation run then repeats the write by itself instead of waiting for a person to decide |

A connector with no live backend can run in mock mode but refuses live execution. Write actions do not run if the platform cannot obtain an approval decision. See the [approval-policy reference](/self-hosted/configuration/approvals) for rule precedence and pending decisions.

When inspecting a result contract, read the live implementation too. For example, Tavily's search input describes `max_results`, but the shipped action caps the returned results at five. The output signature alone does not explain that bound.

### Declare scenarios for tests {#scenarios}

An action can ship scenarios beside its `mock`: named cases of what the service answers, such as a channel that doesn't exist or a rate limit. A test picks one for a step, and the mock run answers with it in place of the mock, so the test shows what the automation does in that case. List them under `scenarios`, after `mock`. This excerpt shows two of the scenarios Slack ships on `get_channel`, the action that reads a channel; the action's other fields are left out:

```yaml
scenarios:
  - name: one_channel
    kind: success
    description: 'Slack returns the channel.'
    output:
      channel:
        id: C0000000001
        name: general
        is_private: false
        topic: { value: 'Company-wide announcements.' }
  - name: channel_not_found
    kind: error
    description: 'Slack answers that no channel has this id.'
    when: { channel: C0000000009 }
    error:
      message: 'Slack get_channel failed: channel_not_found'
```

- `name` is snake_case, unique within the action, and at most 50 characters long.
- `description` says in English what the service does in that case.
- `when` is optional. The scenario answers a call whose input carries each member it lists, with an equal value. Without `when`, it answers every call.
- A scenario answers with either an `output` or an `error`. An `output` is exactly what the live body returns, in the action's declared output shape. An `error` has the `message` the live body throws, and a `status` only when that error carries an HTTP status.

`kind` says which case the scenario stands for, and decides what it answers with:

| Kind | The case | Answers with |
| --- | --- | --- |
| `success` | The call does what was asked | An output |
| `empty` | The call succeeds with nothing in it, such as an empty list, or the record with its optional members empty | An output |
| `error` | A read fails: not found, refused credentials, a rate limit, a service that does not answer | An error |
| `refusal` | The service refuses a write | An error |
| `duplicate` | The same write comes again, and the service answers with a second record, the first one, or a refusal | An output or an error |

Scenarios are data, never code. Keep them synthetic, with no real customer data: the repository is public. `mock` stays required and works as before: it answers every call that no scenario answers.

A scenario's error fails the step the way the same failure of a live call does. The run classifies it by the status the error carries:

| Status | How the run classifies the failure |
| --- | --- |
| `401` or `403` | The service refused access |
| `404` | Not found |
| `429` | Rate limited; this doesn't count toward [pausing a schedule](/platform/automations/triggers#when-a-schedule-pauses-itself) |
| None, with a message about a network failure | The service couldn't be reached |
| Any other | The service failed. A `5xx` status counts as unavailable; any other failure counts toward pausing a schedule after repeated failures |

So a scenario proves what the automation does with that failure.

The catalog test `services/platform/lib/shared/schemas/shipped-connectors.test.ts` checks every scenario of every shipped connector: a `when` names only the action's input properties, and an `output` fits the action's declared output. It also keeps a list of connectors whose scenarios are complete. On a connector on that list, every action ships at least these kinds: a read ships `success`, `empty` and `error`, and a write ships `success`, `refusal` and `duplicate`. A connector that ships them on every action must be on the list. Slack is the first connector on it, and the reference to follow: the test also proves its scenarios against its live body, so the Slack answer each scenario stands for makes the live body return its output or throw its error.

### Resolve the right account

Credentials are selected at call time: the one named by the caller, otherwise the connector's default. Changing a default can therefore change which account a later run uses. Name the credential explicitly when the account is part of your integration's contract.

Mailbox discovery has a deliberate exception: `conversation.sync_mailbox` and `conversation.list_mailbox_messages` enumerate every active credential for the connector. They cover all connected mailboxes instead of limiting themselves to the default, unless the `mailbox` input of `sync_mailbox` names one, which it then reads alone.

## The authentication methods

A connector can support several methods; a stored credential uses exactly one.

| Method    | UI label            | What the credential holds                                                                        |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `api-key` | API key             | A single secret the action body places itself — a vendor header, a query param, or a body field. |
| `bearer`  | Token               | A token sent as the Authorization header, under the scheme the connector names.                  |
| `basic`   | Username & password | A username and password sent as HTTP Basic, which is also the shape a mailbox login takes.       |
| `oauth2`  | OAuth               | An authorization-code grant: access token, refresh token, expiry, and the granted scopes.        |
| `client-credentials` | App sign-in | The organization's own app registration: client ID and secret, plus the directory (tenant) ID when the token URL names `{tenantId}`. Tale requests the access token for the declared `scopes` and renews it before it expires. |

An `oauth2` method can declare `configScopes`: extra scopes the consent asks for only when the credential sets the named `configFields` key: the settings entered beside **Connect** for a new credential, or the stored ones of a credential being reconnected. Outlook asks for its shared-mailbox permissions this way, because a personal Microsoft account cannot grant them.

The internal `platform` method has no stored credential and cannot be combined with vendor methods. It is reserved for native platform capabilities such as task and document actions.

Credential secrets are encrypted at rest. Lists return a masked preview and metadata rather than plaintext; the authorized live runtime resolves the secret when it performs the action. A successful credential save proves storage, not that the vendor accepts the credential or grants the required scopes.

## Registering an OAuth app

The connector declares authorization/token URLs and requested scopes. Configure the vendor application separately, then connect an account using that application.

| Source | Precedence and configuration |
| --- | --- |
| Organization app | Takes precedence. An administrator supplies client ID and secret in **Settings > Connectors > OAuth apps** |
| Deployment app | Default when no organization app is configured: `CONNECTOR_OAUTH_<SLUG>_CLIENT_ID` and `CONNECTOR_OAUTH_<SLUG>_CLIENT_SECRET`, plus `CONNECTOR_OAUTH_<SLUG>_TENANT_ID` for a single-tenant Microsoft app |

In environment variable names, uppercase the slug and replace dashes with underscores. For a single-tenant Microsoft app, also configure its directory ID (in the organization app, or `CONNECTOR_OAUTH_<SLUG>_TENANT_ID`) so authorization uses that tenant rather than `/common`. Organization app secrets are encrypted and not revealed again.

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

Test three things separately when contributing: schema validation, deterministic mock behavior, and the live vendor path. Check failure handling as well as success: missing credential, wrong scope, denied destination, invalid input, vendor refusal, and an approval wait for writes. Give each action [scenarios](#scenarios) for the vendor's answers, with Slack's as the reference. Once every action ships the kinds its effect needs, add your connector to the catalog test's list; the list only grows. The [contributor guide](/develop/contributor-setup) explains the local source environment; the [credential guide](/platform/admin/connectors) explains the administrator's setup.
