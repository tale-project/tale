---
title: Knowledge
description: Knowledge is the org's shared library — documents, small facts, crawled websites, and typed records — that agents ground their replies in. This overview names the tabs and points at the per-area pages.
---

Knowledge is the area where the org's data lives so agents can read and cite it. Editors curate it once; agents retrieve over it at reply time, which is why an agent in Tale can answer with your reality instead of the model's training data. The area opens on six tabs: **Documents**, **Knowledge entries**, **Websites**, **Products**, **Contacts**, and **Vendors**.

Prefer to watch first? Episode 3 walks the whole library in three minutes — indexing, entries, records, the crawler, and scopes, captions included.

<Video src="/videos/en/tutorials/ep3-knowledge/ep3-knowledge.en.mp4" poster="/videos/en/tutorials/ep3-knowledge/ep3-knowledge.en.webp" captions="/videos/en/tutorials/ep3-knowledge/ep3-knowledge.en.vtt" lang="en" title="Episode 3 — Knowledge" caption="Episode 3 — Knowledge (3:03)">

</Video>

<Frame caption="The Documents tab — the most-used corner of the knowledge base.">

![The Knowledge area's Documents tab listing three uploaded text files with size, source, RAG status, and team columns.](/images/get-started/documents-list.webp)

</Frame>

## The two shapes

Everything in the area is one of two shapes. **Indexed content** — the files in Documents, the facts in Knowledge entries, the pages a website crawl brings in — runs through the indexing pipeline (extract, chunk, embed, store) so agents retrieve relevant passages and cite them. **Typed records** — Products, Contacts, Vendors — are rows with named fields that agents read as data, not prose: exact values, no retrieval guesswork.

The shape you pick decides how an agent can use the content, which is why [Structured data](/platform/knowledge/structured-data) is a decision page, not just a reference.

## Where the index lives

Indexed content is embedded into Tale's built-in vector database — a **PostgreSQL** store (ParadeDB) that combines `pgvector` embeddings with keyword (BM25) search and fuses the two, so retrieval catches both semantic matches and exact terms. It ships with the platform, so there's nothing extra to license or operate, and retrieval, citations, per-team permissions, and GDPR erasure all act on one store. Embeddings come from the org's configured **embedding model** — an org admin picks the provider, model, and vector width in **Settings > Data residency**, and knowledge search refuses with an actionable error until one is configured, rather than guessing a model.

**Bring your own vector database — it's Postgres.** Because the vector store is PostgreSQL, you can point Tale's knowledge database at any managed PostgreSQL you run (with the `pgvector` and `pg_search`/ParadeDB extensions) instead of the bundled one — your data, your infrastructure, your region. An org admin sets the connection in **Settings > Data residency** — enter the host, database, and credentials for your Postgres, the same way on a self-hosted deployment and on a dedicated cloud instance. Tale verifies the connection and that the required extensions are present before you cut over. See [Data residency](/self-hosted/configuration/data-residency) for the connection details and the extension prerequisites.

## How agents reach in

An agent does not see the whole library by default. The agent's **Knowledge** tab controls its retrieval scope — which parts of the library it searches at reply time — and team-scoped items stay invisible to agents and members outside the team. Retrieval is driven by the agent's RAG-tagged tools, and every retrieved passage carries its source, so citations point back at the file, entry, or page it came from. The agent-side mechanics live in [Agent knowledge](/platform/agents/knowledge).

## Pages in this section

<CardGroup cols="2">

<Card title="Documents" icon="file-text" href="/platform/knowledge/documents">

Uploading files, the indexing pipeline, supported formats, and the per-document lifecycle.

</Card>

<Card title="Knowledge entries" icon="book-open" href="/platform/knowledge/knowledge-entries">

Small, topic-keyed facts — captured from chat with approval or added by hand.

</Card>

<Card title="Crawling" icon="globe" href="/platform/knowledge/crawling">

Turning a public website into knowledge — domain, scan interval, and the indexed-pages view.

</Card>

<Card title="Structured data" icon="table" href="/platform/knowledge/structured-data">

Contacts, Products, Vendors, Websites — when a typed record beats a document.

</Card>

</CardGroup>

## Where this fits

Knowledge is the data layer every grounded reply stands on; without it, agents only know what the model already knows. Bring content in through the tab that matches its shape, then wire agents to it — the natural next read is [Documents](/platform/knowledge/documents) for files, [Structured data](/platform/knowledge/structured-data) for records, and [Agent knowledge](/platform/agents/knowledge) for the retrieval side.
