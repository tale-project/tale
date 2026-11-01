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

Start every connection with **Connect** in Tale. Tale refuses a connection link opened from another website, so a link someone sends you cannot connect an account or a mailbox on your behalf.

The connector determines which fields appear. Use the account's actual credentials, not a Tale API key.

| Method | Required information |
| --- | --- |
| API key | The key issued by the service, such as Tavily or Shopify. Jev decisions takes an OpenRouter API key. |
| Token | A service token, such as a GitHub personal access token, a Forgejo access token with `read:repository` and `read:issue` (`write:issue` to change issues), a Discord bot token, or a GlitchTip API token with `project:read` and `event:read`. A GitHub token that syncs security alerts also needs read access to the repository's code scanning, Dependabot and secret scanning alerts. |
| Username and password | The service's expected pair. This can be a login and app password, or a vendor-specific ID and token. |
| OAuth | Authorization in the vendor's browser flow; Tale stores the returned authorization. |
| App sign-in | Your organization's own app registration with the vendor: its directory (tenant) ID, application (client) ID and client secret. The app signs in as itself, without a person; Tale fetches and renews its access token. Outlook uses it to reach a [shared mailbox](#connect-a-shared-outlook-mailbox). |

Some connectors also require an instance address. For Confluence, use the Atlassian site origin. For Forgejo, use the instance origin without a path, such as `https://codeberg.org`, and for GlitchTip the instance origin, such as `https://app.glitchtip.com`; a self-hosted Forgejo or GlitchTip instance must also be allowed by the deployment's connector host policy. For Shopify, use the store's `myshopify.com` origin, not the customer-facing storefront domain.

## Choose the default

The table contains one row per credential and updates while it is open: a credential another admin adds, changes or deletes appears there without a reload. The **Default** badge marks the credential used when an action does not explicitly name one. Select **Make default** in a row's menu to change it; one default is allowed per connector.

A connector with several credentials and no default can still serve callers that name a credential. Callers that omit the name need a default. Name accounts clearly before wiring automations so a future administrator can identify the intended account.

Mailbox synchronization and inbox triage can inspect every active credential for a mailbox connector; a mail sync set to one mailbox reads only that one. A second mailbox does not have to become the default before these operations can find it. When you compose a new email, the **Inbox** field lists each mailbox by its name, and the email leaves from the one you choose. Replies in that conversation, including a retry of a failed send, leave from the same mailbox.

