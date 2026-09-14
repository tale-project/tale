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

The crawler visits as an anonymous reader. Content that depends on a private session is not made accessible by adding its URL.

The initial discovery pass applies `robots.txt` `Disallow` rules for the `*` agent. These rules do not filter an explicit URL list or links found later in rendered JavaScript pages. On each content fetch, an HTTP `X-Robots-Tag: noindex` or `none` prevents indexing, including for listed URLs. An HTML `<meta name="robots">` tag is not currently checked. These limits matter if you administer the source website: do not rely on Tale's crawler as an access-control mechanism.

Use HTTPS on the standard port. Addresses with a non-default port, such as `:8001`, are rejected. Private addresses and redirects into private networks are blocked unless the operator has configured an allowed private-network deployment.

## Work within crawl limits

| Limit | Effect on coverage |
| --- | --- |
| 10,000 tracked URLs per website | A larger site can have undiscovered pages. Use a focused URL list for the material you need. |
| Three minutes for discovery, at most 50 sitemap fetches | Large or slow sitemap collections can be incomplete. |
| 25 MiB and 30 seconds per content fetch | Oversized downloads and slow responses fail. Browser rendering has separate time limits. |
| Five-minute processing budget per batch, up to 200 continuations | Long scans continue in batches. Work already being fetched or rendered can outlast a batch's budget; this is not a guaranteed total scan duration. |
| Five consecutive failures for an automatically discovered URL | The crawler stops scheduling that URL. Listed URLs remain eligible on each scan. |

There is no configurable page cap, include/exclude path filter, or stop-scan button. A URL list narrows what you request; it does not remove these limits.

## Check what was indexed

The table shows **Status**, the **Indexed** page count, **Scanned**, and **Interval**. Open the source row to inspect its page list, word and chunk counts, and last-crawled times. Expand a page to read its stored text chunks. A failed fetch shows its reason and number of consecutive failures.

| Status | Meaning |
| --- | --- |
| **Idle** | Registered, but no scan has completed yet. |
| **Scanning** | A scan is in progress. |
| **Active** | A scan completed successfully. Check page-level results for coverage. |
| **Error** | The scan failed, or attempted pages left the source with no stored content. Open the source for its reason. |
| **Deleting** | The source is being removed. |

The page view also offers search over indexed content. Try a distinctive phrase from a page before relying on it in chat, then ask a specific question and inspect the citation.

## Resolve a missing page

First check the address, source type, and latest scan time. Then open the source and read the affected page's error.

| Reported issue | What to check or change |
| --- | --- |
| Certificate not trusted | The website operator must fix an expired, self-signed, mismatched, or otherwise untrusted TLS certificate. Repeated scans do not repair it. |
| Private address, refused redirect, or invalid URL | Use the intended public HTTPS address. Ask your operator about approved internal sources if needed. |
| HTTP error, network failure, or timeout | Open the original page and check availability. A later scan can recover after the source service is repaired. |
| Response too large | Publish a smaller document or split the source; the fetch limit is 25 MiB. |
| Source requests no indexing | The response sends `X-Robots-Tag: noindex` or `none`. The source owner must change that directive before Tale can index it. |
| Unsupported content or no readable text | JSON/XML endpoints, binary downloads, images, or scans may provide no supported page text. Supply an HTML page or a supported document with extractable text. |
| Rendering or document extraction failed | Check that the public page loads and the original document opens. Repair or re-export the source if it is damaged. |

A successful later fetch clears the previous error. A failed refresh can leave an earlier indexed copy available: **Active** and an indexed count do not prove every page is up to date. Compare the stored chunks and last-crawled information with the original before relying on a recent change.

If the source shows **Paused**, repeated failures to reach the knowledge database stopped scans. Ask an administrator to repair the connection under **Settings > Data residency**, then use **Resume scanning**.
