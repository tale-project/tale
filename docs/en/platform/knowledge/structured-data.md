---
title: Structured data
description: Tale's knowledge base ships four built-in structured entities — Customers, Products, Vendors, Websites — alongside Documents. This page hands you the mental model for when to pick a typed record over a document.
---

Tale's knowledge base ships two shapes side by side. Documents are text the agent retrieves chunks from; structured records are typed rows the agent reads fields from. The shape you pick is the most important decision in how an agent will use your knowledge — get it wrong and the agent either dilutes a clear answer or guesses at a value you have on file.

This page hands you the mental model for when each shape is the right one. Read it before you load a folder of files; come back to it when you are tempted to upload a spreadsheet as a PDF.

## Documents versus structured records

A document is free-form: the indexing pipeline extracts text, chunks it, embeds the chunks, and serves passages via retrieval at reply time. The agent sees passages and cites them by source. This is the right shape when the content is prose — contracts, manuals, knowledge-base articles, meeting notes.

A structured record is typed: the entity has known fields (a customer has a name, an email, an industry; a product has a SKU, a price, stock). The agent reads the fields directly, joins across entities, and answers with the value. This is the right shape when the source is a database row — accounts, orders, parts, supplier records.

## The four built-in entities

Four structured tabs sit beside **Documents** and **Knowledge entries** in the Knowledge area:

- **Customers** — the people and organisations you do business with.
- **Products** — the things you sell.
- **Vendors** — the suppliers you buy from.
- **Websites** — public sites a crawler fetches on a schedule; the record holds the domain and scan settings, the indexed pages hold the content ([Crawling](/platform/knowledge/crawling)).

Structured records share the knowledge base's team-scoping levers: a team-scoped record is invisible outside the team the same way a team-scoped document is.

## Content models for custom shapes

When the four built-ins do not fit, content models let you define a custom structured record type: name the entity, declare its fields, set field-level access, and the new type appears alongside the built-ins. The definitions live under [governance content models](/platform/admin/governance/content-models).

<Note>

Content models cost governance attention — every field's access and retention policy is yours to set. Reach for them when the data is genuinely a new shape, not a slight variation on one of the four built-ins.

</Note>

## Putting it together — a CRM agent

A CRM agent that answers "where are we with Acme?" uses both shapes. The Customers entity holds the canonical record — name, primary contact, industry, status. Documents hold the call notes and contracts. The agent reads the customer's fields directly, retrieves passages from the documents, and answers with both: the structured status from Customers, the latest context from the most recent call note.

Without structured records, the agent has to find Acme by name across PDFs and risks confusing two customers with similar names. Without documents, the agent knows Acme's status but cannot tell you what happened on Tuesday's call.

## When to reach for it

| Use … when                                                 | Documents | Structured record |
| ---------------------------------------------------------- | --------- | ----------------- |
| The source is free prose                                   | ✓         |                   |
| The source has typed fields and you want exact values back |           | ✓                 |
| You need to join across many records                       |           | ✓                 |
| The agent should cite passages by location                 | ✓         |                   |

## Where this fits

Structured data is the seam between your operational data and the agent surface. Use the four built-ins for what they cover; reach for [content models](/platform/admin/governance/content-models) when a fifth shape appears. The next read worth queuing is [Documents](/platform/knowledge/documents) — the indexing pipeline that serves the unstructured half.
