-- migrate:up
-- Per-org website membership layer.
--
-- websites / website_urls / chunks / page_paragraph_hashes remain
-- deployment-shared content storage (one canonical fetch + embed per
-- domain, independent of which org requested it). This junction table
-- tracks WHICH orgs have asked the crawler to track a given domain.
--
-- Register: insert (domain, org_slug) ON CONFLICT DO NOTHING. First
--   membership for a never-seen domain implies UPSERT into websites.
-- Delete: delete the (domain, org_slug) row; the website itself is
--   only purged when no memberships remain (ref-counted).
-- Search/list: JOIN this table filtered by current X-Tale-Org so org A
--   only sees domains it registered (or another member of org A did).
--
-- Backfill: every existing website row is treated as belonging to the
--   'default' org, which is the only org in use at the demo stage.
--   ON CONFLICT DO NOTHING keeps the migration idempotent on re-run.

CREATE TABLE IF NOT EXISTS public_web.website_org_memberships (
    domain   TEXT        NOT NULL REFERENCES public_web.websites(domain) ON DELETE CASCADE,
    org_slug TEXT        NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (domain, org_slug)
);

CREATE INDEX IF NOT EXISTS idx_website_org_memberships_by_org
    ON public_web.website_org_memberships (org_slug);

INSERT INTO public_web.website_org_memberships (domain, org_slug)
SELECT domain, 'default'
FROM public_web.websites
ON CONFLICT DO NOTHING;

-- migrate:down
DROP TABLE IF EXISTS public_web.website_org_memberships;
