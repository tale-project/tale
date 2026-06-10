---
title: Knowledge
description: Knowledge is the area where the org's documents and structured data live so agents can cite them. Editors curate it; agents retrieve over it at reply time. This overview names the two halves and points at the per-area pages.
---

Knowledge is the area where the org's data lives so agents can read it. It has two halves: **Documents** — unstructured files run through the indexing pipeline so agents can retrieve relevant chunks at reply time — and **Structured data** — typed tables of customers, products, vendors, and websites that agents read as records, not as prose. Editors curate both halves; agents see whichever pieces they are bound to.

The Knowledge area is the place every agent that needs to ground its replies in the org's reality reaches into. The overview names the halves and the per-area pages; the concept-level model of how an agent uses the knowledge it is bound to lives under [Agent knowledge](/platform/agents/knowledge).

## The two halves

**Documents** is the unstructured half. Drop in a PDF, a Markdown file, a slide deck, a spreadsheet, a code file; the indexing pipeline extracts the text, chunks it, embeds the chunks, and stores them so RAG-tagged tools can retrieve relevant pieces at reply time. The content does not have to fit a schema; the pipeline reads whatever the file gives it.

**Structured data** is the typed half. Customers, Products, Vendors, and Websites are first-class tables with named fields, validation, and explicit relationships. An agent reads a structured record the way it reads a JSON object — field by field — and can cite the record directly. Reach for structured data when the content has the same shape across many rows (every customer has a name, an email, a tier); reach for documents when the content is prose with no fixed shape.

The two halves share the same visibility and team-scoping levers. A team-scoped customer record is invisible to members outside the team the same way a team-scoped document is.

## How agents reach in

An agent does not see the whole knowledge base by default. The agent's **Knowledge** tab is where you bind specific documents, customer lists, product catalogues, or website crawls to the agent. Bound resources are visible during retrieval; unbound resources are not. This is intentional — it keeps the trust boundary visible and stops an agent from pulling in something the org did not mean it to see.

The retrieval itself happens at reply time and is driven by the RAG-tagged tool family on the agent. A bound document gets retrieved by the same mechanic regardless of where it came from — a direct upload, a OneDrive sync, a Confluence pull, a website crawl. The source field on each indexed item points the citation back at the original.

## Pages in this section

**[Documents](/platform/knowledge/documents)** — Editors read this when they upload files, watch the indexing pipeline, and manage the per-document lifecycle.

**[Knowledge entries](/platform/knowledge/knowledge-entries)** — Editors read this when they manage the small, topic-keyed facts users contribute — captured from chat with approval or added by hand — that ride the same indexing pipeline as documents.

**[Structured data](/platform/knowledge/structured-data)** — Editors read this when they maintain typed tables — customers, products, vendors, websites — that agents read as records.

## Where this fits

Knowledge is the data layer agents ground their replies in; without it, agents only know what the model already knows. The natural next read depends on the content you are bringing in — for files [Documents](/platform/knowledge/documents); for typed records [Structured data](/platform/knowledge/structured-data); for how an agent binds and retrieves [Agent knowledge](/platform/agents/knowledge).
