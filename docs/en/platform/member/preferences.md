---
title: Manage your account and preferences
description: Update your name, secure your sign-in, choose a language, and understand the personal settings available in Tale.
---

Your account settings control how teammates recognize you and how you sign in. Your profile menu also lets you switch organization, team, and language. These controls are available without an administrator role.

## Update the name your teammates see

Open **Settings > Account**. Under **Profile**, edit **Name** and click **Save** in the page header. **Discard** restores the saved value. Your email address is shown as read-only because it identifies the account used to sign in and receive notifications.

The name is visible to teammates. It is not a private instruction to the assistant.

## Protect your sign-in

The **Security** section offers **Change password**, or **Set password** for an account that does not yet have one. Follow the password requirements shown in the dialog. Changing the password signs out your sessions, so keep the new password available before confirming.

Set up an authenticator under **Two-factor authentication** or add a passkey under **Passkeys**. Store backup codes somewhere you can reach without signing in to Tale. [Two-factor authentication](/platform/admin/two-factor-authentication) covers setup, recovery, and organization requirements.

## Switch language or workspace

Open the profile menu from your avatar. **Language** changes the interface language. When you belong to several organizations, **Organization** switches the workspace; **Team** narrows the current team view when teams are available.

Check the organization name before changing settings or adding content. A team filter changes the current view; it does not grant access to another team’s data.

## Understand remembered navigation {#navigation-memory}

Tale remembers the last place you visited in each [main section](/platform#navigation), separately for each organization. Switching organization and returning keeps that organization’s places. Each browser tab keeps its own navigation, so you can work in two projects side by side.

A new tab can pick up recent places from the same browser. That shared copy expires after eight hours without recorded navigation in the organization; a tab that already remembers a place keeps its own copy. This is browser-local state and does not sync to another device. Signing out clears remembered navigation in the current tab and the shared browser copy. If browser storage is unavailable, sections use their default entry points.

## Understand the Preferences page

Open **Settings > Preferences** to view **Custom instructions** and **Memories**. The switches can follow organization defaults or store a personal choice. Saved instructions and memory lists belong to your preferences.

<Frame caption="Preferences contains stored personal instructions and memory controls.">

![The Preferences page shows a Custom instructions editor and a Memories section with pending and saved-memory lists.](/images/platform/settings-preferences.webp)

</Frame>

<Note>

The current chat assistant does not use these personal instructions or memory tools in its replies. Saving a preference here is not a way to give chat lasting context. Put the requirement in your message, or use the project’s **General > Instructions** field for context shared by its chats.

</Note>

If memory entries already exist, review pending suggestions and keep only those you want stored. Delete a saved entry when it should no longer be retained. Do not treat the presence of an entry as evidence that a chat has read it.

## Check your usage limits {#usage-limits}

Open **Settings > Usage** to see how much you have used of each limit your organization applies to you. The page says so when no limit covers you.

<Frame caption="Settings > Usage lists each limit that applies to you with its usage and next reset.">

![The Usage page lists personal monthly token, cost, and request limits and the organization's shared monthly limits, each with a usage bar and its reset date, above the storage used against the per-user limit. An administrator also sees a Manage limits button.](/images/platform/settings-usage.webp)

</Frame>

- **Your limits** count your own chats, voice output, and agent runs. When one is reached, you can't start more of that work until it resets.
- **Shared limits** count the usage of everyone they cover, such as a team you belong to or the entire organization, so they can be reached before your own limits.
- **Storage** compares the files you have uploaded with your storage limit. New document uploads are refused once it is reached.

Each usage limit shows the amount used, the limit, and when it resets in your local time. Periods follow UTC: daily limits reset at midnight, weekly limits on Monday, and monthly limits on the first of the month. If an administrator set a warning threshold, the bar turns amber once your usage reaches it. When a banner above the composer warns about a limit, **View usage** opens this page. Administrators also see **Manage limits**, which opens **Governance > Policies & Limits**.

## Archive old chats or sign out

**Settings > Account > Your chats** offers bulk archive and delete actions. Read the confirmation carefully before using a bulk action; it applies across your chat history. Use an individual chat’s menu when you only want to organize that one conversation.

**Log out** in the profile menu ends the current session and returns you to sign-in. Sign out on a shared device when you finish using Tale. For a dedicated app window on your own device, see [Install as app](/platform/member/install-as-app).
