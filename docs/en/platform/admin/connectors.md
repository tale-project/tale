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
| GitHub App | A name for the credential and for the app, and optionally the GitHub organization that owns the app. Tale registers your organization's own GitHub App and keeps its private key; what Tale creates on GitHub then appears as the app's bot. See [Connect GitHub with a GitHub App](#connect-github-with-a-github-app). |

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

## Connect GitHub with a GitHub App

With a personal access token, everything Tale creates on GitHub appears under the account of the person who owns the token. A GitHub App gives Tale an identity of its own: your organization registers its own app from Tale and installs it on the repositories Tale should work in. Tale's GitHub actions for issues, pull requests, reviews, comments, merges and imports then authenticate with installation tokens that Tale mints when needed. Each one lasts an hour and carries only the permissions listed below. What Tale creates appears as the app's bot, `<app-slug>[bot]`, with the app's name and logo instead of a person's account.

The app is optional, and token credentials keep working unchanged. Only Owners and Admins register, install or change it.

<Note>

Agent runs don't receive the app's token yet. `git` and `gh` in a run's sandbox still use a token credential, so commits an agent pushes from its sandbox appear under that token's account, not as the app's bot. Issue [#5295](https://github.com/tale-project/tale/issues/5295) tracks giving runs an installation token for each turn and the app's bot identity.

</Note>

### Register the app

1. Select **Add credential**, then **GitHub**. Above the token form, a box of its own registers the app and lists the permissions it asks GitHub for. A member who isn't an Owner or Admin sees only a note there to ask an admin.
2. Check **Credential name** and **App name on GitHub**. The credential name starts as the connector's name, numbered like any other: `GitHub`, then `GitHub 2`. The app name starts as Tale followed by your organization's name, takes at most 34 characters and must be unique on GitHub; the bot's name derives from it.
3. Under **GitHub organization**, enter the login of the GitHub organization whose repositories Tale should reach. You must be an owner of that organization. Leave the field empty to register the app on your personal GitHub account instead. The app is private, and GitHub installs a private app only on the account that owns it, so register it on the account that holds the repositories.
4. Select **Register on GitHub**. GitHub shows the app it is about to create and the permissions it asks for; if the name is already taken, you can change it there. Select **Create GitHub App**, and GitHub opens the app's install page, described in the next section.

Finish on GitHub within 15 minutes. Tale completes a registration once, only for the admin who started it; after 15 minutes, register again.

The app has no webhook and asks for no OAuth authorization when it is installed. GitHub creates a private key with it, which Tale stores encrypted and never shows: the key never appears in a log, an API answer or an agent sandbox. Tale doesn't keep the client secret and webhook secret that GitHub also issues.

There is no shared Tale app: each organization registers its own, on each deployment. GitHub sends your browser back to Tale's public address, so open Tale at that address when you register and install the app. GitHub itself never calls Tale. The [connector developer guide](/develop/connectors#registering-a-github-app) lists the addresses GitHub returns to.

### Install it on chosen repositories

On GitHub's install page, choose the account, select **Only select repositories**, pick the repositories Tale should work in, and select **Install**. GitHub returns you to Tale, where the credential's row links to the app on GitHub and reads **Installed on** followed by the account. Select **Show repositories** in that row to open **Repositories this app reaches**, which lists the repositories and marks private ones **Private**. Like every GitHub App, the app can also read public repositories.

Until the app is installed, the row shows a **Not installed** badge and reads **Registered on GitHub, not installed yet.**, and Tale's GitHub actions can't use the credential. If you left GitHub before installing, or took longer than 15 minutes, select **Install on GitHub** in the row's menu to continue. If GitHub asks an organization owner to approve the installation instead, select **Install on GitHub** again once the owner has approved it. Tale then finds the installation on GitHub and takes it over without sending you there. It does the same when someone, for example an owner, installed the app on GitHub directly.

If the app is uninstalled on GitHub, Tale finds out the next time it uses the app. The row then shows a **No longer installed** badge and reads **No longer installed on** followed by the account, and Tale's GitHub actions can't use the credential until you select **Install on GitHub** and install the app again.

If you choose **All repositories**, the app reaches every repository of the account, including ones added later, and **Repositories this app reaches** warns about it. To narrow it, select **Open on GitHub** in the warning and choose **Only select repositories**.

If the connector already has a default credential, select **Make default** in the menu of the app's credential so that actions which name no credential use the app.

### Upload the logo

GitHub can't take a logo from the registration, so a new app shows a generated pattern. To show Tale's logo next to what the app creates, upload it on GitHub:

1. Download Tale's logo from your Tale address at `/assets/pwa-512x512.png`, or take `services/platform/public/assets/pwa-512x512.png` from Tale's source.
2. On GitHub, select your profile picture, then **Settings**. For an app owned by an organization, select **Your organizations** and the organization's **Settings** instead. Then select **Developer settings**, **GitHub Apps** and **Edit** next to the app.
3. Under "Display information", select **Upload a logo** and choose the file. Crop it if needed, then select **Set new avatar**.

GitHub takes a PNG, JPG or GIF under 1 MB and recommends 200 × 200 pixels. Tale's logo is a 512 × 512 PNG of about 3 KB.

### Permissions the app asks for

The app asks only for repository permissions, each for what Tale's GitHub actions do:

| Permission | Level | What it serves |
| --- | --- | --- |
| Metadata | Read-only | Required by GitHub; listing and reading repositories |
| Contents | Read and write | Merging pull requests, reading commits, searching code |
| Issues | Read and write | Creating, updating, labeling and commenting on issues; reading and importing them |
| Pull requests | Read and write | Creating pull requests, reviewing and commenting on them; reading them with their files and diffs |
| Code scanning alerts (`security_events`) | Read-only | Importing security alerts |
| Dependabot alerts (`vulnerability_alerts`) | Read-only | Importing security alerts |
| Secret scanning alerts (`secret_scanning_alerts`) | Read-only | Importing security alerts |

It asks for no administration or workflows permission, and for no organization or account permissions.

<Warning>

Without the workflows permission, the app can't change files under `.github/workflows/`, and GitHub refuses to merge a pull request through the app when it changes one. Granting it on GitHub would let anything that holds one of the app's tokens change your CI, so add it only deliberately.

</Warning>

### Change the repositories

Select **Change repositories** in the credential's menu, or at the bottom of **Repositories this app reaches**, to open the app's installation settings on GitHub. Under "Repository access", add or remove repositories and select **Save**. GitHub returns you to Tale, and **Repositories this app reaches** lists the repositories the app reaches now.

You can also open the installation settings on GitHub directly. For an organization, open its **Settings**, select **GitHub Apps** under "Third-party Access", then **Configure** next to the app. For your personal account, open **Settings**, then **Applications**, **Installed GitHub Apps** and **Configure**. After a change there, GitHub returns you to Tale as well. If that browser is signed in to Tale as an Owner or Admin of your organization, Tale records a switch between all and chosen repositories, but not a change of only which repositories are chosen.

### Disconnect, or go back to a token

To disconnect, select **Delete** in the credential's menu; the audit log records the deletion. Tale leaves the app on GitHub, so remove it there as well: **Uninstall** in its installation settings removes it from the account, and **Delete GitHub App**, under **Advanced** in the app's settings, deletes it with all its installations.

A GitHub App credential has no replacement action and no **Reconnect**. To start over, for example with a new private key, delete the credential and the app, and register a new one.

To go back to a token, add a GitHub credential with the **Token** method and select **Make default** in its menu.

### What the audit log records

The [audit log](/platform/admin/governance/audit-logs) records who connected, changed and disconnected the app, and when, with the app ID. The entry of each installation, and of each change Tale records when GitHub returns you to it, also carries the installation ID, the account and the repository selection, and lists the chosen repositories when the app reaches only some. A change Tale notices only when it next mints a token, such as a renamed account or a switch between all and chosen repositories made on GitHub, is recorded with **System** as the actor. A disconnection's entry carries the installation ID and the repository selection as well. Tale has no webhook, so the audit log can miss a change of only which repositories are chosen; **Repositories this app reaches** always lists them as GitHub has them now. The server log records each token Tale mints, including the ones for **Repositories this app reaches**, with its app, installation, repository selection and expiry, but never the token itself.

## Reconnect or diagnose a failure

**Reconnect needed** means stored OAuth authorization can no longer refresh. Choose **Reconnect** in that row's menu and authorize the same account again. Tale renews exactly that credential: its name, default choice and references stay, and no other credential changes. Reconnect does not re-enable a deliberately disabled credential; **Enable** returns it to service.

If the credential is removed before consent completes, or your role no longer allows you to manage credentials, Tale saves nothing and shows the reason. For Slack, authorize the workspace the credential already connects. Tale refuses a different workspace; connect that one with **Add credential**.

If the connection cannot start, check whether the OAuth app is configured. If the vendor rejects the return to Tale, compare the registered redirect URI with the exact URI shown by Tale. If an action fails after connecting, check the account's permissions and the required scope for that action.

An app sign-in has no **Reconnect**. If the vendor refuses the app, the action or mailbox sync fails with a message that the token endpoint refused the app's sign-in, followed by the vendor's reason, such as `invalid_client` for a wrong or expired client secret. Check the directory ID, application ID and client secret, and replace them. If the token endpoint cannot be reached or is busy, the message says so instead, and the next attempt tries again. If Microsoft Graph denies access to a shared mailbox, the error names the mailbox and the Exchange role the action needs, for example `Application Mail.Send` for sending.

If the page says **Couldn't load the connectors.**, or the credentials table shows an error in place of its rows, Tale couldn't read them; nothing was removed. Select **Try again**. While the connectors can't be read, **Add credential** shows the same notice instead of the catalog.

For systems without a built-in connector, see [MCP and custom integrations](/platform/connectors/mcp-servers). Registering an arbitrary outbound MCP server is not part of this credential page.
