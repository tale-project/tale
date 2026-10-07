-- migrate:up
-- Legacy checks were admitted with only 90% rendered-word coverage. The
-- unrendered response can stay unchanged while a small widget changes, so
-- neither its hash nor its HTTP validators prove the rendered page unchanged.
-- Isolate complete-coverage checks in nullable v2 columns; never backfill them.
-- Old readers see NULL legacy checks after this migration. Old writers still
-- work, but a persistent trigger discards their checks, even on NULL-to-NULL
-- updates, and invalidates v2 provenance. New writers use only v2 columns.
-- Any content write invalidates v2 too; settlement restores it after indexing.
-- In-flight old requests may already have read a check: no migration can revoke
-- that request's snapshot, but its write cannot leave a trusted legacy check.
-- Idempotent: a reapplication preserves v2 checks unless legacy data remains.

ALTER TABLE public_web.website_urls
    ADD COLUMN IF NOT EXISTS etag_v2 TEXT,
    ADD COLUMN IF NOT EXISTS last_modified_v2 TEXT,
    ADD COLUMN IF NOT EXISTS probe_hash_v2 TEXT;

CREATE OR REPLACE FUNCTION public_web.invalidate_legacy_page_check()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       OR NEW.etag IS NOT NULL
       OR NEW.last_modified IS NOT NULL
       OR NEW.probe_hash IS NOT NULL THEN
        NEW.etag_v2 := NULL;
        NEW.last_modified_v2 := NULL;
        NEW.probe_hash_v2 := NULL;
    END IF;
    NEW.etag := NULL;
    NEW.last_modified := NULL;
    NEW.probe_hash := NULL;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_legacy_page_check ON public_web.website_urls;
CREATE TRIGGER invalidate_legacy_page_check
BEFORE INSERT OR UPDATE OF etag, last_modified, probe_hash, content, content_hash
ON public_web.website_urls
FOR EACH ROW EXECUTE FUNCTION public_web.invalidate_legacy_page_check();

UPDATE public_web.website_urls
   SET etag = NULL, last_modified = NULL, probe_hash = NULL
 WHERE etag IS NOT NULL OR last_modified IS NOT NULL OR probe_hash IS NOT NULL;

-- migrate:down
-- Forward-only. Retain the guard until all legacy readers/writers are retired;
-- removing it requires an explicit reviewed migration in a later release.
