---
title: Connector credentials
description: Connect service accounts, choose defaults, and repair or replace their authorization.
---

Add connector credentials so Tale can use services such as a mailbox, file store, or issue tracker. Owners, Admins, and Developers manage them under **Settings > Connectors**. Choose the service and account your work needs; the [connector catalog](/platform/connectors/overview) explains each service's available actions.

## Add an account

1. Select **Add credential**, then the connector. Already configured connectors appear first and can hold additional credentials.
2. Check the **Name**. It starts as the connector's name, with a number added when another credential for that connector already uses it: `GitHub`, then `GitHub 2`. A name such as `Support inbox` or `EU store` is easier for an automation author to recognize. An OAuth connection has no name field: Tale names it the same way when consent completes (a second Slack workspace takes the workspace's name), and **Edit credential** renames it.
3. Complete the authentication method offered by that connector. For OAuth, select **Connect** and complete the vendor's consent flow. Each **Connect** adds a new credential for the account you authorize and never replaces an existing one, so sign in to the vendor as the account you want to add.
4. Complete the form and check the resulting row, including its connector, account or instance, and status.

Slack connects one credential per workspace. Authorizing a workspace that is already connected renews that workspace's credential instead of adding a second one.

The connector determines which fields appear. Use the account's actual credentials, not a Tale API key.

| Method | Required information |
| --- | --- |
| API key | The key issued by the service, such as Tavily or Shopify. Jev decisions takes an OpenRouter API key. |
| Token | A service token, such as a GitHub personal access token, a Discord bot token, or a GlitchTip API token with `project:read` and `event:read`. |
| Username and password | The service's expected pair. This can be a login and app password, or a vendor-specific ID and token. |
| OAuth | Authorization in the vendor's browser flow; Tale stores the returned authorization. |

Some connectors also require an instance address. For Confluence, use the Atlassian site origin. For GlitchTip, use the instance origin, such as `https://app.glitchtip.com`; a self-hosted instance must also be allowed by the deployment's connector host policy. For Shopify, use the store's `myshopify.com` origin, not the customer-facing storefront domain.

## Choose the default

The table contains one row per credential and updates while it is open: a credential another admin adds, changes or deletes appears there without a reload. The **Default** badge marks the credential used when an action does not explicitly name one. Select **Make default** in a row's menu to change it; one default is allowed per connector.

A connector with several credentials and no default can still serve callers that name a credential. Callers that omit the name need a default. Name accounts clearly before wiring automations so a future administrator can identify the intended account.

Mailbox synchronization and inbox triage can inspect every active credential for a mailbox connector. A second mailbox does not have to become the default before these operations can find it. When you compose a new email, the **Inbox** field lists each mailbox by its name, and the email leaves from the one you choose. Replies in that conversation, including a retry of a failed send, leave from the same mailbox.

## Rotate a secret or pause access

Use the row's replacement action for its method, such as **Replace API key** or **Replace token**. The new secret replaces the stored one while preserving the credential's name, default choice, and references. Test an appropriate service action after replacement.

**Disable** pauses a credential while retaining its configuration; **Enable** restores it. **Edit credential** handles other editable details, including its name or instance address where supported.

<Warning>

Deleting credentials removes access for automations and agents that depend on them. Move callers first. Deleting a connector's default makes its oldest remaining active credential the default, and the confirmation names that credential before you delete. A disabled credential or one that needs Reconnect never takes over, so with no active credential left the connector has no default until you choose one. Deletion cannot be undone by reopening the same row.

</Warning>

## Prepare an OAuth app

Owners and Admins use **OAuth apps** at the bottom of the page to configure the vendor app registrations used during consent. An organization app overrides the deployment-wide app. If neither exists, the connector cannot start authorization and the page shows that it is not configured. If Tale cannot check whether a Knowledge import app is set up, its row shows **Status unavailable** without **Configure**, and **Try again** runs the check again. You can configure the app once the check works.

Select **Configure**, enter the vendor's client ID and secret, and register the exact redirect URIs shown in the dialog with the vendor. Microsoft apps may also require a directory/tenant ID. On a later edit, leave a stored secret blank to keep it.

The Google Drive app also supports Knowledge import. The OneDrive/SharePoint import entry is for Knowledge rather than a separate connector. Slack's app is configured by the deployment operator. Read the relevant [connector guide](/platform/connectors/overview) before assigning vendor permissions.

For OneDrive/SharePoint, **Use Entra ID SSO app** can copy an existing SSO registration into the import configuration. This is a one-time copy: after rotating the SSO secret, copy it again and review the redirect URI and delegated permissions listed by the confirmation.

## Reconnect or diagnose a failure

**Reconnect needed** means stored OAuth authorization can no longer refresh. Choose **Reconnect** in that row's menu and authorize the same account again. Tale renews exactly that credential: its name, default choice and references stay, and no other credential changes. Reconnect does not re-enable a deliberately disabled credential; **Enable** returns it to service.

If the credential is removed before consent completes, or your role no longer allows you to manage credentials, Tale saves nothing and shows the reason. For Slack, authorize the workspace the credential already connects. Tale refuses a different workspace; connect that one with **Add credential**.

If the connection cannot start, check whether the OAuth app is configured. If the vendor rejects the return to Tale, compare the registered redirect URI with the exact URI shown by Tale. If an action fails after connecting, check the account's permissions and the required scope for that action.

For systems without a built-in connector, see [MCP and custom integrations](/platform/connectors/mcp-servers). Registering an arbitrary outbound MCP server is not part of this credential page.
