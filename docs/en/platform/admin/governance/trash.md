---
title: Trash
description: Find recoverable records, understand their status, and restore them before permanent deletion.
---

Use **Settings > Governance > Trash** as an Admin or Owner to recover records that are still stored after soft deletion. Permanent deletion cannot be undone here, and not every deletion in Tale goes through Trash.

## Restore a record

1. Open Trash and use **Filter > Category** to narrow the list, or leave it unfiltered to see all supported types.
2. Check the record's name, owner, type, and deletion time. These help distinguish records with similar names. A chat is listed under its title; the answer discarded in an [Arena](/platform/chat/arena-mode) comparison keeps the title of its conversation.
3. Select **Restore** on the row and review the confirmation.
4. For a retention-expired record, type `restore` exactly. Confirm the action, then look for the record in its original location: for example, its chat list or Knowledge.

The restored row disappears from Trash. Tale records the restoration in the audit log. If the row is no longer available, refresh the list: cleanup may already have permanently removed it.

## Understand the status

| Status | Meaning |
| --- | --- |
| **Trashed** | The record was soft-deleted and is still available for restoration. |
| **Expired** | Retention policy expired the record. Restoring it overrides that policy, so confirmation requires the word `restore`. |

**Expired** does not mean the recovery window has already ended. Retention marks records expired when their grace window starts; permanent cleanup follows once that window elapses.

The category filter lists the record types that pass through Trash: chats, documents, temporary files, message feedback, contacts, and external conversations. A chat's earlier versions travel with it: they are trashed and restored together with the chat and never appear as rows of their own. Other data, such as automation runs, usage records, audit records, and chat-filter events, is deleted directly or as part of a parent record's cleanup and has no restore action here.

## Check the recovery window

The organization's retention policy sets the grace period. With a positive grace period, supported expired records remain recoverable until cleanup removes them. A grace of zero allows immediate permanent cleanup. Check the active policy under [Policies and limits](/platform/admin/governance/policies-and-limits) instead of relying on an assumed number of days.

An empty Trash means there are no recoverable records in the current view. It does not prove that nothing has ever been deleted. Clear category filters before concluding a record is absent.

Trash never shows a failed read as empty. If the list cannot be loaded, an alert takes the table's place and offers **Try again**, instead of the empty state. If records are listed but the next ones or a refresh cannot be loaded, a notice above the list says so and offers **Try again**, and the count under the list no longer claims to show all records.

## Account for legal holds

A [legal hold](/platform/admin/governance/legal-hold) prevents covered data from being deleted by retention or erasure. It preserves data that still exists; it cannot recover data already permanently deleted. Check the hold and retention history when investigating why an expected record did or did not enter Trash.
