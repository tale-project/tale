---
title: Conversation starters
description: Authoring the suggested prompts an agent shows on its empty-chat screen — adding, ordering, translating, and the auto-translate action.
---

A starter is a short suggested prompt the agent shows on an empty chat screen. Tap one and the text drops into the composer; the user edits if they want, then sends. Starters are the agent author's curated entry points into what the agent is for — this page is the author side; how they render to the user is [Starters and prompts](/platform/chat/starters-and-prompts).

<Frame caption="The Starters tab — an ordered list of prompts with locale tabs above.">

![The agent editor's Starters tab showing four English conversation starters with drag handles, reorder arrows, and remove buttons.](/images/platform/agent-editor-starters.webp)

</Frame>

## Add and order starters

Open the agent and switch to the **Starters** tab. Each starter is one prompt of up to 200 characters; **Add starter** appends a row, up to four per agent — leave the list empty to show no suggestions. Order matters because it is the order users see: drag a row's handle or use the arrows to move it, and remove one with the × on its row. Click **Save** — starters ship with the agent's configuration like every other setting.

Write starters the way a user would actually ask: concrete, first person, inside the agent's domain. Four vague prompts read worse than two sharp ones.

## Translate them

Each starter has a default version (the tab marked **default**) and an optional translation per locale. A locale tab still missing its version is flagged **untranslated**, and users in that locale see the default text. Switch to a locale tab to type translations by hand — translations override the existing rows; the list itself (count and order) is owned by the default locale.

**Auto-translate** on a locale tab fills in the missing versions in one step. The results are saved as ordinary editable strings, so adjust them afterwards where the machine phrasing misses your voice; if translation fails, a toast says so and the defaults stay in place.

## Where this fits

Conversation starters are the smallest surface in the agent area — a few sentences each, but they decide whether the empty chat screen looks inviting or blank. The page worth pairing this with is [Starters and prompts](/platform/chat/starters-and-prompts), which shows how they render to the user; the rest of the agent's behaviour lives in [Agent concepts](/platform/agents/concepts).
