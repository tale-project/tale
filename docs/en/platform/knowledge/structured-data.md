---
title: Structured data
description: Manage products, customers, and vendors as structured records the AI can query.
---

Structured data is the row-and-column half of the knowledge base — the three sections (**Products**, **Customers**, **Vendors**) that store business records with fixed fields the AI agent can query alongside documents and crawled websites. The audience is the Editor or Developer curating those records, individually or by CSV import. This page covers what each section holds, the CSV format, and how to constrain which entities a given agent sees.

## Products

The Products section stores your product catalog. Each product record includes a name, description, image URL, stock level, price, currency, category, and status.

Products can be added one at a time or imported in bulk via CSV. The CSV format has no header row, with columns in this order:

```text
name, description, imageUrl, stock, price, currency, category, status
```

Valid status values: `active`, `inactive`, `draft`, `archived`. Invalid values fall back to `draft`.

## Customers

The Customers section stores your customer list. Each customer has an email address, locale, status, and optional custom metadata. Imported customers are set to a status of `churned` by default.

Import via CSV with this format:

```text
email, locale
```

Valid locale values: `en`, `de`, `es`, `fr`, `it`, `nl`, `pt`, `zh`. Invalid locales fall back to `en`.

## Vendors

The Vendors section stores supplier and partner records. Vendor data is searchable by the AI agent and can be referenced in automated workflows. The same CSV import that works for customers also works here.

## Using structured data in agents

Structured records are indexed into the same knowledge store as documents. Agents with knowledge access can search across all types. To restrict an agent to a subset — for example, a sales agent that only sees Products and Customers — configure its Knowledge tab. See [Create an agent](/platform/agents/create).

## Where this fits

Structured data is the half of the knowledge base that has rows and columns instead of paragraphs and headings. The free-text half (documents, crawled websites) is for prose-shaped content; this half is for entities — the catalogues, customer lists, and supplier records the AI cites when it answers domain-specific questions. Both halves are indexed into the same store and reachable through the same knowledge search, so an agent that grounds in both fluidly mixes them.

For the prose half of the knowledge base, [Knowledge base](/platform/workspace/knowledge-base) covers document upload and website crawling. For the agent-side controls that decide which entities a given agent sees, [Create an agent → Knowledge](/platform/agents/create) is the next page.
