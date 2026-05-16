---
title: Website crawling
description: Point Tale's crawler at a domain and the content lands in the knowledge base.
---

The website crawler walks a public domain, extracts the text from every page it reaches, and indexes it into the knowledge base alongside uploaded documents and structured records. Once a site is indexed, agents and chat answer questions grounded in its content — "what is our current pricing on the website", "which features changed in the v3 release notes", "what does the help-centre article say about refunds". The audience for this page is the Editor or Developer who manages the **Knowledge > Websites** surface; for the end-user shortcut of adding a site directly from chat, see [Knowledge base](/platform/workspace/knowledge-base).

## What the crawler does on a fresh site

The first scan walks the site end to end.

1. The crawler fetches the domain and tries the sitemap first, falling back to a breadth-first walk from the homepage if no sitemap is reachable.
2. Every discovered URL on the same domain is queued.
3. Each page is fetched, parsed, and converted to clean text — navigation, footers, and ad blocks are stripped.
4. The text is chunked and indexed into the same knowledge store that holds uploaded documents, with the page URL as the source.
5. Non-HTML documents (PDF, DOCX, and similar) linked from crawled pages are fetched, converted, and indexed alongside the HTML.

The status on **Knowledge > Websites** moves from `idle` to `scanning` while the work is in flight, back to `active` (or `error`) when it lands.

## Scan intervals

Every site rescans on its own clock. Pick the cadence on the **Add website** form or change it later from the site's detail.

| Scan interval               | Reach for when …                                                    |
| --------------------------- | ------------------------------------------------------------------- |
| **Every 1 hour**            | The site changes through the day (a news desk, a live status page). |
| **Every 6 hours** (default) | A docs site or a company wiki that lands several edits a day.       |
| **Every 12 hours**          | A semi-active marketing site.                                       |
| **Every 1 day**             | A marketing site or a blog that ships once a day at most.           |
| **Every 5 days**            | Moderately static reference material.                               |
| **Every 7 days**            | A reference site that changes weekly.                               |
| **Every 30 days**           | Pages that almost never change but still need to stay current.      |

Each rescan diffs against the last fetch. Pages that have not changed are not re-indexed — only new, changed, and deleted pages trigger work, so the per-cycle load stays small even on large sites.

## Respect for the target

The crawler is designed to be a polite guest on the sites it reads.

- It honours `robots.txt`. Paths disallowed there are skipped.
- It rate-limits itself per domain so the target is not flooded.
- It identifies itself with a user agent of `Mozilla/5.0 (compatible; TaleCrawler/1.0)`, so site owners can recognise the traffic in their logs.

For sites behind authentication or sites that demand a custom user agent, the crawler is the wrong tool — configure a REST API integration instead. See [Integrations overview](/platform/integrations/overview).

## Debugging a crawl

When a crawl is not picking up the pages you expect, the diagnosis is almost always on the site detail page under **Knowledge > Websites**.

- The page list shows exactly what the crawler discovered. If a URL you expect is missing, the crawler could not reach it — usually because nothing on the homepage or the sitemap links to it.
- The error list shows pages that failed to fetch or parse, with the HTTP status and the error message. A burst of `403` or `429` is the cue that the target is blocking the crawler — rate-limit the scan, or switch to an integration with explicit credentials.
- The **Indexed** percentage on the **Websites** table shows what fraction of discovered pages made it into the index. A low number with no errors usually means the sitemap is wrong about which URLs are public.

## Removing a site

Delete a site from **Knowledge > Websites** to drop its content from the knowledge base. The removal is immediate — the next chat or agent answer cannot pull from it. The delete is recorded in the audit log, so an accidental removal is reconstructible after the fact.

## Where this fits

Crawling is the bulk-import path for public web content. The alternative — copying a help-centre into the knowledge base article by article — does not scale; pointing the crawler at the domain pulls the whole thing in one move. Once content lands, it reads exactly like an uploaded document — same search, same agents, same access controls.

For authenticated sources (a private file share, a vendor portal, a paid corpus), reach for an integration in [Integrations overview](/platform/integrations/overview) instead. For the chat-side shortcut that lets a Member add a public site without opening **Knowledge > Websites**, see [Knowledge base](/platform/workspace/knowledge-base).
