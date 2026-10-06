-- migrate:up
--
-- What a site's sitemap says about when a page last changed, kept on the
-- page's row so a rescan can leave an unchanged page alone. Until here the
-- crawler read `<loc>` out of a sitemap and nothing else: every scan
-- requested every page again and compared content hashes afterwards, so a
-- 700-page site scanned every six hours answered some 8,000 requests and
-- two gigabytes a scan for pages its sitemap marked unchanged for months
-- (2026-10-06).
--
--   sitemap_lastmod  the latest instant the entry's `<lastmod>` can mean, as
--                    the discovery of the last scan read it: a date-only
--                    value covers its whole day in any time zone, a time
--                    without a zone the same half day. NULL when that
--                    discovery read none for the page — no sitemap lists
--                    it, the entry carries no date or one that cannot be
--                    read, or a person started the scan — and the page is
--                    then requested as before.
--
-- A page is left alone only while its stored text was read after this
-- instant; the rule, its margin and the weekly re-read live in the frontier
-- predicate (`crawl_action.ts`). Each discovery replaces what the one before
-- recorded, so a date a sitemap no longer states never keeps a page skipped.
--
-- Pure ADD COLUMN IF NOT EXISTS: metadata-only, idempotent, rolling-safe —
-- the previous image neither reads nor writes the column.

ALTER TABLE public_web.website_urls
    ADD COLUMN IF NOT EXISTS sitemap_lastmod TIMESTAMPTZ;

-- migrate:down
-- Deliberately empty, like the baseline: dropping the column would only send
-- every scan back to requesting every page. Remove with an explicit,
-- reviewed migration instead.
