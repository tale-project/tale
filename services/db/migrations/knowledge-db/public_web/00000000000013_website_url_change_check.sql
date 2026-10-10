-- migrate:up
--
-- What a scan checks a page by, before it spends a browser on it. Until
-- here the only way the crawler could tell whether a page had changed was
-- to do everything again: fetch it, render it in a browser with every image,
-- script and stylesheet the render loads, and compare content hashes
-- afterwards. A 700-page site scanned every six hours answered some 8,000
-- requests and two gigabytes a scan for pages that had not changed in
-- months (2026-10-06).
--
-- A scan now asks for each page once, and opens the browser only for a page
-- that did change. The row keeps what that one request is judged by:
--
--   etag           the `ETag` of the response the stored text came from
--   last_modified  its `Last-Modified`; the two are sent back as
--                  `If-None-Match` / `If-Modified-Since`, and a server that
--                  answers 304 is not asked for the page at all
--   probe_hash     the hash of the text read out of the page's plain HTML,
--                  for the servers that send neither: the same text again
--                  is the same page
--
-- All three describe the response whose text the row stores AND has
-- indexed: they are written when a page settles and cleared when its
-- content is purged. They stay NULL for a page whose plain HTML does not
-- carry what a browser shows — a page built by its JavaScript — because a
-- 304 on such a shell, or the same shell text, says nothing about the
-- content; that page is rendered on every scan, as every page was.
--
-- `etag` and `last_modified` are in the baseline and went unused when the
-- render lane arrived; they are named here too so a corpus that was
-- bootstrapped without them converges. ADD COLUMN IF NOT EXISTS is
-- metadata-only, idempotent and rolling-safe — the previous image neither
-- reads nor writes the columns.
--
-- What the two columns still hold was written before the render lane, for
-- every page alike: a value there may belong to a JavaScript shell, and
-- sent back it would have that page answered 304 and never rendered again.
-- It is cleared once, here. Applied again (a corpus without a migration
-- ledger re-applies every file) it only costs each page one full visit.

ALTER TABLE public_web.website_urls
    ADD COLUMN IF NOT EXISTS etag          TEXT,
    ADD COLUMN IF NOT EXISTS last_modified TEXT,
    ADD COLUMN IF NOT EXISTS probe_hash    TEXT;

UPDATE public_web.website_urls
   SET etag = NULL, last_modified = NULL
 WHERE etag IS NOT NULL OR last_modified IS NOT NULL;

-- migrate:down
-- Deliberately empty, like the baseline: dropping the columns would only
-- send every scan back to rendering every page. Remove with an explicit,
-- reviewed migration instead.
