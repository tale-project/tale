---
title: Connector credentials
description: Settings > Connectors is where an organisation adds, names, defaults, disables, and reconnects the credentials each shipped connector authenticates with.
---

Every connector ships with the platform, so the administrator's job is never installation — it is deciding which accounts Tale may act as, and keeping those credentials healthy. A connector holds as many credentials as you need, one per workspace, store, mailbox, or bot, and one of them answers for any caller that names none. This page is the operations side of that: what the page shows, how each authentication method is filled in, and what happens when you promote, disable, delete, or reconnect a row.

The catalog itself — the thirteen connectors, what each one buys you, and how their actions reach automations and chat — is on [Connectors](/platform/connectors/overview). Reading time here is best spent on the credential lifecycle, because that is the part that differs per organisation and the part that breaks.

## What the page shows

Open **Settings > Connectors**. The page is gated on Admin or Developer permissions and is a table of the credentials your organisation holds — one row per credential, not one per shipped connector. A row shows its name, the connector it authenticates, its authentication method, and its coordinates: a masked preview of the stored secret, plus the instance URL where the connector needs one. A **Default** badge marks the one an action falls back to, a **Disabled** badge any that is switched off.

Search covers both the name you gave a credential and the connector behind it; the filter button narrows to one connector. A `?connector=` link narrows the table the same way, which is where the OAuth round trip returns you.

Two warnings appear here, and they mean different things. _No default credential for {connector}_ means every row works but nothing answers for a caller that names none. **Reconnect needed** on a row means an OAuth grant stopped refreshing and needs consent again — the credential itself is fine.

## Adding a credential

**Add credential** opens the shipped catalog. Connectors you already hold a credential for come first, under **In use**; everything else follows below it, alphabetically, each with its category tags and how many actions it exposes. Search narrows the list; picking one moves you to the setup step, and **Back to the catalog** returns.

Setup asks for a **Name** first, and the field's help text is the reason it matters: the name an action uses to pick this credential. Choose something an automation author will recognise months later, such as `Support inbox` or `EU store`.

What follows the name depends on the **Authentication method** the connector accepts.

<Tabs>

<Tab title="API key">

One field, **API key**. The connector's own action bodies decide where the key travels — a header the vendor defines, or the request body where the vendor requires it. Shopify and Tavily are the shipped cases.

</Tab>

<Tab title="Token">

One field, **Token**, sent as the Authorization header on every request. GitHub takes a personal access token this way; Discord takes a bot token, which the platform sends under Discord's own scheme rather than the standard one.

</Tab>

<Tab title="Username & password">

Two fields, **Username** and **Password**, sent as HTTP Basic. The pair is not always a login in the everyday sense: Confluence takes the account email with an API token, Twilio takes the Account SID with the Auth Token, and the WebDAV connector takes a WebDAV app password. IMAP / SMTP takes the mailbox login itself.

</Tab>

<Tab title="OAuth">

No secret to type, so the setup step is the hand-off alone: **Connect** takes you to the vendor's consent screen, and Tale stores what comes back — access token, refresh token, expiry, and the granted scopes — as a new credential row. Gmail, Google Drive, Outlook, Teams, and Slack all connect this way. A connector that accepts both a grant and a token offers both, with **Connect** first.

**Connect** needs somewhere to send you: an OAuth app must exist for the connector, either configured for this organization (see below) or registered on the deployment environment. Until one exists, the dialog says so instead of offering the button.

</Tab>

</Tabs>

Adding a second credential to a connector that already has one is the same flow again — it simply appears under **In use** in the catalog. There is no limit to work around and nothing to disconnect first.

<Note>

Confluence and Shopify also ask for an **Instance URL**, because neither has a single vendor host. Confluence wants your Atlassian site origin — the address you open Confluence at. Shopify wants your store's `myshopify.com` origin, which is the admin address rather than the storefront domain. The value is stored in the clear on purpose, so the table can show which instance each row points at.

</Note>

## Choosing the default

