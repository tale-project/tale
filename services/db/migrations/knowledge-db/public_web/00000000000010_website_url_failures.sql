-- migrate:up
--
-- A page the crawler could not store now says why. Until here a failed
-- attempt only bumped `fail_count` and stamped `last_crawled_at`, so a
-- redirect into a private address the fetch guard refused, a DNS miss, a
-- timeout, a 500, a render the sandboxed browser gave up on and a linked
-- document no extractor could read all left the same silent row: status
-- `discovered`, no words, no error — indistinguishable from a page nobody
-- has fetched yet, and from the API nobody could tell whether a refused
-- redirect was blocked or dialed (2026-09-12 evaluation, S3-10b).
--
--   last_error       the last failure's message, capped by the writer
--   last_error_kind  its kind: a safe-fetch refusal kind (`insecure_public_http`,
--                    `private_ip`, `dns_failed`, `timeout`, …) or the crawl's own
--                    `http_error` / `render_failed` / `extraction_failed`
--   last_error_at    when it happened
--
-- All three are cleared the moment a fetch stores the page again (or the
-- scan visits it without storing — a skipped binary), so a row with them set
-- is a row whose LAST attempt failed; `fail_count` says how many in a row.
-- No CHECK on the kind: the set follows the fetch client's refusal kinds and
-- is declared once in code (`PAGE_FAILURE_KINDS`), where the OpenAPI enum
-- reads it too. Pure ADD COLUMN IF NOT EXISTS: metadata-only, idempotent, a
-- no-op wherever it already ran in full.

ALTER TABLE public_web.website_urls
    ADD COLUMN IF NOT EXISTS last_error      TEXT,
    ADD COLUMN IF NOT EXISTS last_error_kind TEXT,
    ADD COLUMN IF NOT EXISTS last_error_at   TIMESTAMPTZ;

-- migrate:down
-- Deliberately empty, like the baseline: the columns hold the only record of
-- why a page is missing from the index, and dropping them would put the
-- silence back. Remove with an explicit, reviewed migration instead.
