---
title: Search your knowledge from an automation
description: Find the passages of your documents and indexed websites that match a question with the knowledge.search step, use them in a later step, and know what a search may read.
---

Use a `knowledge.search` step when an automation needs what your organization already knows, such as a policy, a product sheet or a page of your help centre, without an agent step. It searches your [documents](/platform/knowledge/documents), your [indexed websites](/platform/knowledge/crawling), or both, and returns the passages that match the query best, best first. It changes nothing, so it never asks for an approval. A test run answers with a mock.

## Search, then use the passages

```yaml
nodes:
  - id: related
    type: knowledge.search
    input:
      query: '{{ input.question }}'
      corpus: documents
      limit: 3
  - id: answer
    type: llm
    model: openai/gpt-4o-mini
    prompt: 'Answer {{ input.question }} from these passages only, and say so when they do not answer it: {{ nodes.related.output.hits }}'
```

<Frame caption="The search step in the editor: its query reads the run's question, and it hands its hits to a later step.">

![The Editor tab of Answer launch questions, live, with No problems: Start, Related and End on the canvas, Related selected as a Knowledge · Search knowledge step that returns a list of hits. Beside the canvas, its Input holds limit 3, a query that reads the question of the run's input, and corpus documents.](/images/platform/automation-knowledge-search-step.webp)

</Frame>

| Input    | What it holds                                                                 |
| -------- | ----------------------------------------------------------------------------- |
| `query`  | What to search for, in words, up to 2,000 characters.                         |
| `limit`  | How many passages to return: 1 to 20, 5 by default.                           |
| `corpus` | `documents`, `web` for your indexed websites, or `all` for both, the default. |
| `folder` | Only documents in this folder and the folders below it, such as `/Policies/`. |

The step returns `{ hits }`, best first. No hit means nothing matched, and the step still succeeds. Each hit holds:

| Field        | What it holds                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| `text`       | The passage, with its document's heading.                                                                   |
| `title`      | The document's or the page's title, or `null`.                                                              |
| `source`     | `documents` or `web`.                                                                                       |
| `documentId` | The document the passage belongs to.                                                                        |
| `projectId`  | The project the document is filed under. A document every member shares has none.                           |
| `url`        | The page a web passage came from.                                                                           |
| `score`      | The rank the hits are ordered by.                                                                           |
| `similarity` | How close the passage's meaning is to the query, closer to 1 when closer, when the meaning search found it. |

A search keeps every hit it ranks, however weak. To leave weak matches out, compare `similarity` in a later step.

<Frame caption="A live run in Website relaunch: the step read the run's question, searched the documents and returned three hits.">

![The page of a succeeded live run of Answer launch questions with the Related step selected. Its Last run tab says the step ran knowledge.search and read the question of the run input, What happens on launch day?, received limit 3, that query and corpus documents, and returned hits, a list of 3 items.](/images/platform/automation-knowledge-search-run.webp)

</Frame>

## What a search reads

A search reads what its run may read, never what the author of the step can see:

- A run in a project reads that project's documents and the documents every member shares.
- A run of an automation bound to projects, started for the whole organization, reads those projects' documents and the shared ones.
- An automation bound to no project reads only the documents every member shares.

It never reads a team library the run isn't given, nor the uploads and mail of a conversation. Embedding the query counts toward the [usage limits](/platform/admin/governance/policies-and-limits) that bind the run, and is booked under the automation's name, as an `llm` step's call is.

## When a search fails

The run page says why a search step failed and how to fix it.

| Failure                            | What happened                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Knowledge search isn't set up**  | The organization has no embedding model. An administrator chooses one in **Settings › Data residency**.                  |
| **Knowledge search failed**        | The provider of the embedding model refused or failed the call.                                                          |
| **A usage limit stopped the step** | A limit that binds the run has no room left. It counts as a limit, not as a failure that repeats, so no schedule pauses. |
