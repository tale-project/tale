---
title: Crawling
description: How Tale turns a Website entity into knowledge — domain registration, sitemap-driven URL discovery, scheduled re-scans, and the indexed-pages view.
---

A Website is the structured-data shape for "a public site the agent should know about". You hand Tale a domain and a scan interval; the crawler discovers URLs, fetches pages, extracts main content, chunks and embeds the text, and serves the chunks back at reply time the same way it does for Documents. This page hands you the mental model and walks through what you see when a website goes from added to indexed.

Crawling is one half of the Websites story. The other half — what the structured Website record holds and how agents read it — lives in [Structured data](/platform/knowledge/structured-data). Read that first if the question is "should this be a website or a document"; read this if the question is "what does the crawler actually do".

## Adding a website

Open **Knowledge > Websites** and click **Add website**. Two fields: **Domain** (for example `example.com`) and **Scan interval** (every hour, every 6 hours, every 12 hours, daily, every 5 days, every 7 days, every 30 days). Tale normalises the domain — `https://`, `www.`, trailing slashes are tolerated — and rejects anything that does not parse as a hostname. Save, and the website lands in the table with status **Scanning**.

There is no auth field, no per-path include list, no per-path exclude list on the form. The crawler treats the domain as a public surface; anything that needs a session, a header, or a bypass is not in scope for Websites. For private content, upload [Documents](/platform/knowledge/documents) or wire an [integration](/platform/integrations/overview).

## How URLs are discovered

The crawler tries the cooperative path first and falls back to the rude one.

The first try is the site's sitemap. The crawler resolves the homepage, asks `ultimate-sitemap-parser` to walk every `sitemap.xml` and sitemap index it can find — including gzipped sitemaps and robots-declared sitemaps — and collects every URL the site itself published. Sites that maintain their sitemap get a clean, complete URL list with no link-graph guessing.

When the sitemap is missing, broken, or empty, the crawler falls back to a breadth-first link walk from the homepage. It follows in-domain links only, drops external and social-media links, and strips navigation and footer chrome before extracting content. The fallback covers sites without a sitemap; it does not match a well-maintained sitemap for completeness.

## The scan schedule

The scan interval you picked decides how often the crawler re-discovers URLs and re-fetches pages. Behind the table, a scheduler wakes every interval, asks the store which websites are due, and runs them with bounded concurrency. New websites have no last-scanned timestamp, so they are picked up on the next scheduler tick and start scanning within seconds of being added.

Each scan is incremental: pages that have not changed are skipped, pages that have changed are re-extracted and re-embedded, new pages are added, removed pages are dropped from the index. Agents pointed at the website see the new content on the next retrieval.

## What the table tells you

Each row shows the domain, the scan interval, the status, the last-scanned timestamp, and an indexed-pages percentage. Status reads as **Idle** between scans, **Scanning** while a scan is in flight, **Active** when a scan completed successfully, **Error** when the last scan failed, or **Deleting** when a row is being removed. The percentage is `crawled / total` from the most recent scan — hover for the raw counts.

Open a row to read the website's discovered title, description, and creation date. Click **View pages** for the page list — every URL the crawler has indexed, with the per-page word count, chunk count, last-crawled timestamp, and a search box that runs over the indexed chunks.

## Where this fits

Crawling is the cheap way to bring a public site into agent context. You give it a domain and a cadence, and the rest is the crawler's problem — sitemap discovery, link-graph fallback, scheduled re-scans, incremental indexing. The trade-off is that the crawler only sees what an anonymous visitor sees. Anything behind a login lives in [Documents](/platform/knowledge/documents) or an [integration](/platform/integrations/overview). The next read worth queuing is [Structured data](/platform/knowledge/structured-data) — it covers how the Website record and the indexed pages fit alongside Customers, Products, and Vendors in the knowledge base.
