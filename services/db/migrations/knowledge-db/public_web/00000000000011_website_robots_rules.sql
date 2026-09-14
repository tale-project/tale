-- migrate:up
--
-- The robots.txt `Disallow` rules (`User-agent: *`) the last scan read, kept
-- on the website row so every part of a scan judges by the same rules: the
-- discovery walk, every continuation link, the links a rendered page
-- reveals, and the pass that retires pages a rule covers. Until here the
-- rules lived in one function's local variable — the sitemap and link-walk
-- legs honoured them, the rendered-page admission never saw them, so a
-- site whose robots.txt disallowed its legal pages had them fetched,
-- indexed and served the moment a rendered page linked to them
-- (2026-09-14 evaluation, h5). A robots.txt that cannot be fetched keeps
-- the last known rules instead of crawling unruled.
--
--   robots_disallow    JSON array of the `Disallow` prefixes for `*`, as
--                      parsed; `[]` for a site without rules; NULL before
--                      the first scan of this release
--   robots_fetched_at  when the rules were last read from the site
--
-- Pure ADD COLUMN IF NOT EXISTS: metadata-only, idempotent, rolling-safe —
-- the previous image neither reads nor writes the columns.

ALTER TABLE public_web.websites
    ADD COLUMN IF NOT EXISTS robots_disallow   JSONB,
    ADD COLUMN IF NOT EXISTS robots_fetched_at TIMESTAMPTZ;

-- migrate:down
-- Deliberately empty, like the baseline: the columns are the record of what
-- the site asked the crawler not to fetch. Remove with an explicit, reviewed
-- migration instead.
