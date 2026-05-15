---
title: Prompt library
description: Save, browse, and share reusable prompt templates across your organization.
---

The Prompt library is a shared collection of reusable prompt templates. Save the prompts the team uses often, organise them by category and tags, and share them at the right scope (personal, team, or organisation-wide). Every edit is captured in version history so you can compare and roll back without losing work.

This page covers the runtime — browsing, creating, scoping, versioning, restoring. The audience is any role in the product; visibility scopes determine what each role sees. The library is accessible from the composer toolbar in every chat.

## Browsing prompts

Open the Prompt Library from the chat input toolbar. The library dialog shows all prompts you have access to.

- **Search** filters across title, description, content, category, and tags.
- **Tabs** filter by scope: All, Global, Team, or Personal.
- **Category** and **tag** popovers narrow the visible rows by facets derived from the loaded page. If a filter zeros out the current page but more pages exist, the empty state offers **Load more** so you can keep searching, plus **Clear filters** to reset.
- Each row shows the title, content preview, scope badge, category, tags, and current version (e.g. `v3` when there is history).

Click **Use** on any row to insert its content into the chat input.

## Creating a prompt

1. Open the Prompt Library and click the **plus** icon.
2. Fill in the form:

   | Field           | Required    | Description                                           |
   | --------------- | ----------- | ----------------------------------------------------- |
   | **Title**       | Yes         | A short name for the prompt                           |
   | **Content**     | Yes         | The prompt text. Displayed in a monospace font        |
   | **Description** | No          | Brief explanation of what the prompt does             |
   | **Visibility**  | Yes         | Who can see this prompt (see [Scopes](#scopes) below) |
   | **Team**        | Conditional | Required when visibility is set to Team               |
   | **Category**    | No          | A label like "writing", "analysis", or "coding"       |
   | **Tags**        | No          | Comma-separated keywords for search and organization  |

3. Click **Create**.

### Tag input

The **Tags** field is a chip input. Press **Enter** or type a **comma** to commit a tag; **Backspace** on an empty input removes the last chip; the **×** on a chip removes it. Duplicate tags are silently collapsed case-insensitively (`Foo` and `foo` resolve to one). The counter below the input turns destructive when you hit the cap (see [Limits](#limits)).

## Saving a message as a prompt

You can save any chat message as a prompt template directly from the conversation:

1. Open the message menu and select **Save as prompt**.
2. The message content is pre-filled. Add a title and optional description.
3. The prompt is saved as a **Personal** scope template and published immediately.

This is a quick way to capture effective prompts without leaving the chat.

## Scopes

Prompts have three visibility levels:

| Scope        | Who can see it               | Badge color |
| ------------ | ---------------------------- | ----------- |
| **Personal** | Only you                     | Blue        |
| **Team**     | Members of the selected team | Orange      |
| **Global**   | Everyone in the organization | Green       |

Unpublished prompts are only visible to their creator regardless of scope.

## Editing and deleting

Only the prompt creator or an Admin can edit or delete a prompt. Use the kebab menu on a row to access these actions.

Deleting a prompt is permanent and cannot be undone.

## Version history

Every save creates a new version. Open the kebab menu on a row and choose **Version history** to see all past versions of that prompt. The dialog lists each version with its publish date and author. Prompts that haven't been edited since versioning shipped don't have a History dialog yet — make your first edit to create v2, and the menu item becomes available with v1 preserved as the prior state.

### Comparing versions

Press **Enter** on a version (or click **Compare with current**) to open the side-by-side diff. The diff is line-level, optimised for prose:

- Lines marked `−` are in the current content but not in the snapshot you are comparing.
- Lines marked `+` are in the snapshot. These are what **Restore** would bring back.
- Metadata changes (title, description, category, tags, scope) appear above the content diff with the before/after value.

Screen reader users hear each added/removed line announced with an explicit prefix.

### Restoring a version

Press **R** or **Shift+Enter** on a version (or click **Restore** in the compare view) to roll the prompt back to that snapshot. Restoring is **reversible** — it creates a new version v(current + 1) carrying the snapshot's content and metadata; the previous current version stays in history so you can restore it later if needed.

If someone else has saved a new version while your history dialog was open, restore fails with **Version history changed — refresh to retry**. Close and reopen the dialog to see the latest state before trying again.

### Keyboard shortcuts in the history dialog

| Key                     | Action                                       |
| ----------------------- | -------------------------------------------- |
| **↑ / ↓**               | Move between versions                        |
| **Home / End**          | Jump to the newest / oldest version          |
| **Enter**               | Open the compare view for the focused row    |
| **R** / **Shift+Enter** | Restore the focused version                  |
| **Esc**                 | Close the dialog (or close the compare view) |

## Concurrent edits

If you open a prompt for editing while someone else publishes a new version, the form shows a banner: **Newer version available**. Click **Load latest** to re-anchor the form on the latest snapshot before saving — your unsaved edits will be discarded, so the warning escalates to destructive when the form is dirty.

## Limits

Per-prompt caps (server-enforced, mirrored client-side):

| Field        | Cap                                |
| ------------ | ---------------------------------- |
| Content      | 16 KiB (UTF-8)                     |
| Title        | 200 characters                     |
| Description  | 2 000 characters                   |
| Category     | 100 characters                     |
| Tag (each)   | 50 characters                      |
| Tags (count) | 20 per prompt                      |
| History      | 12 versions (oldest drops on save) |

When history hits the cap, the oldest version is dropped (FIFO) and an audit entry **history truncated** is emitted.

## Rate limits

Mutations on prompts are rate-limited per user to keep bulk operations friendly. If you hit a limit, a toast reads **Saving too quickly — wait a moment before trying again** and the action retries cleanly once the window resets.

## Usage tracking

Each prompt tracks how many times it has been used. The usage count is displayed on the prompt card and updates each time someone inserts the prompt into a conversation.

## Where this fits

The Prompt library is the reusable-text surface for the chat composer. It exists for the same reason version control exists: the prompt you wrote last week, the one that finally got the right answer, should be saved once and reachable from every conversation — not pasted from a chat history search. Personal scopes are for drafts; team scopes are for shared workflows; organisation-wide scopes are for canonical templates the whole company should reach for.

For prompts that change the AI's behaviour permanently rather than just framing one message, edit the agent's instructions at [Create an agent](/platform/agents/create) — the instructions are the prompt that runs before _every_ message in an agent's conversation, where a library prompt is the body of one message.
