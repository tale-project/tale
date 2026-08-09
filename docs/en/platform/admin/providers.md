---
title: AI providers
description: Connect your organisation to the models it is allowed to call — the provider connectors Tale ships with, the credentials you store against them, and the defaults, allowlists, and catalogs that decide what everyone else can pick.
---

Nothing in Tale answers a prompt until your organisation holds a working credential for at least one AI provider. **Settings > AI providers** is where those credentials live, and it is the only place they can be created. Admins and Developers can open the page; everyone else meets its result later, as the list of models they can choose in chat, on an agent, or on a workflow step.

## Connectors and credentials

Two different things meet on this page, and telling them apart makes the rest of it obvious.

A **connector** is Tale's built-in knowledge of one provider: which wire dialect it speaks, which endpoint it answers on, where its model list comes from, and which kinds of authentication it accepts. Connectors ship with the platform. You cannot add, edit, or remove one from the UI, and a platform upgrade can bring more.

A **credential** is your organisation's half — the part that actually authorises a call. You store as many as you need against a connector: a production key beside a staging key, one key per department, an ops-managed variable next to one you rotate by hand. Each credential carries a name, an authentication method, an optional model allowlist, and an enable state, and one of them is the default.

These are the connectors that ship today:

| Connector            | Wire format            | Model catalog            |
| -------------------- | ---------------------- | ------------------------ |
| OpenRouter           | OpenAI-compatible API  | OpenRouter catalog       |
| OpenAI               | OpenAI-compatible API  | Built-in catalog         |
| Anthropic            | Anthropic Messages API | Built-in catalog         |
| Gemini               | OpenAI-compatible API  | Built-in catalog         |
| Azure OpenAI         | OpenAI-compatible API  | No catalog               |
| DeepSeek             | OpenAI-compatible API  | Built-in catalog         |
| Moonshot AI (Kimi)   | OpenAI-compatible API  | Built-in catalog         |
| Qwen (Alibaba)       | OpenAI-compatible API  | Built-in catalog         |
| SpaceXAI             | OpenAI-compatible API  | Built-in catalog         |
| Z.ai (GLM)           | OpenAI-compatible API  | Built-in catalog         |
| Vercel AI Gateway    | OpenAI-compatible API  | Provider models endpoint |
| Nous Portal (Hermes) | OpenAI-compatible API  | No catalog               |

## What the page shows

**Credentials** is a table of what your organisation actually holds — one row per stored credential, not one per shipped provider. A row shows its name, the provider it authenticates, its authentication method, and its coordinates: a masked preview of the stored key or the name of the environment variable behind it, plus the credential's own endpoint URL where the provider needs one and how many models its allowlist permits. A **Default** badge marks the one requests fall back to, a **Disabled** badge any that is switched off. The row's actions menu holds everything else.

Two warnings surface here rather than inside a dialog. A provider whose model catalog could not be fetched says so on every row that depends on it — a working key is still useless when Tale cannot tell which models the provider serves. And a provider with credentials but no default is named above the table: requests cannot pick one automatically until you promote one.

Below the table, **Harnesses** reports how each coding harness resolves for your organisation. It is read-only; the credentials above are what change it.

## Adding a credential

<Steps>

<Step title="Pick the provider">

**Add credential** opens the shipped catalog. Providers you already hold a credential for come first, under **In use**; everything else follows below it, alphabetically. Each entry names its wire facts — the API format and endpoint host, as in `OpenAI-compatible API · openrouter.ai`, or `endpoint set per credential` — and how many models its catalog holds. Search narrows the list; picking one moves you to the form, and **Back to the catalog** returns.

Because the form belongs to the provider you picked, it only offers what that provider accepts — you are never asked for a base URL the platform already knows.

</Step>

<Step title="Choose the authentication method">

The method switches the rest of the form: a secret field for **API key** and **Subscription key**, a variable name for **Environment variable**, the full broker form for **Subscription broker**.

</Step>

<Step title="Name it for whoever reads it next">

**Name** is what every later screen shows instead of the secret. Name it for its purpose — `Production key`, `Finance team`, `Ops-managed` — because that is the label someone will pick from months later.

</Step>

<Step title="Decide whether to narrow it">

**Model allowlist** is optional. Leave it empty and the credential may use everything in the connector's catalog; set it and the credential is confined to what you picked.

</Step>

</Steps>

### API key

Paste the secret into **API key**. Tale stores it encrypted and never shows it again — the row displays a masked preview, not the key. To rotate, open the row's menu and choose **Replace API key**; the replacement takes effect everywhere that credential is used, at once.

