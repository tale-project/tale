---
title: Knowledge entries
description: Knowledge entries are small, topic-keyed facts in the knowledge base — captured from chat with human approval or added by hand — with one live version per topic and full version history.
---

Knowledge entries are the knowledge base's fact surface. Where a document carries a whole file, an entry carries one small, durable fact — "the store opens at 9", "the return window is 3 days" — keyed by a topic name. Entries ride the same indexing pipeline as documents, so every agent whose scope covers them retrieves and cites them like any other source; what makes them special is how they get in and how corrections replace what they correct.

<Frame caption="The Knowledge entries tab — topic, content, source, and indexing status per fact.">

![The Knowledge entries tab listing three manually added facts, each showing a Manual source tag and an Indexed status badge.](/images/platform/knowledge-entries-list.webp)

</Frame>

## Where entries come from

**From chat, with your approval.** Agents with the knowledge-write tool enabled can propose saving a fact you stated or corrected during a chat. The proposal appears as a card in the chat — **Save to knowledge base**, with the topic and the full content; when the topic already exists the card becomes **Update knowledge base** and warns that approving will replace the existing entry. Nothing lands until you click **Approve**; **Reject** discards it.

<Note>

The tool is off by default — enable it per agent in the agent's tool settings. An agent can never write into the org's shared knowledge without a human signing off on the exact text.

</Note>

**Manually.** Click **Add entry** on **Knowledge > Knowledge entries**. Give it a **Topic** (up to 120 characters — short and stable, like a heading) and the **Content** as markdown (up to 8000 characters), written so it makes sense without any surrounding conversation. The **Source** column keeps the two origins apart: **Chat** or **Manual**.

## One live version per topic

Topics are the dedup key: an approved chat proposal for an existing topic, or an edit, replaces the live version rather than adding a second one — the knowledge base never serves two versions of the same fact. Adding a new entry under an existing topic is refused with a duplicate-topic error; edit the existing entry instead.

Replaced versions are not lost. Open an entry to see its details — indexing status, last update, and the **Version history** with every superseded version and when it was replaced. Only the live version is indexed for retrieval; the history exists for audit and reference.

## Editing, indexing, deleting

Editing creates a new live version and re-indexes in the background — the **Status** badge dips to indexing and returns to **Indexed** when search picks up the new text. Deleting removes the whole entry: the confirmation warns that it also disappears from the knowledge base, so agents can no longer find it, and that the action cannot be undone. If the fact was right, add it again.

## Where this fits

Knowledge entries close the loop between conversations and the knowledge base: a correction made once in chat becomes a fact every agent retrieves, with a human approving the exact wording and one live version per topic guaranteeing the old fact disappears when the new one lands. For the file-shaped half read [Documents](/platform/knowledge/documents); for how agents bind and retrieve, read [Agent knowledge](/platform/agents/knowledge).
