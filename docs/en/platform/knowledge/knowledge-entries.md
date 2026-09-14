---
title: Knowledge entries
description: Add a concise fact to shared knowledge, keep it current, and check the history when it changes.
---

Use a knowledge entry for a short fact that colleagues should be able to find again: support hours, a return window, or the owner of a process. Each entry has a topic and a body. Choose a [document](/platform/knowledge/documents) when the source is a whole policy or report, and [structured data](/platform/knowledge/structured-data) when named fields and exact values matter.

Members can read entries. Creating, editing, and deleting them requires the Editor role or higher. Entries belong to the organization's shared knowledge; do not use one for a personal note or a fact intended only for a particular project.

## Add a fact

<Steps>

<Step title="Open the entry form">

Go to **Knowledge > Knowledge entries** and click **Add entry**. If the action is missing, ask an administrator to check your role.

</Step>

<Step title="Give the fact a stable topic">

Enter a **Topic** such as `Support response target`. Use a name you would keep even if the answer changes. The topic can contain up to 120 characters and must be unique; edit the existing entry when Tale reports a duplicate.

</Step>

<Step title="Write enough context to use the answer">

In **Content**, state the fact, its scope, and any conditions. Markdown is supported, up to 8,000 characters. For example:

```markdown
Support aims to send a first response within 45 minutes during business
hours: Monday–Friday, 09:00–17:00 CET. This is a response target, not a
resolution deadline. Owner: Support Operations.
```

Avoid relative dates such as “next Friday” or references such as “the policy above.” An entry needs to make sense when retrieved on its own.

</Step>

<Step title="Save and check indexing">

Click **Save**. The entry appears in the table with its topic, content, source, indexing status, and update time. Open it to read the full content. Indexing happens in the background; saving the row does not mean search is already using it.

</Step>

</Steps>

<Frame caption="The table lets you check the fact and its indexing status before relying on it in an answer.">

![The Knowledge entries table lists manual facts with topic, content, source, indexing status, and update time.](/images/platform/knowledge-entries-list.webp)

</Frame>

## Correct an existing fact

Open the entry's row menu, choose **Edit**, change the content, and **Save**. Editing creates a new current version and queues its updated text for indexing. There is one current entry per topic, so correcting the existing fact avoids competing answers.

Open the entry's details to inspect **Version history** after a correction. Previous versions record what changed and when they were replaced; they are not additional current facts. An application can also create or update entries through the [REST API](/develop/api-reference).

<Tip>

When a chat uncovers a useful fact, verify it against the source, then add or edit an entry yourself. Chat does not automatically save facts to the organization's knowledge base.

</Tip>

## Remove an obsolete entry

Use **Delete** in its row menu and read the confirmation. Deletion removes the entry and its version chain from this view and makes its backing document unavailable to knowledge retrieval. Keep a copy before deleting if you still need the text; use **Edit** for a correction instead.

## If the fact is missing from an answer

Check the current entry before changing the prompt. Has it been saved, is its indexing complete, and does the question use a clear topic? If indexing failed, use the retry control after resolving the reported cause. Repeated failures need an administrator to check the organization's embedding configuration and indexing services.

Ask the assistant to cite the source, then open that source and compare it with the entry. A plausible answer alone does not establish that the latest fact was used. [Documents](/platform/knowledge/documents) explains the shared indexing states in more detail.
