---
title: Knowledge entries
description: Knowledge entries are small, topic-keyed facts that users contribute to the knowledge base — captured from chat with approval or added manually. This page covers where entries come from, the one-live-version-per-topic rule, and how to manage them.
---

Knowledge entries are the knowledge base's fact surface. Where a document carries a whole file, a knowledge entry carries one small, durable fact — "the store opens at 9", "the return window is 3 days" — keyed by a topic name. Entries come from two places: an agent can propose one during a chat when you confirm or correct information (you approve it on a card before anything is saved), and Editors can add one manually from the **Knowledge entries** tab. Either way, the entry lands in the same indexing pipeline as a document, so every agent that searches the knowledge base can retrieve and cite it.

This page covers the management side: where entries come from, the one-live-version-per-topic rule that keeps corrections from coexisting with the facts they corrected, and how to add, edit, and delete entries.

## Where entries come from

**From chat, with your approval.** Agents with the `knowledge_write` tool enabled can propose saving a fact you stated or corrected during a conversation. The proposal shows up as an approval card in the chat with the topic, the full content, and — when the topic already exists — a notice that approving will replace the current entry. Nothing reaches the knowledge base until you click **Approve**; **Reject** discards the proposal. The tool is off by default — enable it per agent in the agent's tool settings under the Documents group. This is deliberate: an agent can never write into the org's shared knowledge without a human signing off on the exact text.

**Manually.** To add an entry by hand, open **Knowledge > Knowledge entries** and click **Add entry**. Give it a topic (up to 120 characters — short and stable, like a heading) and the content as markdown (up to 8000 characters), written so it makes sense without any surrounding conversation. Manual entries skip the approval card — you are the human in the loop.

## One live version per topic

Topics are the dedup key. Writing to a topic that already has an entry — whether from chat or by editing — replaces the live version instead of adding a second one, so the knowledge base never serves two versions of the same fact. Topic matching ignores case and extra whitespace: "Store Hours" and "store hours" are the same topic.

Replaced versions are not lost. Each entry keeps its version history — click a row to open the entry and expand any superseded version to see what it said and when it was replaced. Only the live version is indexed for retrieval; superseded versions exist for audit and reference only.

## How entries reach agents

Behind each entry sits a small markdown document in the documents hub, inside the reserved **Knowledge entries** folder. That backing document rides the exact same indexing pipeline as an uploaded file — extract, chunk, embed, store — which is why the entry list shows the familiar indexing status badge per row. A freshly saved entry shows `Indexing` briefly; once it flips to `Indexed`, agents whose knowledge scope includes the backing document retrieve and cite it like any other source.

Because the backing document is a regular document, agent binding works unchanged: an agent scoped to the whole library sees every entry, and an agent scoped to specific folders sees entries only if the Knowledge entries folder is in scope. Entries are org-wide — there is no per-team scoping on entries themselves in this version.

## Editing and deleting

To edit an entry, open its row menu and click **Edit**. Saving creates a new live version and moves the previous one into the version history; the backing document is re-indexed in the background, so search results pick up the new text once the status badge returns to `Indexed`. Renaming the topic carries the version history along.

To delete an entry, open its row menu and click **Delete**. Deletion removes the whole entry — live version, history, the backing document, and the indexed chunks — so agents can no longer find the fact. There is no undo; if the fact was right, add it again. Deleting the backing document from the Documents tab has the same effect: the entry is removed too, so the two views never disagree.

## Where this fits

Knowledge entries close the loop between conversations and the knowledge base: a correction made once in chat becomes a fact every agent retrieves, with a human approving the exact wording and one live version per topic guaranteeing the old fact disappears when the new one lands. For the file-shaped half of the knowledge base read [Documents](/platform/knowledge/documents); for how an agent binds to knowledge and retrieves over it at reply time, read [Agent knowledge](/platform/agents/knowledge).
