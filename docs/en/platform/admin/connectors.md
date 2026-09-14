---
title: Connector credentials
description: Connect service accounts, choose defaults, and repair or replace their authorization.
---

Add connector credentials so Tale can use services such as a mailbox, file store, or issue tracker. Owners, Admins, and Developers manage them under **Settings > Connectors**. Choose the service and account your work needs; the [connector catalog](/platform/connectors/overview) explains each service's available actions.

## Add an account

1. Select **Add credential**, then the connector. Already configured connectors appear first and can hold additional credentials.
2. Enter a **Name** that an automation author will recognize, such as `Support inbox` or `EU store`.
3. Complete the authentication method offered by that connector. For OAuth, select **Connect** and complete the vendor's consent flow.
4. Complete the form and check the resulting row, including its connector, account or instance, and status.

The connector determines which fields appear. Use the account's actual credentials, not a Tale API key.

| Method | Required information |
| --- | --- |
| API key | The key issued by the service, such as Tavily or Shopify. |
| Token | A service token, such as a GitHub personal access token or Discord bot token. |
| Username and password | The service's expected pair. This can be a login and app password, or a vendor-specific ID and token. |
| OAuth | Authorization in the vendor's browser flow; Tale stores the returned authorization. |

Some connectors also require an instance address. For Confluence, use the Atlassian site origin. For Shopify, use the store's `myshopify.com` origin, not the customer-facing storefront domain.

## Choose the default

The table contains one row per credential. The **Default** badge marks the credential used when an action does not explicitly name one. Select **Make default** in a row's menu to change it; one default is allowed per connector.

A connector with several credentials and no default can still serve callers that name a credential. Callers that omit the name need a default. Name accounts clearly before wiring automations so a future administrator can identify the intended account.

Mailbox synchronization and inbox triage can inspect every active credential for a mailbox connector. A second mailbox does not have to become the default before these operations can find it.

## Rotate a secret or pause access

Use the row's replacement action for its method, such as **Replace API key** or **Replace token**. The new secret replaces the stored one while preserving the credential's name, default choice, and references. Test an appropriate service action after replacement.

**Disable** pauses a credential while retaining its configuration; **Enable** restores it. **Edit credential** handles other editable details, including its name or instance address where supported.

<Warning>

Deleting credentials removes access for automations and agents that depend on them. Move callers first and select a new default when needed. Deletion cannot be undone by reopening the same row.

</Warning>

## Prepare an OAuth app

Owners and Admins use **OAuth apps** at the bottom of the page to configure the vendor app registrations used during consent. An organization app overrides the deployment-wide app. If neither exists, the connector cannot start authorization and the page shows that it is not configured.

Select **Configure**, enter the vendor's client ID and secret, and register the exact redirect URIs shown in the dialog with the vendor. Microsoft apps may also require a directory/tenant ID. On a later edit, leave a stored secret blank to keep it.

The Google Drive app also supports Knowledge import. The OneDrive/SharePoint import entry is for Knowledge rather than a separate connector. Slack's app is configured by the deployment operator. Read the relevant [connector guide](/platform/connectors/overview) before assigning vendor permissions.

For OneDrive/SharePoint, **Use Entra ID SSO app** can copy an existing SSO registration into the import configuration. This is a one-time copy: after rotating the SSO secret, copy it again and review the redirect URI and delegated permissions listed by the confirmation.

## Reconnect or diagnose a failure

**Reconnect needed** means stored OAuth authorization can no longer refresh. Choose **Reconnect** and authorize the account again. This keeps the credential's name and references. A deliberately disabled credential instead needs **Enable**.

If the connection cannot start, check whether the OAuth app is configured. If the vendor rejects the return to Tale, compare the registered redirect URI with the exact URI shown by Tale. If an action fails after connecting, check the account's permissions and the required scope for that action.

For systems without a built-in connector, see [MCP and custom integrations](/platform/connectors/mcp-servers). Registering an arbitrary outbound MCP server is not part of this credential page.
