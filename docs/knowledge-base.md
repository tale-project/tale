---
title: Knowledge base
description: Manage documents, websites, products, customers, and vendors for AI search.
---

The Knowledge Base is where Tale stores information for the AI to use. Anything you add here becomes searchable by the chat agent using meaning-based search. It is split into five sections, all accessible from the Knowledge tab in the sidebar.

> **Note:** Editing the Knowledge Base requires the Editor role or higher. Members can view all knowledge items but cannot create, update, or delete them.

## Documents

Documents are the core of the knowledge base. You can upload files directly or sync from Microsoft OneDrive. Once indexed, the content is searchable by the AI agent.

### Uploading documents

1. Navigate to Knowledge > Documents.
2. Click the Upload button in the top-right action menu.
3. Drag files into the upload area or click to browse. You can select multiple files at once.
4. Optionally assign the documents to one or more teams. This controls which team-filtered views they appear in.
5. Click Upload. Each file is queued for background processing. A status indicator shows when indexing is done.

Supported file types: PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, HTML, JSON, YAML, and most code file formats.

Maximum file size: 100 MB per file.

### Folder organization

Documents can be organized into folders. Use the breadcrumb navigation at the top of the Documents table to move between folders. You can create folders during upload or from the action menu.

### Microsoft OneDrive sync

If a Microsoft account integration is configured, a Sync from OneDrive option appears in the action menu. This imports documents directly from OneDrive without downloading them to your server first.

## Websites

Website tracking tells Tale's crawler to visit and index pages from a given domain on a schedule. Once indexed, the AI agent can answer questions about that site's content.

### Adding a website

1. Navigate to Knowledge > Websites and click Add Website.
2. Enter the full URL of the website, for example `https://docs.example.com`.
3. Select a scan interval. This controls how often the crawler re-checks for updated content.
4. Click Add. The crawler fetches the homepage right away and starts finding linked pages.

| Scan interval | Best for |
| --- | --- |
| Every hour | Sites with frequent content changes |
| Every 6 hours (default) | Documentation sites and company wikis |
| Every 12 hours | Semi-active sites |
| Every day | Marketing sites and blogs |
| Every 5 days | Moderately static content |
| Every 7 days | Reference sites with infrequent updates |
| Every 30 days | Rarely changing reference material |

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
