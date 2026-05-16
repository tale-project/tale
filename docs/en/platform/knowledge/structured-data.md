---
title: Structured data
description: Products, customers, and vendors — the row-and-column half of the knowledge base.
---

Structured data is the row-and-column half of the knowledge base. The three sections — **Products**, **Customers**, **Vendors** — store business records with fixed fields the AI can query alongside uploaded documents and crawled websites. Agents that ground in knowledge see the rows the same way they see paragraphs: same search, same access controls, same citations in the answer. The audience is the Editor or Developer curating those records — by hand for one-offs, by file for bulk imports.

This page covers what each section holds, the import shape for the file flows, and how to point an agent at a subset of the records. The free-text half of the knowledge base — uploaded documents and crawled sites — lives at [Knowledge base](/platform/workspace/knowledge-base) and [Website crawling](/platform/knowledge/crawling).

## Products

The **Products** section stores the catalogue. Each row carries a name, an optional description, an image URL, a stock count, a price and currency, a category, a tag list, and a status. The status is `active`, `inactive`, `draft`, or `archived` — anything else lands as `draft` on import. Translations attach as nested rows keyed by language code, so the same product can ship its name and description in every locale your customers speak.

The bulk-import flow accepts a CSV with a header row. The expected headers are exactly:

```text
name, description, imageurl, stock, price, currency, category, status
```

The importer is header-driven, not positional — leave a column out and the importer treats the field as empty for every row, rather than misaligning subsequent columns. The first matching header on each row drives the column; case is normalised. An Excel file with the same column names also works.

## Customers

The **Customers** section stores the customer list. Each row carries a name, an email address, a locale, a status, an optional address, and an optional metadata bag. The status is `active`, `churned`, or `potential` — imports default to `active`. The locale is a two-letter language code (optionally a region) and the import maps anything that does not look like a locale to `en`.

The CSV format is positional with one to three columns:

```text
email
email, locale
email, name, locale
```

The email is the only required column. A second column that matches a locale pattern (`en`, `de`, `fr-CH`) is read as the locale; anything else is read as the name and the locale falls back to `en`. With three columns, the order is fixed: email, name, locale. Excel imports use the column names instead of position.

## Vendors

The **Vendors** section stores supplier and partner records. The shape is the same as customers — email, name, locale — and the same CSV format works. Vendor records are searchable by AI agents that have knowledge access, and reachable from automation steps that need to look a vendor up by id or by name.

## Pointing an agent at a subset

Structured records are indexed into the same store as documents and crawled pages. An agent with knowledge access can search every record type by default. To narrow the agent's view — for example, a sales agent that should only see **Products** and **Customers** but never the supplier list — open the agent's **Knowledge** tab and pick the sources to include. See [Create an agent](/platform/agents/create) for the build flow.

## Where this fits

Structured data is the rows-and-columns counterpart to the prose-and-headings half of the knowledge base. The prose half is for paragraphs the AI quotes verbatim; this half is for entities the AI cites in domain-specific answers — the price on a product, the locale on a customer, the contact on a vendor. Both halves land in the same search index, so an agent grounded on both fluidly mixes them in one reply.

For documents and websites, the prose half is at [Knowledge base](/platform/workspace/knowledge-base). For the agent-side decision of which entity types a given agent sees, the next page is [Create an agent](/platform/agents/create).
