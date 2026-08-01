-- migrate:up
--
-- URL-list sources: a websites row may now be a curated list of URLs instead
-- of a crawled site. `kind` discriminates — 'site' discovers pages via
-- robots/sitemaps/links as before, 'list' fetches exactly the URLs an
-- operator registered. `website_urls.listed` marks rows that came from an
-- operator's list rather than discovery; on a 'site' row they act as extra
-- seeds. Kind only ever widens ('list' -> 'site'): registering the full site
-- upgrades the row, registering a list on a crawled site merely adds seeds.
-- Additive and idempotent — a no-op wherever it already ran in full.

ALTER TABLE public_web.websites
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'site';

ALTER TABLE public_web.websites
    DROP CONSTRAINT IF EXISTS websites_kind_check;
ALTER TABLE public_web.websites
    ADD CONSTRAINT websites_kind_check CHECK (kind IN ('site', 'list'));

ALTER TABLE public_web.website_urls
    ADD COLUMN IF NOT EXISTS listed BOOLEAN NOT NULL DEFAULT FALSE;

-- migrate:down
-- Deliberately empty, like the baseline: `kind` and `listed` hold operator
-- intent the moment they exist, and dropping them would collapse curated
-- lists back into crawled sites. Remove with an explicit, reviewed migration
-- instead.
