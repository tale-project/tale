---
title: Trash
description: The soft-delete recovery view for retention-trashed records — chat threads, documents, prompts, workflow runs — before they are permanently deleted at the end of the grace window. Admins and Owners read this when someone needs a deleted artefact back.
---

Trash is the recovery surface for the rows retention has soft-deleted but not yet hard-deleted. When a chat thread, a document, a prompt template, or a workflow run exceeds its retention window, it moves here for the configured grace window before the next cleanup pass removes it for good. Admins and Owners read this page when a member asks for a deleted artefact back, when a workflow deleted the wrong thing, or when an audit needs to know whether a row is still recoverable.

## A worked restore

To restore a chat history thread, open **Settings > Governance > Trash** and switch the **Category** filter to **Chat history**. Each row carries the type, the name, the owner, the status, and when it was trashed. Click **Restore** on the row, confirm in the dialog, and the row returns to its source list — chat threads reappear in the conversation inbox and documents in the knowledge base. Restoring a retention-expired row requires typing `restore` to confirm and is audited as an override of the retention policy.

## The two statuses

**Trashed** is the normal soft-delete state. The row's retention window elapsed, it moved to trash, and the grace window is still ticking. Restore returns the row to its source list with no policy override. The retention clock restarts at the restore — a restored chat thread, document, or external conversation counts from that moment, so the next cleanup pass leaves it alone instead of expiring it again.

**Expired** is the second state — the grace window ran out and the row is queued for permanent deletion at the next cleanup. Restore is still possible but is an override: the dialog asks you to type `restore` and the audit log records the override with your name.

## The categories

Trash holds rows from many categories. The category filter switches the view per tab:

- Chat history (threads)
- Documents
- Temporary files
- Prompt templates
- Message feedback
- Contacts
- External conversations
- Message metadata
- Automation runs
- Automation trigger logs
- Usage ledger
- Audit logs
- Chat filter events
- Memory audit

Each category honours its own retention window and its own grace window — set on the retention policy in [policies and limits](/platform/admin/governance/policies-and-limits).

## Legal hold interaction

Rows under legal hold do not appear in trash — the hold pins them out of reach of every retention step. When you try to delete a held row from its source list, Tale refuses with a legal-hold error naming the hold. Release the hold to let retention sweep the row through the trash window the way other categories flow.

## The grace window

The grace window is configurable per category on the retention policy. A grace of zero skips trash entirely — the cleanup pass hard-deletes the row immediately when retention triggers. A grace above zero keeps the row in trash for that many days and surfaces it here for the Admin window where restore is still cheap.

## Where this fits

Trash is the second chance retention gives every category before the cleanup pass removes a row for good. It pairs with [policies and limits](/platform/admin/governance/policies-and-limits) — the retention page sets the windows; this page is the recovery view those windows feed. The companion is [legal hold](/platform/admin/governance/legal-hold), which is the only mechanism that beats retention before a row ever lands in trash.