### Environment variable

Here the key never enters Tale. It lives on the deployment, and the credential records only the name of the variable that holds it. Type the suffix; the reserved prefix `TALE_PROVIDER_KEY_` is fixed and cannot be edited away.

<Note>

Any name outside that prefix is rejected, so the field can never be pointed at an unrelated deployment secret. Names are capped at 40 characters. The variable itself is provisioned by whoever runs the deployment — the operator side is documented in [Providers](/self-hosted/configuration/providers).

</Note>

### Vendor subscriptions and brokers

Two methods cover subscriptions rather than metered API keys. **Subscription key** stores a vendor's subscription secret directly; a Nous Portal subscription is one shipped case. **Subscription broker** points at an endpoint that hands out a pool of rotating OAuth tokens — the shape a Claude subscription uses.

The broker form asks for the **Broker endpoint** and its **HTTP method**, then how Tale authenticates to the broker under **Broker authentication**: None, Bearer token, or Custom header, with a **Header name** and the **Broker secret**, or **Secret from environment variable** when your operations team holds it. The rest describes the response — the **Token array path**, the **Token field**, the **Target environment variable** the chosen token is injected into, and a **Token selection** strategy of Random, First usable, or Round-robin. **Advanced** carries the tuning: **Status field**, **Active status value**, **Expiry field**, **Request timeout (ms)**, **Max response size (bytes)**, and **Expiry safety margin (ms)**.

<Info>

Both kinds are consumed inside the vendor's own tooling rather than over a plain API call, so the dialog says so: **Runs sandboxed on its provider's harness.** An Anthropic subscription broker runs on the `claude-code` harness, a Nous Portal subscription key on `hermes`. Direct API calls are never offered for these credentials.

</Info>

## Connectors that set the endpoint per credential

Azure OpenAI has no fixed endpoint because every Azure resource serves its own, in the form `https://<resource>.openai.azure.com/openai/v1`. Its section header says the endpoint is set per credential, and its dialog adds an **Endpoint URL** field so each credential carries the resource it belongs to.

Azure also ships no model catalog, and the reason is worth knowing before you fill the form: on Azure the model id in a request is the deployment name you chose inside the resource, which Tale cannot know in advance. Type those names into the credential's **Model allowlist** as a comma-separated list. Without them, the credential makes no model available at all.

## Choosing the default credential

A request that names no credential uses the connector's default. That covers most traffic, so the default is the credential you want ordinary work to land on — the shared production key rather than the experiment.

Open a row's menu and choose **Make default**. One credential per connector holds it, and promoting a different one moves it. A disabled credential cannot become the default. Leave a connector without a default and the platform will not choose for you: it says so on the page, and requests that do not name a credential have nothing to resolve to.

## Narrowing what a credential may call

**Model allowlist** limits one credential to a subset of its connector's models. With a catalog behind it the field is a searchable multi-select; without one it is a free-text list of ids. Leave it empty and the credential may use the whole catalog. Set it and the row shows the count, and anything outside the list stops resolving through that credential.

<Tip>

An allowlist narrows one credential. To narrow what a person, team, or role may pick across every provider at once, use the model-access rules under [Content and models](/platform/admin/governance/content-models). The two compose: a model has to clear both before it appears in a picker.

</Tip>

## Keeping the model catalogs current

**Refresh catalogs** sits in the page header. It re-fetches every live catalog and reports one line per connector — the number of models it found, or the error it hit, so a provider that is down is named rather than silently skipped.

Catalogs that ship with the platform need nothing: when every connector has one, the report says there is nothing to refresh. Live catalogs are cached between refreshes and there is no background sync, so a model published this morning appears once somebody presses the button.

## Disabling and deleting credentials

**Disable** switches a credential off while keeping its configuration and its allowlist. Reach for it when a key is suspected, a quota is exhausted, or a department is paused — re-enabling is one click and nothing has to be re-entered.

<Warning>

Deleting is immediate and total. Agents and requests using that credential lose access to the provider straight away, so re-point anything that depends on it first. Deleting the default leaves the connector without one until you promote another, which the confirmation tells you before you commit.

</Warning>

## Where this fits

This page is the floor everything else stands on: an agent, a chat reply, a workflow step, a knowledge-base embedding all resolve to a model, and a model is only reachable when a credential on this page can call it. Which models that leaves you is covered in [Model catalog](/platform/models), the governance layer that narrows them further in [Content and models](/platform/admin/governance/content-models), and the deployment-side variables an operator provisions in [Providers](/self-hosted/configuration/providers).
