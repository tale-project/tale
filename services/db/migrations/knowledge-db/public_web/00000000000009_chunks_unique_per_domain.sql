-- migrate:up
--
-- A chunk is unique per (domain, url, chunk_index), not per (url, chunk_index).
-- The crawler treats a domain and its www/apex sibling as ONE site and follows
-- redirects between the two, so two registered domains — the corpus is shared
-- across organizations and keyed by domain, and an organization may not even
-- know another tracks the sibling — can legitimately hold chunks for the same
-- URL. The index lane deletes and re-inserts a page's chunks by (domain, url);
-- under the old key the second domain's insert collided with the first's rows
-- and the page never indexed for it. The foreign key already scopes a chunk
-- to its own (domain, url) frontier row, so the wider key is the rule the
-- rows already live by.
--
-- The baseline's table-level UNIQUE carries PostgreSQL's generated name; a
-- unique index expresses the same rule and, unlike a table constraint, can be
-- created IF NOT EXISTS — so the file converges on re-run. Additive: every row
-- that satisfied the narrower key satisfies the wider one.

ALTER TABLE public_web.chunks
    DROP CONSTRAINT IF EXISTS chunks_url_chunk_index_key;

CREATE UNIQUE INDEX IF NOT EXISTS chunks_domain_url_chunk_index_key
    ON public_web.chunks (domain, url, chunk_index);

-- migrate:down
-- Deliberately empty, like the baseline: restoring the narrower key would fail
-- on any corpus that already holds one URL under two domains, and dropping the
-- rows would discard indexed knowledge. Remove with an explicit, reviewed
-- migration instead.
