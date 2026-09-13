-- Websites remember how many of their pages the crawler could not fetch
--
-- The row already mirrors two corpus counts: `page_count` (pages the crawler
-- knows) and `crawled_page_count` (pages it ATTEMPTED — `last_crawled_at`
-- set, whether or not anything was stored). A page whose every attempt
-- failed counted as crawled, so a site whose listed URL redirected into a
-- private address the fetch guard refused read "1 of 1 crawled" with nothing
-- indexed, and neither the row nor the API said so (2026-09-12 evaluation,
-- S3-10b). The corpus now records each page's last failure
-- (knowledge-db public_web migration 00000000000010); this column carries
-- the per-site total — pages whose LAST attempt failed — to the row the app
-- and `GET /api/v1/websites/{id}` read, beside the two counts it already has.
--
-- Nullable like its siblings: a row reads NULL until the next corpus → row
-- sync stamps it (every scan and the hourly debounce do), and the API
-- answers `failedPageCount: null` for exactly that window. Rolling-deploy
-- safe: the previous image neither reads nor writes the column, and the
-- sync's UPDATE names it only on the new image.

ALTER TABLE app.websites ADD COLUMN IF NOT EXISTS failed_page_count int;
