---
title: Website crawling
description: Configure Tale's crawler to index external websites for AI search.
---

Tale's crawler visits pages on a domain you point it at, extracts the text content, and indexes it into the knowledge base alongside your uploaded documents. The AI agent can then answer questions grounded in that content — "What's our current pricing on the website?", "Which features changed in the v3 release notes?".

This page covers the Editor/Developer side. For the end-user workflow of adding a website from chat, see [Knowledge base](/platform/workspace/knowledge-base).

## What the crawler does

1. Fetches the URL you provide and parses the HTML.
2. Discovers linked pages on the same domain.
3. Fetches each discovered page and repeats up to the domain's discovered-URL limit.
4. Converts every page to clean text (strips navigation, footers, and ads).
5. Indexes the text into the shared knowledge store with page URL as the source.

Non-HTML documents (PDF, DOCX) linked from crawled pages are fetched, converted, and indexed too.

## Scan intervals

The crawler revisits the site on a schedule you pick per site:

| Scan interval           | Best for                                 |
| ----------------------- | ---------------------------------------- |
| Every hour              | Sites with frequent content changes.     |
| Every 6 hours (default) | Documentation sites and company wikis.   |
| Every 12 hours          | Semi-active sites.                       |
| Every day               | Marketing sites and blogs.               |
| Every 5 days            | Moderately static content.               |
| Every 7 days            | Reference sites with infrequent updates. |
| Every 30 days           | Rarely changing reference material.      |

Each rescan diffs against the last fetch. Unchanged pages are not re-indexed — only new, changed, or deleted pages trigger work.

## Respecting the target site

- The crawler honours `robots.txt`. Disallowed paths are skipped.
- Requests are rate-limited (one fetch per 2 seconds per domain by default) to avoid hammering the target.
- The user agent is `TaleCrawler/1.0 (+https://tale.dev/crawler)` so site owners can identify traffic.

For crawling sites behind auth or requiring a custom user agent, configure a REST API integration instead — see [Integrations overview](/platform/integrations/overview).

## Debugging a crawl

If a crawl isn't picking up pages you expect:

- Open the site's detail page under **Knowledge > Websites**. The **Discovered pages** list shows what the crawler has found.
- The **Errors** tab lists pages that failed to fetch or parse, with the HTTP status and error message.
- Check that the expected pages are linked from the homepage or sitemap. The crawler only finds what it can reach via links.

## Removing a site

Deleting a tracked website from **Knowledge > Websites** removes all indexed content from that site. This is immediate — the AI will no longer find those pages.
