---
title: Manage your account and preferences
description: Update your name, secure your sign-in, choose a language and your notifications, and understand the personal settings available in Tale.
---

Your account settings control how teammates recognize you and how you sign in. Your profile menu also lets you switch organization and language and shows the teams you belong to. These controls are available without an administrator role.

## Update the name your teammates see

Open **Settings > Account**. Under **Profile**, edit **Name** and click **Save** in the page header. **Discard** restores the saved value. Your email address is shown as read-only because it identifies the account used to sign in and receive notifications.

The name is visible to teammates and can be at most 100 characters long. It is not a private instruction to the assistant.

## When a password change is required

If an administrator sets or resets your password, or your password expires under the organization's rotation policy, the **Password change required** screen appears when you sign in. Enter a new password that meets the requirements shown on screen, confirm it, and select **Update password** to continue. For the exact messages, see [Members and roles](/platform/admin/members-and-roles).

## Protect your sign-in

The **Password** section offers **Change password**, or **Set password** for an account that does not yet have one. Follow the password requirements shown in the dialog. They come from your organization's password policy. If you belong to several organizations, your password must meet the requirements of every one of them. Changing the password signs out your sessions, so keep the new password available before confirming. A wrong current password counts toward the same temporary lock as a failed sign-in.

Set up an authenticator under **Two-factor authentication** or add a passkey under **Passkeys**. Store backup codes somewhere you can reach without signing in to Tale. [Two-factor authentication](/platform/admin/two-factor-authentication) covers setup, recovery, and organization requirements.

## Switch language or workspace

Open the profile menu from your avatar. **Language** changes the interface language. When you belong to several organizations, **Organization** switches the workspace. The **Teams** row names the teams you are in and opens the account page; it switches nothing, because a team is not a workspace.

Check the organization name before changing settings or adding content.

## See your role {#role}

**Settings > Account > Your role** shows your role in this organization, such as Editor or Member. Your role decides what you can do; your teams decide which team work you can see. Admins assign roles under [Members and roles](/platform/admin/members-and-roles). With single sign-on, your identity provider can also set your role each time you sign in. Owners and Admins see a **Manage members** button beside the section's title.

## See your teams {#teams}

**Settings > Account > Your teams** lists the teams you belong to. Teams decide which team documents, projects, and inbox queues you can see; work shared with the whole organization is visible to you regardless. When you are in no team, the section says so. If your teams can't be loaded, the section says that instead of claiming you are in no team. Choose **Try again** to load them. When a refresh fails, the teams already shown stay, with a note that they may be out of date.

To narrow a list to certain work, use its **Teams** filter: **Organization-wide** shows only items without a team, **My teams** shows items any of your teams can see, and each team is listed by name. The inbox offers an **Assignee** filter behind its search box, listing people and teams together. A filter changes the current view; it does not grant access to another team’s data.

Owners and Admins manage membership under [Teams](/platform/admin/teams); the section's **Manage teams** button takes them there.

## Set custom instructions for the chat assistant

Open **Settings > Preferences**. **Custom instructions** are standing instructions the chat assistant follows in every reply to you, such as a preferred tone, a default programming language, or how much detail you want. The switch can follow the organization default or store your own choice; the hint under it says which applies. The text field appears while the feature is on. Type your instructions and click **Save** in the page header.

<Frame caption="Preferences holds your custom instructions and the switch that turns them on.">

![The Preferences page shows the Custom instructions switch and its text field.](/images/platform/settings-preferences.webp)

</Frame>

<Note>

Your instructions never override the organization’s mandatory instructions or a project’s **General > Instructions**; where they conflict, those take precedence. Turning the switch off keeps the text for later without applying it.

</Note>

## Manage your notifications {#notifications}

On a computer, the bell at the foot of the rail collects the notifications meant for you, and its badge counts the unread ones. Owners and Admins also find notices about the organization there, such as a locked account. The bell isn't available on a phone.

