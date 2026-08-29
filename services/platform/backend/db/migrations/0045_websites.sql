-- Tracked websites (the 0.4 `websites` table): one row per (org, domain)
-- registered for crawling into the shared `public_web` corpus. The corpus
-- side (websites/website_urls/website_org_memberships/chunks/
-- page_paragraph_hashes) lives in the KNOWLEDGE database, keyed by org slug;
-- this row is the org-facing registration, status mirror, and — critically —
-- the failure ledger that stays reachable when the knowledge database itself
-- is the problem (scan_scheduling.ts's bookkeeping rides `metadata`).

CREATE TABLE app.websites (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  domain text NOT NULL,
  -- 'site' = crawled whole, 'list' = curated URL list; NULL reads as 'site'.
  kind text CHECK (kind IN ('site', 'list')),
  title text,
  description text,
  scan_interval text NOT NULL,
  last_scanned_at_ms bigint,
  status text
    CHECK (status IN ('idle', 'scanning', 'active', 'error', 'deleting')),
  page_count int,
  crawled_page_count int,
  metadata jsonb,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  UNIQUE (org_id, domain)
);

CREATE INDEX websites_org_status ON app.websites (org_id, status);
