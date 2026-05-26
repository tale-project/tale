---
title: Prompt library
description: The Prompt library is where you save chat prompts for reuse — personal, team, or org-wide. Members, Editors, and Developers read this when they keep a recurring chat starter handy.
---

The Prompt library is the saved-prompts surface of Tale. It is where you keep the chat starters you reach for more than once — a writing-voice prompt you reuse for every customer email draft, a debugging prompt your team passes around, a research prompt the whole org should agree on. Every role above Disabled can save and use prompts; the **visibility** lever on each prompt decides who else sees it.

This page is the reference for what a prompt is, how the three visibility levels behave, how the version history works, and how prompts get into a chat. The library lives under **Prompts** in the sidebar; the same library surfaces inline in the chat composer.

## What a prompt is

A prompt is a saved chunk of text — usually a question or an instruction you would otherwise type into the composer — with a title and a few metadata fields. When you reach for a saved prompt in chat, Tale pastes its content into the composer; you can edit before sending, the prompt is not a hidden system message.

Each prompt carries:

- A **title** (used in the picker; auto-generated from the content if you leave it blank).
- The **content** (the actual prompt text).
- A **visibility** — `Personal`, `Team`, or `Global`.
- An optional **team** binding (when visibility is `Team`).
- Optional **tags** for filtering.

The library is searchable by title and content, filterable by visibility and tag, and sortable by recency. The composer's inline picker is the same library with the same filters.

## The three visibility levels

**Personal** is your-eyes-only. A personal prompt appears in your own library and nowhere else; nobody in the org can see it. Reach for personal when the prompt is shaped to your own workflow and the rest of the team would not benefit.

**Team** is shared with one team. Pick the team on save; every member of that team sees the prompt in their library. Reach for team when the prompt is shaped to a specific function — the support team's reply-tone prompt, the engineering team's bug-triage prompt — and the rest of the org would not benefit.

**Global** is org-wide. Every member of the org sees the prompt in their library. Reach for global when the prompt encodes a decision the whole org should make the same way — the writing voice the brand expects, the question template every researcher should start from.

Visibility is settable on save and editable later. Promoting a personal prompt to global takes one click and triggers no migration on the chats that already used it — old chats keep their pasted content, the new visibility affects only the library entry.

## Versioning

Saving a prompt over an existing entry creates a new version. The version history is reachable from the prompt's row; each version records the editor, the timestamp, and the content diff. You can roll back to any prior version with one click.

The version history is the place to look when a teammate edited a global prompt and the new content does not work for your use case. Roll back at the library level if everyone should revert; copy the older version into a personal prompt if only you want the old behaviour.

## Using a prompt in chat

The chat composer has a prompt picker at its base. Open it, search or filter to find the prompt you want, and click it to paste the content into the composer. The prompt is now your message — edit it, attach files, add context, send. Once sent, the prompt acts the way any composer input does; Tale does not track which chats used which prompts.

Some prompts contain template variables — placeholders like `{{customer_name}}` or `{{topic}}`. The picker prompts you for each variable before pasting; the resulting content is the prompt with the placeholders filled in. Variables are declared in the prompt's content with the `{{variable_name}}` syntax.

## Limits and lifecycle

A prompt's content has a size limit — the library form shows the current usage against the maximum, and the Save button is disabled if you exceed it. The limit is generous enough for most prompts to fit; if you hit it, the right answer is usually that the prompt is two prompts.

Deleting a prompt is reversible only through the version history if you saved it once before. Personal prompts are deleted permanently on account deletion; team prompts survive team reorganisation unless the team is deleted; global prompts survive everything except an explicit delete.

## Where this fits

The prompt library is the lightest available form of reuse in Tale — lighter than an agent (which carries instructions, knowledge, and tools), lighter than a skill (which packages instructions and a script). Reach for a prompt when the reuse is just the text; reach for an agent when the reuse is a configured behaviour. The natural next read is [Starters and prompts](/platform/chat/starters-and-prompts) for how prompts surface in the chat composer alongside an agent's own starters.
