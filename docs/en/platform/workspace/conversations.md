---
title: Conversations
description: The shared customer inbox — email threads land here, the team replies, and the AI helps with drafts, triage, and follow-ups.
---

Conversations is the shared inbox for customer-facing channels. When a message arrives through a connected channel — an email mailbox today, more channels later — it shows up here as a thread; the team reads, replies, closes, and audits without leaving the platform. The page is for Editors who handle inbound traffic and for Admins configuring the channel connections; Members see the inbox in read-only mode when their role permits.

This page covers the runtime: connecting an email channel, the four thread statuses, the reply composer with AI improvement, bulk actions, and filtering. The agent side — how an agent drafts a reply, when an approval card appears — sits inside the agent build flow at [Create an agent](/platform/agents/create).

## Connect an email channel

To make a mailbox feed into the inbox, an Admin or Developer adds it once under **Settings > Integrations**. The empty Conversations page surfaces a **Connect email** button that jumps straight to the integrations tab. The connection is not a generic `rest_api` connector — email has its own configuration surface tuned for IMAP+SMTP credentials and the OAuth flows of major mail providers.

For OAuth-style email providers (Microsoft 365, Gmail), use the dedicated OAuth flow on the provider's integration card — password-based IMAP is disabled on those providers by default. For self-hosted or generic IMAP+SMTP mailboxes, fill in the connection fields directly:

| Field           | What goes in                                                                            |
| --------------- | --------------------------------------------------------------------------------------- |
| Display name    | The name shown on conversations originating from this mailbox.                          |
| Inbound (IMAP)  | Hostname, port, encryption (`SSL/TLS`, `STARTTLS`, or `None`), username, password.      |
| Outbound (SMTP) | Hostname, port, encryption, username, password (often the same credentials as IMAP).    |
| From address    | The address replies are sent from. Must match what the SMTP server accepts as a sender. |
| Sync interval   | How often Tale polls for new mail (defaults to one minute).                             |

After saving, Tale pulls the inbox on the configured interval. Inbound mail becomes Conversations threads — each unique reply-chain is one thread; replies sent from the platform go out as normal emails through SMTP and thread back into the customer's mail client via standard `In-Reply-To` headers. The mailbox stays linked until the integration is removed; deleting it stops sync but preserves the threads already in the inbox.

## Thread statuses

Every thread carries one of four statuses, settable from the conversation header or via bulk actions:

| Status   | Meaning                                                             |
| -------- | ------------------------------------------------------------------- |
| Open     | Active thread that needs a response or is in progress.              |
| Closed   | Resolved and marked as done. Closed threads stay searchable.        |
| Spam     | Flagged as unsolicited or irrelevant. Hidden from the default list. |
| Archived | Kept for reference but removed from the active inbox.               |

A new inbound message on a Closed or Archived thread re-opens it automatically — the customer's follow-up doesn't get lost behind a status flag.

## Reply to a conversation

To reply, open the conversation from the list — the composer loads at the bottom of the right panel. The composer is a rich-text editor with bold, italic, lists, links, and code-block formatting. Click the paperclip icon in the toolbar to attach a logo, screenshot, or document from your device. To have the AI tighten the draft before it goes out, click **Improve with AI** if the agent has it enabled; the AI rewrites the draft in a preview pane and you accept or reject the changes before sending.

Click **Send** to deliver the message through whichever channel the customer used originally. Replies thread automatically — the customer sees one continuous conversation in their mail client, not a separate message each time.

## Bulk actions

To act on many threads at once, tick the checkboxes in the conversation list. The toolbar reveals the available bulk actions: change status (close, reopen, archive, mark as spam), or send a single reply broadcast across every selected thread. Bulk actions are audited at the same depth as single-thread actions; every change records the actor and timestamp in the [Audit log](/platform/admin/governance).

## Filter and search

The filter dropdown in the toolbar narrows the list by read status (all, read, unread). The keyboard shortcut `Ctrl + K` (or `Cmd + K` on macOS) opens search across every thread — subject, body, and customer email are indexed.

## Where this fits

Conversations is Tale's customer inbox. It exists because customer reply work doesn't fit inside chat with AI: replies need a human in the loop, a single thread per customer across channels, and a record reviewers can audit. The agent that handles the AI side is the same agent the rest of the workspace uses — what changes is the surface.

To configure which conversations get auto-drafted replies, open the agent at [Create an agent](/platform/agents/create) and wire the conversation-handling tool. For approvals that fall out of customer threads — a draft reply waiting for review, an integration call waiting for a green light — [Approvals](/platform/workspace/approvals) is the surface.
