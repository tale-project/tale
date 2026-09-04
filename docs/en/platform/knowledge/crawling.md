---
title: Crawling
description: How Tale turns a website into knowledge — domain registration, sitemap-driven URL discovery, scheduled re-scans, and the indexed-pages view.
---

A Website is the knowledge base's shape for "a public site the agent should know about". You hand Tale a domain and a scan interval; the crawler discovers URLs, fetches pages, extracts the main content, chunks and embeds the text, and serves the chunks back at reply time the same way it does for Documents. When you need specific pages rather than a whole site, hand it a URL list instead — the same pipeline runs on exactly the pages you name. This page walks what you see between adding a domain and agents citing its pages.

<Frame caption="Adding a website — in Whole website mode, domain plus scan interval is the whole form.">

![The Add website dialog on the Websites tab, asking for a domain and a scan interval that defaults to every six hours.](/images/platform/websites-add-dialog.webp)

</Frame>

## Adding a website

Open **Knowledge > Websites** and click **Add website**. **Source type** decides what the source covers: **Whole website** — the default — crawls everything it can discover on the domain, **URL list** indexes exactly the pages you paste (the next section). In Whole website mode the dialog has two fields: **Domain** (for example `example.com`) and **Scan interval** — every 1 hour, 6 hours (the default), 12 hours, 1 day, 5 days, 7 days, or 30 days. Tale normalises the domain — `https://`, `www.`, and trailing slashes are tolerated — and rejects anything that does not parse as a hostname. Click **Save**; the scheduler picks new websites up on its next tick, so the first scan starts within seconds.

<Note>

There is no auth field and no include/exclude path list — the crawler sees exactly what an anonymous visitor sees. Anything behind a login belongs in [Documents](/platform/knowledge/documents) or an [connector](/platform/connectors/overview) instead.

</Note>

## Adding a URL list

Switch **Source type** to **URL list** when you want specific pages, not a whole site — a report here, a pricing page there, a handful of PDFs. Paste one URL per line into **URLs**; only those pages are fetched and indexed, and the crawler follows no links beyond them. The lines may span several websites: the dialog groups them into one source per website, so a paste covering three domains creates three rows. Pasting another list for a website that already has one adds the new URLs to the existing source — nothing is dropped, and the scan interval moves to whatever you picked. Lists re-scan on the same cadence as whole websites; their rows carry a **URL list** badge in the table.

## How URLs are discovered

The crawler tries the cooperative path first. It resolves the homepage and walks every sitemap the site publishes — `sitemap.xml`, sitemap indexes, gzipped and robots-declared sitemaps — collecting the URL list the site itself maintains. Sites with a healthy sitemap get complete coverage with no guessing.

When the sitemap is missing, broken, or empty, the crawler falls back to a breadth-first link walk from the homepage: in-domain links only, external and social links dropped, navigation and footer chrome stripped before extraction. The fallback covers sitemap-less sites, but it cannot match a well-maintained sitemap for completeness.

Pages are not the only content that counts. Linked documents — PDF and Office files (`docx`, `xlsx`, `pptx`, `odt`) — are fetched and indexed like pages, whether the crawler finds them linked on a website or you list them directly in a URL list. Images and scanned documents without embedded text are skipped: the scan remembers it looked and stores nothing.

## The scan schedule

The interval decides how often URLs are re-discovered and pages re-fetched. Each scan is incremental: unchanged pages are skipped, changed pages are re-extracted and re-embedded, new pages are added, removed pages are dropped from the index. URL lists follow the same cadence with a fixed set — the listed pages are re-fetched on schedule, nothing new is discovered. Agents pointed at the website see the new content on the next retrieval — there is no separate publish step.

## Reading the table

Each row shows the domain (URL-list sources carry a **URL list** badge beside it), its **Status** — **Idle** between scans, **Scanning** in flight, **Active** after a successful scan, **Error** when the last scan failed, **Deleting** during removal — the **Indexed** percentage (hover for crawled-of-total page counts), the last **Scanned** time, and the **Interval**. Open a row for the site's discovered title and description; click **View pages** for the page list — every indexed URL with its word count, chunk count, and last-crawled time, plus a search box that runs over the indexed chunks, which is the quickest way to check what an agent would actually retrieve.

## Where this fits

Crawling is the cheap way to bring a public site into agent context: a domain — or a hand-picked URL list — a cadence, and the rest is the crawler's problem. The trade-off is the anonymous-visitor boundary — private content needs [Documents](/platform/knowledge/documents) or a connector. For how the Website rows sit beside Contacts and Products, read [Structured data](/platform/knowledge/structured-data).
