---
title: Knowledge base
description: Upload, organise, and search documents and crawled websites in your workspace.
---

The knowledge base is where Tale stores information for the AI to use. Anything you add here becomes searchable by the chat agent using meaning-based search. This page covers the two user-facing sections — **Documents** and **Websites**. For structured-data sections (Products, Customers, Vendors), see [Structured data](/platform/knowledge/structured-data).

> **Note:** Editing the knowledge base requires the Editor role or higher. Members can view all knowledge items but cannot create, update, or delete them.

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

### Folder organisation

Documents can be organised into folders. Use the breadcrumb navigation at the top of the Documents table to move between folders. You can create folders during upload or from the action menu.

### Microsoft OneDrive sync

If a Microsoft account integration is configured, a Sync from OneDrive option appears in the action menu. This imports documents directly from OneDrive without downloading them to your server first.

### Document comparison

You can compare two documents to see what changed between them. Upload a new version or select an existing document, and the platform generates a detailed diff showing additions, deletions, and modifications.

See [Document comparison](/platform/workspace/document-comparison) for full details.

## Websites

Website tracking tells Tale's crawler to visit and index pages from a given domain on a schedule. Once indexed, the AI agent can answer questions about that site's content.

### Adding a website

1. Navigate to Knowledge > Websites and click Add website.
2. Enter the full URL of the website, for example `https://docs.example.com`.
3. Select a scan interval. This controls how often the crawler re-checks for updated content.
4. Click Add. The crawler fetches the homepage right away and starts finding linked pages.

| Scan interval           | Best for                                |
| ----------------------- | --------------------------------------- |
| Every hour              | Sites with frequent content changes     |
| Every 6 hours (default) | Documentation sites and company wikis   |
| Every 12 hours          | Semi-active sites                       |
| Every day               | Marketing sites and blogs               |
| Every 5 days            | Moderately static content               |
| Every 7 days            | Reference sites with infrequent updates |
| Every 30 days           | Rarely changing reference material      |

For deeper control over crawling behaviour, see [Website crawling](/platform/knowledge/crawling).
