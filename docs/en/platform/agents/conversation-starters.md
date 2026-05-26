---
title: Conversation starters
description: Authoring the example prompts an agent shows on its empty-chat screen — adding, translating, and the auto-translate option.
---

A **Starter** is a short example prompt the agent shows on an empty chat screen. Tap one and the text drops into the composer; the user edits if they want, then sends. Starters are the agent author's curated entry points into what the agent is for.

This page is the author side. The user side — how starters render in a fresh chat — is on [Starters and prompts](/platform/chat/starters-and-prompts).

## Adding a starter

Open the agent and switch to the **Starters** tab. **Add starter** opens an editor with two fields: the starter title (what the user sees as a tile on the empty chat) and the body (what drops into the composer when the user taps the tile). Save and the starter appears in any fresh chat picked with this agent.

## Defaults and translations

Each starter has a **default** version (the EN body) and an optional translated version per locale. The default is what shows when no translation exists for the user's locale. Untranslated starters are flagged with **untranslated** in the author's view; users in those locales see the default.

## Auto-translate

The Starters tab exposes an **Auto-translate** action that calls the org's translation provider to fill in missing locales. The translations are saved as editable strings — the author can adjust afterwards. Auto-translate respects the org's translation provider configuration; unconfigured providers fail with a toast.

## Where this fits

Conversation starters are the smallest surface in the agent area — a few sentences each, but they decide whether the empty chat screen looks inviting or blank. The page worth pairing this with is [Starters and prompts](/platform/chat/starters-and-prompts), which shows how they render to the user; the rest of the agent's behaviour lives in [Agent concepts](/platform/agents/concepts).
