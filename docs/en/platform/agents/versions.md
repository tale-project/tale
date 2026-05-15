---
title: Agent versions
description: Iterate on a live agent safely using drafts, publishing, and rollback.
---

Agents use draft-and-publish versioning so you can iterate on an agent without affecting the users talking to it right now. The instructions, knowledge filters, tools, and model preset all version together — when you publish, the whole bundle becomes the new live version atomically, and rollback puts the whole bundle back. There is no half-state in production.

The model is identical to how automations version (see [Automation concepts — Draft vs. active](/platform/automations/concepts#draft-vs-active)), so once you have learned one, the other reads the same way.

## Draft vs. live

Every agent has two states at any time:

- **Live version** — the one currently serving requests. This is what users see when they pick the agent in chat and what webhooks and delegations call.
- **Draft version** — your work in progress. Editing an agent's instructions, knowledge, or tools updates the draft. Nothing users see changes until you publish.

The top-right corner of the agent editor shows which version you're viewing — **Draft** or **Live** — and lets you switch between them.

## Publishing a draft

When you're happy with the draft, click **Publish**. Publishing:

1. Records the previous live version in the version history.
2. Makes the draft the new live version.
3. Clears the draft state. Future edits will start a fresh draft.

Any conversation that was mid-reply when you published continues to completion using its original version — nobody sees a mid-turn personality change.

## Version history

The version-history dialog shows every published version of the agent, with the author, publish time, and a brief summary of what changed. For each past version you can:

- **Compare** — diff its instructions against the current live version.
- **Restore** — make it the new draft, which you can then publish.

## Rollback

If a published change causes problems — wrong tone, bad answers, broken tool access — open version history, pick the last known-good version, and click **Restore** then **Publish**. The rollback is immediate for all new conversations.

## File-based agents

Agents defined in `TALE_CONFIG_DIR/agents/*.json` don't use the UI versioning system — their history is whatever your git repository records. See [AI-assisted development](/develop/ai-assisted-development) for the file-based workflow.

## Where this fits

Versioning is the iteration safety net for agents. The decision the page-shape contract asks you to remember: drafts and the published live version coexist, so rewriting an agent's instructions is risk-free as long as you don't publish until the draft proves out. Use the Versions tab for every meaningful change; use rollback when production starts giving worse answers right after a publish.

For the create flow itself — naming, model picker, instructions composer — go back to [Create an agent](/platform/agents/create). For the mental model behind the four knobs you're iterating on, [Agent concepts](/platform/agents/concepts).