Notification emails to members also leave through a connected mailbox, for everyone who keeps [**Email me actionable alerts**](/platform/member/preferences#notification-email) on. Tale picks an active IMAP / SMTP Mailbox credential first, then Gmail, then Microsoft Outlook, and within a connector its default credential. Through IMAP / SMTP, the emails come from `notification@` at the mailbox's domain: a mailbox that signs in as `support@example.com` sends them as `notification@example.com`. Without an active mailbox credential, members get their notifications only in Tale. A send that fails is not tried again; the notification in Tale stays.

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

## Connect a shared Outlook mailbox

A shared mailbox, such as `promotion@example.com`, has no sign-in of its own. Tale reaches it in one of two ways: your organization's own Microsoft app signs in as itself and is allowed into that one mailbox, or a person who already has Full Access to the mailbox connects with their own account. Either way, the credential's **Mailbox** field names the shared address, and every Outlook action, the mailbox sync and the Inbox then work in that mailbox and use its address as the sender. **Mailbox** takes an email address only; Tale refuses an ID such as the mailbox's object ID. You enter the mailbox when you add the credential, and it cannot be changed afterwards: what the credential has read and sent belongs to that mailbox. To work in another mailbox, add another credential.

The app sign-in is the better fit for a team inbox: it does not depend on one person's account, and Exchange limits the app to the mailboxes you choose.

1. In Microsoft Entra ID, register a single-tenant app for this purpose and add a client secret. Note the **Directory (tenant) ID** and **Application (client) ID** on its overview page. Do not grant it Microsoft Graph mail permissions in Entra ID: those would reach every mailbox in your organization.
2. In Exchange Online PowerShell, as an Exchange administrator, scope the app to the mailbox with RBAC for Applications. Take the IDs from the app's **Enterprise applications** entry, not from **App registrations**:

   ```powershell
   New-ServicePrincipal -AppId <application-id> -ObjectId <enterprise-app-object-id> -DisplayName "Tale promotion mailbox"
   New-ManagementScope -Name "Tale promotion mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'promotion@example.com'"
   New-ManagementRoleAssignment -App <application-id> -Role "Application Mail.ReadWrite" -CustomResourceScope "Tale promotion mailbox"
   New-ManagementRoleAssignment -App <application-id> -Role "Application Mail.Send" -CustomResourceScope "Tale promotion mailbox"
   Test-ServicePrincipalAuthorization -Identity <application-id> -Resource promotion@example.com
   ```

   `Application Mail.ReadWrite` lets Tale read the mailbox and write reply drafts; `Application Mail.Send` lets it send. Add `Application Calendars.ReadWrite` or `Application Contacts.Read` the same way if automations use the mailbox's calendar or contacts. Exchange can take up to two hours to apply a new assignment.
3. In Tale, select **Add credential**, then **Microsoft Outlook**. In the form, enter the directory (tenant) ID, the application (client) ID, the client secret and, under **Mailbox**, the shared address, then add the credential. Its row shows **App sign-in** and which app it uses, by application ID and directory; the client secret shows only as its first and last characters.
4. Send a test message to the shared address and check that it appears in the Inbox. To give its conversations to the team that handles them, add a [conversation routing](/platform/admin/governance/policies-and-limits#conversation-routing) rule for the mailbox.

When the client secret expires, replace it with **Replace app credentials** in the row's menu. The form starts with the directory and application ID filled in, so only the new client secret needs entering; the credential keeps its name, mailbox and references.

If a person handles the mailbox instead, select **Add credential**, then **Microsoft Outlook**. In the box above the form, enter the shared address under **Mailbox**, then select **Connect** and sign in as that person. Because a mailbox is named, the consent screen also asks for access to mailboxes that account can open, and the new credential works in the shared mailbox from its first sync. The person needs Full Access to the mailbox, and Send As to send from it. Leave **Mailbox** empty to connect the person's own mailbox.

## Reconnect or diagnose a failure

**Reconnect needed** means stored OAuth authorization can no longer refresh. Choose **Reconnect** in that row's menu and authorize the same account again. Tale renews exactly that credential: its name, default choice and references stay, and no other credential changes. Reconnect does not re-enable a deliberately disabled credential; **Enable** returns it to service.

If the credential is removed before consent completes, or your role no longer allows you to manage credentials, Tale saves nothing and shows the reason. For Slack, authorize the workspace the credential already connects. Tale refuses a different workspace; connect that one with **Add credential**.

If the connection cannot start, check whether the OAuth app is configured. If the vendor rejects the return to Tale, compare the registered redirect URI with the exact URI shown by Tale. If an action fails after connecting, check the account's permissions and the required scope for that action.

An app sign-in has no **Reconnect**. If the vendor refuses the app, the action or mailbox sync fails with a message that the token endpoint refused the app's sign-in, followed by the vendor's reason, such as `invalid_client` for a wrong or expired client secret. Check the directory ID, application ID and client secret, and replace them. If the token endpoint cannot be reached or is busy, the message says so instead, and the next attempt tries again. If Microsoft Graph denies access to a shared mailbox, the error names the mailbox and the Exchange role the action needs, for example `Application Mail.Send` for sending.

If the page says **Couldn't load the connectors.**, or the credentials table shows an error in place of its rows, Tale couldn't read them; nothing was removed. Select **Try again**. While the connectors can't be read, **Add credential** shows the same notice instead of the catalog.

For systems without a built-in connector, see [MCP and custom integrations](/platform/connectors/mcp-servers). Registering an arbitrary outbound MCP server is not part of this credential page.
