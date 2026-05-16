---
title: Knowledge base
description: Upload, organise, and search the documents and crawled websites the AI grounds its answers in.
---

The knowledge base is where Tale stores the information the AI grounds its answers in. Anything you add here becomes searchable by every agent in the organisation — uploaded files, websites the crawler indexes, structured records you import. This page covers the two main user-facing sections: **Documents** for files you upload or sync, and **Websites** for crawled sources. Editor role or higher is required to add, edit, or delete entries; Members can read the catalogue.

For structured data sections (Products, Customers, Vendors), see [Structured data](/platform/knowledge/structured-data) — the same knowledge surface, with a tabular shape instead of free-form files.

## Documents

Documents are the core of the knowledge base. Upload files directly from your device, sync them from Microsoft 365, or run a comparison against an existing document. Once a file is indexed, the content is searchable by every agent that has access to the folder it lives in.

### Upload documents

To upload one or more files, open **Knowledge > Documents** and click **Upload** in the top-right action menu. The dialog accepts files dragged into the drop zone or browsed from the file picker — pick multiple at once if you have a batch. Optionally assign the documents to one or more teams to scope which team-filtered views they appear in. Click **Upload** to enqueue the files; each one shows a status indicator while it indexes in the background.

The accepted file types: PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, HTML, JSON, YAML, and most code file formats. Maximum file size is 100 MB per file by default; Admins can lower the cap per MIME type in the [Upload policy](/platform/admin/governance#upload-policy).

### Organise into folders

Documents can live inside folders so the team can navigate a deep catalogue without scrolling through a flat list. Use the breadcrumb at the top of the Documents table to move between folders, or pick **New folder** from the action menu. You can create a folder during upload or any time afterwards; documents can be moved between folders from the row action menu.

### Sync from Microsoft 365

If a Microsoft account integration is connected, **From Microsoft 365** appears in the upload dialog alongside **From your device**. Picking it opens a browser for OneDrive and SharePoint sites the account can reach — choose a one-time import or a sync that keeps the files in step with the source folder. Files imported this way carry a SharePoint or OneDrive source badge in the documents table, so you can tell synced files apart from device uploads.

### Compare two documents

To diff two documents — a new contract version against the previous one, a refreshed policy against the spec — open the action menu and pick the comparison entry. The dialog walks the upload-or-pick flow and renders a paragraph-level diff. The full doctrine lives at [Document comparison](/platform/workspace/document-comparison).

## Websites

Website tracking tells Tale's crawler to visit and index pages from a given domain on a schedule. Once a site is indexed, every agent with web access can answer questions about its content — useful for documentation sites, internal wikis, and any public domain the team cites often.

### Add a website

To add a site, open **Knowledge > Websites** and click **Add website**. The dialog asks for the full URL (for example `https://docs.example.com`) and a scan interval. Click **Add** to save — the crawler fetches the homepage right away and starts discovering linked pages.

The seven supported scan intervals trade freshness against crawl cost:

| Scan interval  | Best for                                 |
| -------------- | ---------------------------------------- |
| Every 1 hour   | Sites with frequent content changes.     |
| Every 6 hours  | Documentation sites and company wikis.   |
| Every 12 hours | Semi-active sites.                       |
| Every 1 day    | Marketing sites and blogs.               |
| Every 5 days   | Moderately static content.               |
| Every 7 days   | Reference sites with infrequent updates. |
| Every 30 days  | Rarely changing reference material.      |

For deeper control over crawl scope (allowed paths, ignored sections, robots.txt overrides), see [Website crawling](/platform/knowledge/crawling).

## Where this fits

The knowledge base is the substrate every agent grounds in — the documents, websites, and structured records the AI cites when it answers. Curating it well is what turns a generic AI assistant into one that knows your products, your policies, and your customers. Most quality wins from building a new agent come from sharpening the agent's knowledge scope rather than swapping models.

To narrow what a specific agent can search instead of giving every agent access to everything, the next page is [Agent concepts → Knowledge](/platform/agents/concepts#knowledge). To enrich the base with structured records, [Structured data](/platform/knowledge/structured-data) walks the Products, Customers, and Vendors entities.
