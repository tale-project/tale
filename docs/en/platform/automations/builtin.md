---
title: Built-in automations
description: What each shipped automation does — the inbox trio, the Resolve GitHub issues bundle, the sync and upkeep templates, and the pre-installed packs that run your boards and mentions.
---

Tale ships automations out of the box: three that turn a mailbox into a shared inbox, one bundle that resolves GitHub issues end to end, a set of sync and upkeep templates you install when you need them, and the pre-installed packs that run task boards and mentions for every organization. Editors and Members use whatever an installed automation adds — an Inbox tab, a Backlog entry — without installing anything themselves; installing is an Owner/Admin/Developer action covered on [Browse and install](/platform/automations/catalog). This page names what each one does and the connector it needs connected first.

<Frame caption="The Automations catalog — every card is one install away; hidden pack members and bundle internals stay out of the list.">

![The Automations catalog on the All automations tab, showing cards for the email automations and the Resolve GitHub issues bundle, each with its icon and description.](/images/platform/automations-catalog.webp)

</Frame>

## Sync Gmail, Outlook, and email over IMAP

**Sync Gmail emails**, **Sync Outlook emails**, and **Sync emails via SMTP/IMAP** are the same automation three times over, one per mailbox kind: each requires exactly the connector its name says, each installs the same channel-agnostic **Inbox** builtin view, and each carries the mail-sync workflow that pulls the mailbox into conversations on a schedule, every six hours out of the box (change the [schedule trigger](/platform/automations/triggers) to pull more often). An organization that receives mail on more than one kind of mailbox installs more than one of these; each Inbox only shows its own mailbox's traffic.

| Automation                | Requires  | Mailbox                                |
| ------------------------- | --------- | -------------------------------------- |
| Sync Gmail emails         | Gmail     | A Gmail mailbox                        |
| Sync Outlook emails       | Outlook   | A Microsoft Outlook mailbox            |
| Sync emails via SMTP/IMAP | IMAP/SMTP | Any private mailbox over IMAP and SMTP |

## The Inbox tab

Every one of the three opens on its **Inbox** tab: four sub-tabs — **Open**, **Closed**, **Spam**, **Archived** — each a split view with the conversation list on the left and the selected thread on the right. Opening a conversation fills the right pane with its full message history; until you pick one, the pane reads **Select a conversation to view details**.

The message field sits under the thread on **Open** — replies belong to active conversations, so the other three tabs are read-only. Write in **Type a message** and click **Send**; the reply goes out through the mailbox the conversation arrived on, with the recipient and subject line derived from the thread — there's nothing to address by hand. The thread header shows the real **From** for that conversation — the address the contact wrote to, or the sender you pick when composing — so what you see matches what a reply actually sends as. On a Gmail or Outlook connection the compose **From** is the connected account's address; on IMAP/SMTP you edit only the local part of **From**, and the verified domain stays fixed as a badge so you never leave it. **Improve** rewrites your draft with AI before you send it. On the IMAP automation, replies sent from the mailbox itself — from any mail client — sync into the conversation too, ordered with the rest of the thread.

The thread header carries the status verbs for whichever conversation is selected — **Close conversation** and **Mark as spam** on an open thread, **Reopen conversation** on a closed or archived one, **Not spam** and the destructive **Delete** on spam. Selecting several rows in the list surfaces the same verbs as bulk actions.

Admins and Owners also use the header **Assignee** control to queue work. Open it and pick from **People** and **Team** — the two are independent, so a conversation can sit in a team's queue and still be assigned to one person. Changing the person notifies them in-app and by email; queuing to a team notifies that team's members (the actor is skipped either way). Self-assignment, clearing the person (**Unassign**), and removing the team (**Remove team**) notify no one. Non-admins see the current assignment as read-only. Pair assignment with [Conversation routing](/platform/admin/governance/policies-and-limits#conversation-routing) when inbound addresses should land in a queue automatically, and with [Conversation assignee control](/platform/admin/governance/policies-and-limits#conversation-assignee-control) when an assigned thread should be private to that team or person.

## Resolve GitHub issues

**Resolve GitHub issues** is a bundle, not a single automation: installing it runs one aggregated wizard that installs four hidden automations at once, bound to the project you choose, and requires the GitHub connector. Each member does one stage of the loop. **Triage GitHub issues** scores a repository's open issues on a schedule and proposes the actionable ones onto the project's [Backlog](/platform/projects/backlog) — titled `#<number> <title>`, labelled to match GitHub, and left for a human to review. **Sync GitHub issues** closes a task the moment its GitHub issue closes, whether the resolve chain merged the fix or a human closed the issue directly on GitHub — it only closes, never creates or reopens a task. **Create GitHub pull requests** ships the PR Creator agent: once a human Starts a proposed task, it clones the repository, opens or adopts the pull request for the issue, implements the fix, verifies it against the project's own tests, and waits for CI to go green. **Review GitHub pull requests** ships the PR Reviewer agent: it re-tests the PR Creator's branch, confirms CI, and a toolless judge decides mergeability — approved parks the task at **In review** for a human to merge on GitHub; not approved sends it back to the PR Creator with feedback, up to a small rework cap.

A human stays in the loop at two points: starting a proposed task off the Backlog, and merging the pull request on GitHub itself — nothing in the bundle merges on your behalf.

## Sync and upkeep templates

Eight more automations sit in the catalog for the moments you need them. Each is a single workflow you install and then point at your data — the sync ones ask for their source on the schedule they create, and every one is editable afterwards on the automation's own page, where an edit becomes a new version you deploy when you are ready.

| Automation                         | Requires     | What it does                                                                  |
| ---------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| Sync Confluence pages              | Confluence   | Imports a Confluence space's pages into the knowledge library on a schedule   |
| Sync Google Drive files            | Google Drive | Imports a Drive folder's documents into the knowledge library                 |
| Sync Shopify customers             | Shopify      | Imports the shop's customers into the organization's contact records          |
| Sync Shopify products              | Shopify      | Imports the shop's product catalog into the organization's product records    |
| Analyze product relationships      | —            | Scans the product catalog and records accessories, variants, and complements  |
| Index documents for retrieval      | —            | Indexes newly uploaded documents so agents can search and cite them           |
| Archive idle conversations         | —            | Closes out conversations that sat quiet past their idle window                |
| Notify members on inbound messages | —            | Alerts members the moment a new inbound message lands in an open conversation |

## The pre-installed packs

The plumbing that runs every organization's boards ships as automations too — installed automatically at creation, hidden from the catalog, and visible on the **Installed** tab like anything else. The **task pack** runs an assigned agent the moment a task lands on it, triages unassigned work, reacts to @-mentions, routes finished work through review, sweeps stale runs, enforces SLAs, and keeps dependent tasks, subtasks, and archives moving; its sibling keeps OneDrive files synced. Each is a normal automation — open one to read its document on the canvas, follow what it did in its [run list](/platform/automations/execution-logs), or switch off a [trigger](/platform/automations/triggers) to stop it firing; an uninstall sticks and is never re-installed behind your back.

## Where this fits

The inbox automations, the Resolve GitHub issues bundle, and the sync templates are what ships today; a private automation your organization builds or uploads shows up in the same catalog next to them. [Browse and install](/platform/automations/catalog) covers the catalog mechanics; [Project Backlog](/platform/projects/backlog) is the next read for what happens to a task after Triage proposes it.
