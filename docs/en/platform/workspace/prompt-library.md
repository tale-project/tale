---
title: Prompt library
description: Save, browse, and share reusable prompt templates across the organisation, with version history, scoped visibility, and one-click insertion.
---

The Prompt library is a shared collection of reusable prompt templates. Save the prompts the team uses often, organise them by category and tags, and share them at the right scope — personal drafts, team-wide playbooks, or organisation-wide canonical templates. Every edit is captured in version history, so comparing two versions and rolling back a bad save take seconds instead of an afternoon.

The library is reachable from the composer toolbar in every chat. The audience is anyone in the product; visibility scopes decide what each role sees.

## Browse prompts

Open the library from the chat input toolbar — the dialog lists every prompt you have access to. Search filters across title, description, content, category, and tags. Four tabs filter by scope: **All**, **Global**, **Team**, **Personal**. Category and tag popovers narrow the visible rows by facets derived from the loaded page; if a filter zeros out the current page but more pages exist, the empty state offers **Load more** to keep searching plus **Clear filters** to reset. Each row shows the title, a content preview, a scope badge, the category, the tags, and the current version (for example `v3` when there's history).

Click **Use** on a row to insert its content into the chat input.

## Create a prompt

To create a prompt, open the library and click the plus icon. The form asks for seven fields, three of them required:

| Field           | Required    | What goes in                                          |
| --------------- | ----------- | ----------------------------------------------------- |
| **Title**       | Yes         | A short name for the prompt.                          |
| **Content**     | Yes         | The prompt text. Displayed in a monospace font.       |
| **Description** | No          | A brief explanation of what the prompt does.          |
| **Visibility**  | Yes         | Who can see this prompt — Global, Team, or Personal.  |
| **Team**        | Conditional | Required when **Visibility** is set to Team.          |
| **Category**    | No          | A label like `writing`, `analysis`, or `coding`.      |
| **Tags**        | No          | Comma-separated keywords for search and organisation. |

Click **Create**. The new prompt lands in the library at v1.

### Tag input

The tags field is a chip input. Press **Enter** or type a comma to commit a tag; **Backspace** on an empty input removes the last chip; the × on a chip removes it. Duplicate tags are silently collapsed case-insensitively (`Foo` and `foo` resolve to one). The counter below the input turns destructive when you hit the cap.

## Save a chat message as a prompt

To capture a message you've already sent, open the message menu in the conversation and pick **Save as prompt**. The message content is pre-filled — add a title and an optional description, then save. The new prompt lands in the Personal scope and is published immediately.

## Scopes

Three visibility levels govern who can see a prompt:

| Scope        | Who can see it                | Badge colour |
| ------------ | ----------------------------- | ------------ |
| **Personal** | Only you.                     | Blue.        |
| **Team**     | Members of the selected team. | Orange.      |
| **Global**   | Everyone in the organisation. | Green.       |

Unpublished prompts are visible only to their creator regardless of scope.

## Edit and delete

Only the prompt creator or an Admin can edit or delete a prompt. Use the kebab menu on a row to reach these actions. Deleting a prompt is permanent and cannot be undone.

## Version history

Every save creates a new version. To browse the history, open the kebab menu on a row and pick **Version history** — the dialog lists each version with its publish date and author. Prompts that haven't been edited since versioning shipped don't have a History dialog yet; make your first edit to create v2, and the menu item becomes available with v1 preserved as the prior state.

### Compare two versions

Press **Enter** on a version (or click **Compare with current**) to open a side-by-side diff. The diff is line-level, optimised for prose. Lines marked `−` are in the current content but not in the snapshot you're comparing; lines marked `+` are in the snapshot — these are what **Restore** would bring back. Metadata changes (title, description, category, tags, scope) appear above the content diff with the before/after value. Screen-reader users hear each added or removed line announced with an explicit prefix.

### Restore a version

Press **R** or **Shift+Enter** on a version (or click **Restore** in the compare view) to roll the prompt back to that snapshot. Restoring is reversible — it creates a new version v(current + 1) carrying the snapshot's content and metadata; the previous current version stays in history so you can restore it later if needed.

If someone else has saved a new version while your history dialog was open, restore fails with **Version history changed — refresh to retry**. Close and reopen the dialog to see the latest state before trying again.

### Keyboard shortcuts inside the history dialog

| Key                     | Action                                        |
| ----------------------- | --------------------------------------------- |
| **↑ / ↓**               | Move between versions.                        |
| **Home / End**          | Jump to the newest / oldest version.          |
| **Enter**               | Open the compare view for the focused row.    |
| **R** / **Shift+Enter** | Restore the focused version.                  |
| **Esc**                 | Close the dialog (or close the compare view). |

## Concurrent edits

If you open a prompt for editing while someone else publishes a new version, the form shows a **Newer version available** banner. Click **Load latest** to re-anchor the form on the latest snapshot before saving. Your unsaved edits will be discarded, so the warning escalates to destructive when the form is dirty.

## Limits

The per-prompt caps are enforced server-side and mirrored client-side:

| Field        | Cap                                 |
| ------------ | ----------------------------------- |
| Content      | 16 KiB (UTF-8).                     |
| Title        | 200 characters.                     |
| Description  | 2 000 characters.                   |
| Category     | 100 characters.                     |
| Tag (each)   | 50 characters.                      |
| Tags (count) | 20 per prompt.                      |
| History      | 12 versions (oldest drops on save). |

When history hits the cap, the oldest version drops (FIFO) and an audit entry **history truncated** is emitted.

## Rate limits

Mutations on prompts are rate-limited per user to keep bulk operations friendly. If you hit a limit, a toast reads **Saving too quickly — wait a moment before trying again** and the action retries cleanly once the window resets.

## Usage tracking

Each prompt tracks how many times it has been inserted. The usage count appears on the prompt card and updates each time someone picks the prompt for a conversation — a useful signal for spotting templates that quietly carry the team and templates that turned out to be one-offs.

## Where this fits

The Prompt library is the reusable-text surface for the chat composer. It exists for the same reason version control exists: the prompt you wrote last week, the one that finally got the right answer, should be saved once and reachable from every conversation — not pasted from a chat-history search. Personal scopes are for drafts; team scopes are for shared playbooks; organisation-wide scopes are for canonical templates the whole company should reach for.

For prompts that change the AI's behaviour permanently rather than only framing one message, edit the agent's instructions at [Create an agent](/platform/agents/create) — the instructions are the prompt that runs before _every_ message in an agent's conversation, where a library prompt is the body of one message.