One credential per connector can be the **Default**, and **Make default** on any row moves it. The default is what resolution falls back to when an automation node or a chat action names no credential. Mail sync is the exception that proves the rule the other way: `conversation.sync_mailbox` walks every _active_ credential on the connector so adding a second IMAP mailbox (or a second Gmail account) does not leave it unsynced until you promote it. Inbox triage does the same fan-out through `conversation.list_mailbox_messages`.

A connector with several credentials and no default is a working configuration with a gap in it. Callers that name a row keep running; callers that do not cannot pick one and fail. Promote a row and the gap closes immediately.

## Replacing a secret

Rotating a key is an edit on the credential, not a separate operation. Open the row and choose **Replace API key**, **Replace token**, or **Replace username & password**, depending on the method. The stored secret is never shown back to you, and entering a new one replaces it everywhere that credential is used — every automation node and every chat action pointed at that row picks up the new secret without being touched.

The credential keeps its name, its default flag, and its instance URL through a replacement, so nothing downstream has to be repointed. **Edit name & instance** covers the other direction: renaming a row, or moving it to a different instance origin.

## Disabling and deleting

**Disable** takes a credential out of service while keeping the row and everything configured on it. The credential shows as **Disabled** and nothing resolves to it; **Enable** puts it back. Reach for this when an account is suspected rather than finished, or when you want a configuration parked without losing it.

<Warning>

**Delete** is immediate and final. Automations and chat actions using that credential lose access to this connector at once — there is no grace period. Deleting the default leaves the connector without one until another row is promoted, and the confirmation says so before you commit.

</Warning>

## Configuring OAuth apps

The **OAuth apps** section at the bottom of the page — visible to admins and owners — decides which vendor app registration each OAuth connector's consent runs against. An app configured here belongs to this organization and overrides the deployment-wide one from the environment; with neither, that connector cannot be connected and the list says **Not configured**.

**Configure** takes the client ID and secret from the vendor's app registration, and for a single-tenant Microsoft app the directory (tenant) ID — Tale then authorizes against that tenant. The dialog lists the exact redirect URIs to register on the vendor side before connecting. The secret is stored encrypted, is never shown again, and a later edit may leave the field blank to keep it. **Remove** drops the organization's app; the deployment's, if any, takes over, and existing connections keep working until their tokens expire.

Two entries reach beyond this page: the **Google Drive** app is shared with Knowledge's Google Drive import (one Google OAuth client, both redirect URIs), and **OneDrive / SharePoint (Knowledge import)** exists only for that import — it has no connector of its own. Slack is absent on purpose: its app stays on the deployment environment, because inbound event verification runs before any organization is known.

## Reconnecting a broken authorization

An OAuth credential whose stored authorization expired or was revoked shows **Reconnect needed** with the reason attached. This is the platform's own finding, not an operator's decision, which is why it reads differently from a credential someone disabled by hand: nothing about the row is wrong, the vendor stopped honouring the grant.

**Reconnect** re-runs the vendor's consent flow and restores access on the same row, keeping its name, its default flag, and every reference pointed at it. A credential you disabled yourself is not repaired this way — **Enable** is the fix for that one, and reconnecting it would be answering the wrong question.

## Connectors and MCP servers

Both surfaces let an agent reach past Tale, and the difference is who owns the bridge. A connector is vendor-specific, ships with the platform, and is maintained for you; your side of it is the credential. An MCP server is a process you host and register under **Settings > API > MCP**, exposing whatever tools you write. Reach for the connector when one exists for the target system, and for [MCP servers](/platform/connectors/mcp-servers) when none does.

## Where this fits

Credential management is the whole of connector administration now that nothing is installed: add the accounts, name them well, keep one default per connector, and reconnect the OAuth rows that lapse. [Connectors](/platform/connectors/overview) is the catalog those credentials attach to, [Agent tools](/platform/agents/tools) shows how the resulting actions arrive in an agent's toolbelt, and [Configure approvals](/platform/approvals/configure) is where the write actions are held for a person to release.
</content>
</invoke>
