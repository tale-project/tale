---
title: Conversations
description: The shared customer inbox — email and chat threads land here, the team replies, and the AI helps with drafts and triage.
---

Conversations is the shared inbox for customer-facing channels. When a message arrives through a connected channel — an email mailbox today, more channels later — it shows up here as a thread; the team reads, replies, closes, and audits without leaving the platform. The page is for Editors who handle inbound traffic and for Admins configuring the channel connections; Members see the inbox in read-only mode if their role permits.

This page covers the runtime: connecting a channel, the conversation lifecycle, the reply composer, bulk actions, and filtering. The AI side — how an agent drafts a reply, when an approval card appears — sits inside the agent build flow at [Create an agent](/platform/agents/create).

## Connect an email channel

To make a mailbox feed into the inbox, an Admin or Developer adds it once under **Settings > Integrations**. The connection is not a `rest_api` connector — it has its own configuration surface tuned for IMAP+SMTP. To add the channel, open **Settings > Integrations**, scroll to the **Email** section, and fill in:

| Field           | What goes in                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------- |
| Display name    | The name shown on conversations originating from this mailbox.                                |
| Inbound (IMAP)  | Hostname, port, encryption (`SSL/TLS`, `STARTTLS`, or `None`), username, password.            |
| Outbound (SMTP) | Hostname, port, encryption, username, password (often the same credentials as IMAP).          |
| From address    | The email address replies are sent from. Must match what the SMTP server accepts as a sender. |
| Sync interval   | How often Tale polls for new mail (defaults to one minute).                                   |

After saving, Tale pulls the inbox on the configured interval. Inbound emails become Conversations threads — each unique reply-chain is one thread; replies sent from the platform go out as normal emails through SMTP and thread back into the customer's mail client via standard `In-Reply-To` headers. The mailbox stays linked until the integration is removed; deleting it stops sync but preserves the threads already in the inbox.

For OAuth-style email providers (Microsoft 365, Gmail), use the dedicated OAuth flow inside the integration instead of password credentials — IMAP password auth is disabled on those providers by default.

## Conversation statuses

Every thread carries one of four statuses, settable from the conversation header or via bulk actions:

| Status   | Meaning                                                             |
| -------- | ------------------------------------------------------------------- |
| Open     | Active thread that needs a response or is in progress.              |
| Closed   | Resolved and marked as done. Closed threads stay searchable.        |
| Spam     | Flagged as unsolicited or irrelevant. Hidden from the default list. |
| Archived | Kept for reference but removed from the active inbox.               |

A new inbound message on a Closed or Archived thread automatically re-opens it.

## Reply to a conversation

To reply, open the conversation from the list — the composer loads at the bottom of the right panel. The composer is a rich-text editor with bold, italic, lists, links, and code-block formatting. To attach a file (logo, screenshot, document), click the paperclip in the toolbar and pick it from the device. To have the AI tighten the draft before it goes out, click **AI Improve** if the agent has it enabled; the AI rewrites the draft in place and you can edit afterwards.

Click **Send** to deliver the message through whichever channel the customer used originally. Replies thread automatically — the customer sees one continuous conversation in their mail client, not a separate message each time.

## Bulk actions

To act on many threads at once, tick the checkboxes in the conversation list. The available bulk actions:

- **Change status** — close, reopen, archive, or mark as spam.
- **Send a message** — broadcast a single reply to every participant of the selected threads.

Bulk actions are audited at the same depth as single-thread actions; every change records the actor and timestamp in the [Audit log](/platform/admin/governance).

## Filter and search

The filter dropdown in the toolbar narrows the list by status, by assignee, by read/unread, and by date. The keyboard shortcut `Ctrl + K` (or `Cmd + K` on macOS) opens search across every thread — subject, body, and customer email are indexed.

## Where this fits

Conversations is Tale's customer inbox. It exists because customer reply work doesn't fit inside chat with AI: replies need a human in the loop, a single thread per customer across channels, and a record reviewers can audit. The agent that handles the AI side is the same agent the rest of the workspace uses — what changes is the surface.

To configure which conversations get auto-drafted replies, open the agent at [Create an agent](/platform/agents/create) and set up the conversation-handling tool. For approvals that fall out of customer threads (a draft reply waiting for review, an integration call waiting for a green light), [Approvals](/platform/workspace/approvals) is the surface.
