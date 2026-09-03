---
title: Knowledge entries
description: Knowledge entries are small, topic-keyed facts in the knowledge base — added by hand or through the API — with one live version per topic and full version history.
---

Knowledge entries are the knowledge base's fact surface. Where a document carries a whole file, an entry carries one small, durable fact — "the store opens at 9", "the return window is 3 days" — keyed by a topic name. Entries ride the same indexing pipeline as documents, so every agent whose scope covers them retrieves and cites them like any other source; what makes them special is how they get in and how corrections replace what they correct.

<Frame caption="The Knowledge entries tab — topic, content, source, and indexing status per fact.">

![The Knowledge entries tab listing three manually added facts, each showing a Manual source tag and an Indexed status badge.](/images/platform/knowledge-entries-list.webp)

</Frame>

## Where entries come from

**Not from chat.** The earlier version let an agent propose a fact from a conversation as a **Save to knowledge base** card for you to approve. That card does not exist in this version: the chat assistant has no write tool and proposes nothing to save, so no agent writes into the organization's shared knowledge at all. An entry whose **Source** reads **Chat** was captured by the earlier version; new entries arrive by hand or through the REST API's knowledge-entries endpoint.

<Note>

There is no per-agent knowledge-write switch to turn on. A fact gets into the knowledge base because a person typed it or a program posted it through the API — never because a model decided to remember it.

</Note>

**Manually.** Click **Add entry** on **Knowledge > Knowledge entries**. Give it a **Topic** (up to 120 characters — short and stable, like a heading) and the **Content** as markdown (up to 8000 characters), written so it makes sense without any surrounding conversation. The **Source** column keeps the two origins apart: **Chat** or **Manual**.

## One live version per topic

Topics are the dedup key: an edit replaces the live version rather than adding a second one — the knowledge base never serves two versions of the same fact. Adding a new entry under an existing topic is refused with a duplicate-topic error; edit the existing entry instead.

Replaced versions are not lost. Open an entry to see its details — indexing status, last update, and the **Version history** with every superseded version and when it was replaced. Only the live version is indexed for retrieval; the history exists for audit and reference.

## Editing, indexing, deleting

Editing creates a new live version and re-indexes in the background — the **Status** badge dips to indexing and returns to **Indexed** when search picks up the new text. Deleting removes the whole entry: the confirmation warns that it also disappears from the knowledge base, so agents can no longer find it, and that the action cannot be undone. If the fact was right, add it again.

## Where this fits

Knowledge entries are the knowledge base's smallest unit: a fact written down once becomes something every lane retrieves, with one live version per topic guaranteeing the old fact disappears when the new one lands. For the file-shaped half read [Documents](/platform/knowledge/documents); for how agents bind and retrieve, read [Agent knowledge](/platform/agents/knowledge).
