---
title: Structured data
description: Manage products, customers, and vendors as structured records the AI can query.
---

Structured data sections of the knowledge base store business records the AI agent can query alongside document and website content. Unlike free-form documents, structured entries have fixed fields and can be imported in bulk.

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
