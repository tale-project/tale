---
title: Add websites to knowledge
description: Choose public pages to index, set a scan interval, and investigate missing or outdated content.
---

Add a website when your team needs to ask about public content that changes over time. Tale fetches the selected pages and indexes their readable text for knowledge search. You need Editor permissions or higher to manage website sources. Pages behind a login need another import route, such as [Documents](/platform/knowledge/documents).

## Add a website or selected pages

Open **Knowledge > Websites** and click **Add website**. Choose the source type before entering the address:

| Source type | Use it when | What to enter |
| --- | --- | --- |
| **Whole website** | You want content discovered across a domain | A **Domain**, such as `example.com` |
| **URL list** | You need a selected set of pages or public documents | One address per line under **URLs** |

Whole-website mode accepts a URL but uses its hostname; pasting a path does not restrict the crawl to that path. Choose URL list for that purpose. The `www` and non-`www` spellings count as the same website, so adding both produces a duplicate warning.

Choose **Scan interval** and **Save**. The default interval is six hours; the available choices range from one hour to thirty days. A newly saved source is picked up by the scheduler. Saving does not mean all pages have already been fetched or indexed.

<Frame caption="Whole website mode asks for a domain and a scan interval. Choose URL list when the page selection matters.">

![The Add website dialog shows Domain and Scan interval with a six-hour default.](/images/platform/websites-add-dialog.webp)

</Frame>

## Keep a URL list focused

A URL list fetches only the addresses you provide and follows no additional links. It can contain pages from several websites; Tale groups them into one source per website. Adding another list for an existing URL-list source adds addresses without dropping the existing ones and updates its scan interval.

Use complete public URLs. Linked PDF and modern Office documents can be indexed when they contain readable text. Images and scans without extractable text do not become searchable content.

## Understand discovery and refresh

For a whole website, the crawler uses the homepage and published sitemaps, including sitemap indexes and sitemaps declared in `robots.txt`. If usable sitemaps are missing, it follows links within the domain from the homepage. A page absent from both sitemaps and reachable links may be missed; use a URL list when specific coverage matters.

Scans are incremental. Unchanged content is skipped, changed content is indexed again, new pages are added, and removed pages leave the index. A URL list follows the same refresh schedule with its fixed selection. There is no separate publish step after successful indexing.

The crawler visits as an anonymous reader. There is no login field or whole-site include/exclude path list. Content that depends on a private session is not made accessible by adding its URL.

## Check what was indexed

The table shows **Status**, **Indexed**, **Scanned**, and **Interval**. Hover over the indexed percentage for crawled and total page counts. Open the source and choose **View pages** to inspect individual URLs, word and chunk counts, and last-crawled times.

| Status | Meaning |
| --- | --- |
| **Idle** | Waiting between scans. |
| **Scanning** | A scan is in progress. |
| **Active** | A scan completed successfully. Check page-level results for coverage. |
| **Error** | The latest scan failed; inspect its cause. |
| **Deleting** | The source is being removed. |

The page view also offers search over indexed content. Try a distinctive phrase from a page before relying on it in chat, then ask a specific question and inspect the citation.

## Resolve a missing page

First check the address, source type, and latest scan time. If a page failed, its row shows a reason and consecutive failed attempts: an HTTP error, blocked private address, rendering failure, or unsupported document extraction. Correct the source or wait for the upstream site to recover.

A URL-list page is retried on later scans while it remains listed. A discovered page is abandoned after five failed scans. A successful later fetch clears its previous error. If a scan appears healthy but a fact is absent, compare the indexed page text with the original; a successful scan is not a guarantee that every visible element became searchable text.

If the source shows **Paused**, repeated failures to reach the knowledge database stopped scans. Ask an administrator to repair the connection under **Settings > Data residency**, then use **Resume scanning**.