Open the bell to read your notifications. **Unread** shows what you haven't read yet, and **All** includes the rest. The sort button switches between **Most recent** and **Priority**; **Priority** lists the notifications that ask something of you first. Choose a notification to open what it is about; that also marks it read. **Mark as read**, the check mark beside a notification, marks it read without opening it, and **Mark all as read** marks every one. **Expand** opens the list in a larger window.

While a notification is unread, a newer change to the same thing, such as another status change on the same task, updates it instead of adding a second one. Each comment and mention keeps its own. Some notifications also mark themselves read once what they asked for is done, such as a review request once the review is decided, or an agent's question once someone answers it.

### Choose which events reach you {#notification-events}

Open **Settings > Notifications**. Under **Notifications**, each kind of event has its own switch. Every switch is on until you turn it off, and each change is saved at once; if it can't be saved, **Couldn't save your notification preferences.** appears with the reason. Your choices apply to the organization you have open, so set them in each organization you belong to. Turning a switch off stops new notifications of that kind and their emails; the ones you already have stay.

| Switch | You're told when |
| --- | --- |
| **Task assigned to me** | A task is assigned to you or taken off you. Assigning a task to yourself doesn't notify you. |
| **Task status changed** | A task you watch moves to another status. Your own changes don't notify you. |
| **New comment** | Someone comments on a task you watch. A comment that mentions you counts as a mention instead. |
| **Mentions** | Someone mentions you with `@` in a task's comment or description. |
| **Start and due dates** | A task assigned to you reaches its start date or is due within a day. When no person holds the task, whoever created it is told. A task more than a day overdue is also reported to its creator and to the organization's Owners and Admins. |
| **Review requests** | A task or document waits for your review, or you're named the reviewer of a task before it reaches review. The switch also covers the decision on a document you submitted. |
| **Agent escalations** | An agent stops to ask a question on a task or run you can open. An agent run you started, or a run on a task you watch, fails and won't be tried again. |
| **Automation alerts** | An automation's schedule [pauses itself](/platform/automations/triggers#when-a-schedule-pauses-itself) after repeated failures. Only Owners and Admins receive these alerts, so only they see this switch. |
| **Messages from automations** | An automation [sends you a message](/platform/automations/notify-members), for example that a report is ready. |
| **Conversation messages** | A customer conversation is assigned to you or to one of your teams, by a person or, when it arrives, by a [routing rule](/platform/admin/governance/policies-and-limits#conversation-routing). Later messages in the conversation don't notify you. |

The **Review requests** switch is always on and can't be turned off. A review is how a person checks work, often an agent's, before it is accepted, so Tale treats a request as a safety signal that has to reach its reviewer.

You watch the tasks you created, are assigned to, commented on, were mentioned in, or review. To watch another task, choose **Watch** in the task's **Details**. **Unwatch** stops notifications about a task's status changes and comments without touching your switches; a mention, an assignment, or a review request still reaches you. You're only told about tasks in projects you can open.

### Get alerts by email {#notification-email}

The **Email me actionable alerts** switch, under **Email delivery** at the top of the page, also sends you by email the notifications that ask something of you:

- a task assigned to you, a mention, a review request, and a task's start or due date;
- an agent's question or failed run, a paused schedule, and a message from an automation;
- a conversation assigned to you or to one of your teams;
- a OneDrive or Google Drive sync of yours that stopped and, for Owners and Admins, a member's request for more usage credits.

Status changes, comments, a task taken off you, being named a task's reviewer before it reaches review, the decision on a document you submitted, and notices about the organization stay in the bell. Switching an event off under **Notifications** stops its email as well.

The email goes to your account's address, shown under **Settings > Account**. Tale waits about a minute before sending it: if you read the notification in Tale by then, no email follows, and if the same thing changes again meanwhile, one email carries the latest state. Nothing is emailed about a task in a project you can no longer open. Emails are written in the organization's default language, which Owners and Admins set as **Default language (for agents)** under **Settings > Organization**, not in the language you chose for Tale.

Emails leave through a mailbox your organization has connected: Gmail, Microsoft Outlook, or an IMAP / SMTP mailbox. Without one, the switch stays on, but your notifications reach you only in Tale. Owners, Admins, and Developers connect mailboxes under **Settings > Connectors**, and [Connector credentials](/platform/admin/connectors#choose-the-default) explains which mailbox sends the alerts.

## Check your usage limits {#usage-limits}

Open **Settings > Usage** to see how much you have used of each limit your organization applies to you. The page says so when no limit covers you. A project's limit, which caps everything spent in that project, is not listed here: in the project's chats, the banner above the composer warns about it, and a request it refuses says so.

<Frame caption="Settings > Usage lists each limit that applies to you with its usage and next reset.">

![The Usage page lists personal monthly token, cost, and request limits and the organization's shared monthly limits, each with a usage bar and its reset date, above the storage used against the per-user limit. An administrator also sees a Manage limits button.](/images/platform/settings-usage.webp)

</Frame>

- **Your limits** count your own chats, voice output, and agent runs, whichever way you started them; [How usage is counted](/platform/admin/governance/usage-attribution) explains who a run counts against. When one is reached, you can't start more of that work until it resets: a message you send then is refused with a notice that names the limit, and it stays in the composer.
- **Shared limits** count the usage of everyone they cover, such as a team you belong to or the entire organization, so they can be reached before your own limits.
- **Storage** compares the files you have uploaded with your storage limit. New document uploads are refused once it is reached.

Each usage limit shows the amount used, the limit, and when it resets in your local time. Periods follow UTC: daily limits reset at midnight, weekly limits on Monday, and monthly limits on the first of the month. If an administrator set a warning threshold, the bar turns amber once your usage reaches it. When a banner above the composer warns about a limit, **View usage** opens this page; a banner about a project's limit names the project instead. Administrators also see **Manage limits**, which opens **Governance > Policies & Limits**.

## Archive old chats or sign out

**Settings > Account > Your chats** offers **Archive all chats** and **Delete all chats** for your own chats in the current organization, including project chats. Archiving affects unarchived chats; deleting also includes archived chats and moves them to Trash, where they can be restored during the retention grace period. Chats under legal hold remain unchanged, and chats with a running reply cannot be deleted.

Read the confirmation before proceeding. The result reports how many chats changed and how many could not be changed. Use an individual chat's menu in Home when you only want to organize that conversation. Archived chats stay under **Archived** at the bottom of the Home list, where **Unarchive** in a chat's menu brings it back.

**Log out** in the profile menu ends the current session and returns you to sign-in. Sign out on a shared device when you finish using Tale. For a dedicated app window on your own device, see [Install as app](/platform/member/install-as-app).

If your session ends while Tale is open, for example because you logged out in another tab, a refused request shows **Your session has ended. Sign in again.**, and a document upload fails with the same sentence and no retry. A project's **Environment** tab you open afterwards shows **Admin access required** instead. One that was already open, or that you open again less than five minutes after it last loaded, still shows its variables, and saving there shows the same sentence. **Settings > Data residency** says **You're not allowed to manage this organization's data residency.** On your organization's pages, whose addresses start with `/dashboard`, Tale checks the session and asks before opening sign-in. Signing in leaves the page, so unsaved changes may be lost. Choose **Stay here** to keep the page and copy any work you need. Further refusals do not reopen the confirmation. On other pages, Tale doesn't ask: reload the page to sign in again.

When you are ready, close any open dialog and choose **Sign in** in the notice that stays at the top of the page, above its header, then confirm. Tale checks again before leaving; if another tab has already restored your session, your page stays open. Otherwise, the sign-in page shows the same session notice. After signing in, you return to the page you were on; copied work can be re-entered, but unsaved drafts are not restored automatically.
