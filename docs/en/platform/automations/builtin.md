---
title: Built-in automations
description: What each of the four shipped automations does, the integration it requires, and how the Resolve GitHub issues bundle turns synced issues into merged pull requests.
---

Tale ships automations out of the box: three single-purpose ones that turn a mailbox into a shared inbox, and one bundle that resolves GitHub issues end to end. Editors and Members use whatever an installed automation adds — an Inbox tab, a Backlog entry — without installing anything themselves; installing is an Owner/Admin/Developer action covered on [Browse and install](/platform/automations/catalog). This page names what each one does and the integration it needs connected first.

## Reply to Gmail, Outlook, and email over IMAP

**Reply to Gmail emails**, **Reply to Outlook emails**, and **Reply to emails via SMTP/IMAP** are the same automation three times over, one per mailbox kind: each requires exactly the integration its name says, and each installs the same channel-agnostic **Inbox** builtin view. An organization that receives mail on more than one kind of mailbox installs more than one of these; each Inbox only shows its own mailbox's traffic.

| Automation                    | Requires  | Mailbox                                |
| ----------------------------- | --------- | -------------------------------------- |
| Reply to Gmail emails         | Gmail     | A Gmail mailbox                        |
| Reply to Outlook emails       | Outlook   | A Microsoft Outlook mailbox            |
| Reply to emails via SMTP/IMAP | IMAP/SMTP | Any private mailbox over IMAP and SMTP |

## The Inbox tab

Every one of the three opens on its **Inbox** tab: four sub-tabs — **Open**, **Closed**, **Spam**, **Archived** — each a split view with the conversation list on the left and the selected thread on the right. Opening a conversation fills the right pane with its full message history; until you pick one, the pane reads **Select a conversation to view details**.

The composer sits under the thread on **Open** — replies belong to active conversations, so the other three tabs are read-only. Write in **Type a message** and click **Send**; the reply goes out through the mailbox the conversation arrived on, with the recipient and subject line derived from the thread — there's nothing to address by hand. **Improve** rewrites your draft with AI before you send it.

The thread header carries the status verbs for whichever conversation is selected — **Close conversation** and **Mark as spam** on an open thread, **Reopen conversation** on a closed or archived one, **Not spam** and the destructive **Delete** on spam. Selecting several rows in the list surfaces the same verbs as bulk actions.

## Resolve GitHub issues

**Resolve GitHub issues** is a bundle, not a single automation: installing it runs one aggregated wizard that installs four hidden automations at once, bound to the project you choose, and requires the GitHub integration. Each member does one stage of the loop. **Triage GitHub issues** scores a repository's open issues on a schedule and proposes the actionable ones onto the project's [Backlog](/platform/projects/backlog) — titled `#<number> <title>`, labelled to match GitHub, and left for a human to review. **Sync GitHub issues** closes a task the moment its GitHub issue closes, whether the resolve chain merged the fix or a human closed the issue directly on GitHub — it only closes, never creates or reopens a task. **Create GitHub pull requests** ships the PR Creator agent: once a human Starts a proposed task, it clones the repository, opens or adopts the pull request for the issue, implements the fix, verifies it against the project's own tests, and waits for CI to go green. **Review GitHub pull requests** ships the PR Reviewer agent: it re-tests the PR Creator's branch, confirms CI, and a toolless judge decides mergeability — approved parks the task at **In review** for a human to merge on GitHub; not approved sends it back to the PR Creator with feedback, up to a small rework cap.

A human stays in the loop at two points: starting a proposed task off the Backlog, and merging the pull request on GitHub itself — nothing in the bundle merges on your behalf.

## Where this fits

The three inbox automations and the Resolve GitHub issues bundle are what ships today; a private automation your organization builds or uploads shows up in the same catalog next to them. [Browse and install](/platform/automations/catalog) covers the catalog mechanics; [Project Backlog](/platform/projects/backlog) is the next read for what happens to a task after Triage proposes it.
