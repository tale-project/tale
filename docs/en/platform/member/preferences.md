---
title: Manage your account and preferences
description: Update your name, secure your sign-in, choose a language, and understand the personal settings available in Tale.
---

Your account settings control how teammates recognize you and how you sign in. Your profile menu also lets you switch organization and language and shows the teams you belong to. These controls are available without an administrator role.

## Update the name your teammates see

Open **Settings > Account**. Under **Profile**, edit **Name** and click **Save** in the page header. **Discard** restores the saved value. Your email address is shown as read-only because it identifies the account used to sign in and receive notifications.

The name is visible to teammates. It is not a private instruction to the assistant.

## Protect your sign-in

The **Security** section offers **Change password**, or **Set password** for an account that does not yet have one. Follow the password requirements shown in the dialog. Changing the password signs out your sessions, so keep the new password available before confirming.

Set up an authenticator under **Two-factor authentication** or add a passkey under **Passkeys**. Store backup codes somewhere you can reach without signing in to Tale. [Two-factor authentication](/platform/admin/two-factor-authentication) covers setup, recovery, and organization requirements.

## Switch language or workspace

Open the profile menu from your avatar. **Language** changes the interface language. When you belong to several organizations, **Organization** switches the workspace. The **Teams** row names the teams you are in and opens the account page; it switches nothing, because a team is not a workspace.

Check the organization name before changing settings or adding content.

## See your role {#role}

**Settings > Account > Your role** shows your role in this organization, such as Editor or Member. Your role decides what you can do; your teams decide which team work you can see. Admins assign roles under [Members and roles](/platform/admin/members-and-roles). With single sign-on, your identity provider can also set your role each time you sign in. Owners and Admins see a **Manage members** link in the section.

## See your teams {#teams}

**Settings > Account > Your teams** lists the teams you belong to. Teams decide which team documents, projects, and inbox queues you can see; work shared with the whole organization is visible to you regardless. When you are in no team, the section says so.

To narrow a list to certain work, use its **Teams** filter: **Organization-wide** shows only items without a team, **My teams** shows items any of your teams can see, and each team is listed by name. The inbox offers an **Assignee** filter behind its search box, listing people and teams together. A filter changes the current view; it does not grant access to another team’s data.

Owners and Admins manage membership under [Teams](/platform/admin/teams); the section links there for them.

## Set custom instructions for the chat assistant

Open **Settings > Preferences**. **Custom instructions** are standing instructions the chat assistant follows in every reply to you, such as a preferred tone, a default programming language, or how much detail you want. The switch can follow the organization default or store your own choice; the hint under it says which applies. The text field appears while the feature is on. Type your instructions and click **Save** in the page header.

<Frame caption="Preferences holds your custom instructions and the switch that turns them on.">

![The Preferences page shows the Custom instructions switch and its text field.](/images/platform/settings-preferences.webp)

</Frame>

<Note>

Your instructions never override the organization’s mandatory instructions or a project’s **General > Instructions**; where they conflict, those take precedence. Turning the switch off keeps the text for later without applying it.

</Note>

## Check your usage limits {#usage-limits}

Open **Settings > Usage** to see how much you have used of each limit your organization applies to you. The page says so when no limit covers you.

<Frame caption="Settings > Usage lists each limit that applies to you with its usage and next reset.">

![The Usage page lists personal monthly token, cost, and request limits and the organization's shared monthly limits, each with a usage bar and its reset date, above the storage used against the per-user limit. An administrator also sees a Manage limits button.](/images/platform/settings-usage.webp)

</Frame>

- **Your limits** count your own chats, voice output, and agent runs, whichever way you started them; [How usage is counted](/platform/admin/governance/usage-attribution) explains who a run counts against. When one is reached, you can't start more of that work until it resets: a message you send then is refused with a notice that names the limit, and it stays in the composer.
- **Shared limits** count the usage of everyone they cover, such as a team you belong to or the entire organization, so they can be reached before your own limits.
- **Storage** compares the files you have uploaded with your storage limit. New document uploads are refused once it is reached.

Each usage limit shows the amount used, the limit, and when it resets in your local time. Periods follow UTC: daily limits reset at midnight, weekly limits on Monday, and monthly limits on the first of the month. If an administrator set a warning threshold, the bar turns amber once your usage reaches it. When a banner above the composer warns about a limit, **View usage** opens this page. Administrators also see **Manage limits**, which opens **Governance > Policies & Limits**.

## Archive old chats or sign out

**Settings > Account > Your chats** offers **Archive all chats** and **Delete all chats** for your own chats in the current organization, including project chats. Archiving affects unarchived chats; deleting also includes archived chats and moves them to Trash, where they can be restored during the retention grace period. Chats under legal hold remain unchanged, and chats with a running reply cannot be deleted.

Read the confirmation before proceeding. The result reports how many chats changed and how many could not be changed. Use an individual chat’s menu when you only want to organize that conversation.

**Log out** in the profile menu ends the current session and returns you to sign-in. Sign out on a shared device when you finish using Tale. For a dedicated app window on your own device, see [Install as app](/platform/member/install-as-app).
