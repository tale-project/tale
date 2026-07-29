---
title: Crawling
description: How Tale turns a website into knowledge — domain registration, sitemap-driven URL discovery, scheduled re-scans, and the indexed-pages view.
---

A Website is the knowledge base's shape for "a public site the agent should know about". You hand Tale a domain and a scan interval; the crawler discovers URLs, fetches pages, extracts the main content, chunks and embeds the text, and serves the chunks back at reply time the same way it does for Documents. This page walks what you see between adding a domain and agents citing its pages.

<Frame caption="Adding a website — domain plus scan interval is the whole form.">

![The Add website dialog on the Websites tab, asking for a domain and a scan interval that defaults to every six hours.](/images/platform/websites-add-dialog.webp)

</Frame>

## Adding a website

Open **Knowledge > Websites** and click **Add website**. The dialog has two fields: **Domain** (for example `example.com`) and **Scan interval** — every 1 hour, 6 hours (the default), 12 hours, 1 day, 5 days, 7 days, or 30 days. Tale normalises the domain — `https://`, `www.`, and trailing slashes are tolerated — and rejects anything that does not parse as a hostname. Click **Save**; the scheduler picks new websites up on its next tick, so the first scan starts within seconds.

<Note>

There is no auth field and no include/exclude path list — the crawler sees exactly what an anonymous visitor sees. Anything behind a login belongs in [Documents](/platform/knowledge/documents) or an [connector](/platform/connectors/overview) instead.

</Note>

## How URLs are discovered

The crawler tries the cooperative path first. It resolves the homepage and walks every sitemap the site publishes — `sitemap.xml`, sitemap indexes, gzipped and robots-declared sitemaps — collecting the URL list the site itself maintains. Sites with a healthy sitemap get complete coverage with no guessing.

When the sitemap is missing, broken, or empty, the crawler falls back to a breadth-first link walk from the homepage: in-domain links only, external and social links dropped, navigation and footer chrome stripped before extraction. The fallback covers sitemap-less sites, but it cannot match a well-maintained sitemap for completeness.

## The scan schedule

The interval decides how often URLs are re-discovered and pages re-fetched. Each scan is incremental: unchanged pages are skipped, changed pages are re-extracted and re-embedded, new pages are added, removed pages are dropped from the index. Agents pointed at the website see the new content on the next retrieval — there is no separate publish step.

## Reading the table

Each row shows the domain, its **Status** — **Idle** between scans, **Scanning** in flight, **Active** after a successful scan, **Error** when the last scan failed, **Deleting** during removal — the **Indexed** percentage (hover for crawled-of-total page counts), the last **Scanned** time, and the **Interval**. Open a row for the site's discovered title and description; click **View pages** for the page list — every indexed URL with its word count, chunk count, and last-crawled time, plus a search box that runs over the indexed chunks, which is the quickest way to check what an agent would actually retrieve.

## Where this fits

Crawling is the cheap way to bring a public site into agent context: a domain, a cadence, and the rest is the crawler's problem. The trade-off is the anonymous-visitor boundary — private content needs [Documents](/platform/knowledge/documents) or an connector. For how the Website rows sit beside Contacts, Products, and Vendors, read [Structured data](/platform/knowledge/structured-data).
