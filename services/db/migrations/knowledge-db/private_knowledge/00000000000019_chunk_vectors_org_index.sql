-- migrate:up
--
-- An HNSW index per organization over its own vectors, instead of one over
-- every organization's.
--
-- Until here each `chunk_vectors_<width>` (migration 15) had one HNSW index
-- over the vectors of every organization on the database, and a dense
-- search filtered its organization only after the index scan. A search past
-- the exact-scan bound walked the nearest vectors of every tenant, and
-- `hnsw.iterative_scan` gives up after `hnsw.max_scan_tuples`: a small
-- organization beside a large one whose vectors lie nearer the query got
-- fewer hits than it has, or none.
--
-- Now a vector row carries its organization:
--
--   org_slug   the `org_slug` of the row's chunk, set by the trigger below
--              on every write that could change it, whatever the writer
--              sent; never NULL
--
-- and an organization with more vectors of a width than the platform's
-- exact-scan bound (`EXACT_DENSE_SCAN_MAX_CHUNKS`,
-- services/platform/backend/core/knowledge/corpus.ts; a guard test holds
-- the two equal) has an index of its own on that width's table:
--
--   idx_pk_chunk_vectors_<width>_org_<md5(org_slug)>
--       USING hnsw (embedding vector_cosine_ops) WHERE org_slug = '<org>'
--
-- A dense search names its organization on the vectors (`v.org_slug`), so
-- Postgres scans that organization's index and no other tenant's vectors.
-- An organization at or under the bound never reaches an index: its scope
-- count cannot pass the bound, and its scope is scanned exactly. The indexer
-- builds an organization's index when it first passes the bound
-- (`ensure_chunk_vectors_org_index`, after a document completes); the
-- teardown drops them (`drop_chunk_vectors_org_indexes`).
--
-- Rolling-safe: no writer names `org_slug` (not the previous image, not
-- migration 15's mirror trigger); the trigger takes it from the chunk. The
-- shared indexes are dropped before the backfill, so that it rewrites the
-- rows without feeding an index this migration replaces. The previous
-- image's search names no organization on the vectors and uses none of the
-- new indexes: past the bound it scans the organization's own vectors
-- exactly (`chunks` by organization, the vectors by primary key) — the same
-- hits, slower — during the roll, and after a rollback.
--
-- The backfill rewrites every vector row once. Unlike `core_offset`
-- (migration 17), the column cannot wait for a re-index: a vector without
-- its organization is out of every search this release makes. The indexes
-- built below together cost about what the shared ones they replace cost.
-- Both take time in proportion to the corpus, at container start, and the
-- vector tables stay locked until the migration commits: a platform still
-- running meanwhile waits for it before it reads or writes a vector.
--
-- Idempotent: every statement converges on a re-run.

DO $$
DECLARE
    w integer;
BEGIN
    FOREACH w IN ARRAY ARRAY[256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096] LOOP
        EXECUTE format(
            'ALTER TABLE private_knowledge.chunk_vectors_%s
                 ADD COLUMN IF NOT EXISTS org_slug TEXT',
            w
        );
    END LOOP;
END;
$$;

-- A vector's organization is its chunk's, whatever the writer sent: set on
-- every insert, and on every update that names it or moves the row to
-- another chunk. An update of the embedding alone (the writers' upsert)
-- keeps it. A vector of no chunk is refused as the foreign key refuses it.
CREATE OR REPLACE FUNCTION private_knowledge.stamp_chunk_vector_org()
RETURNS trigger AS $$
BEGIN
    NEW.org_slug := (
        SELECT c.org_slug FROM private_knowledge.chunks c WHERE c.id = NEW.chunk_id
    );
    IF NEW.org_slug IS NULL THEN
        RAISE EXCEPTION 'chunk % is not in private_knowledge.chunks', NEW.chunk_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    w integer;
BEGIN
    FOREACH w IN ARRAY ARRAY[256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096] LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS chunk_vectors_%s_org
                 ON private_knowledge.chunk_vectors_%s',
            w, w
        );
        EXECUTE format(
            'CREATE TRIGGER chunk_vectors_%s_org
                 BEFORE INSERT OR UPDATE OF chunk_id, org_slug
                 ON private_knowledge.chunk_vectors_%s
                 FOR EACH ROW
                 EXECUTE FUNCTION private_knowledge.stamp_chunk_vector_org()',
            w, w
        );
    END LOOP;
END;
$$;

-- The shared indexes, then the rows they would have been fed.
DO $$
DECLARE
    w integer;
BEGIN
    FOREACH w IN ARRAY ARRAY[256, 384, 512, 768, 1024, 1536] LOOP
        EXECUTE format(
            'DROP INDEX IF EXISTS private_knowledge.idx_pk_chunk_vectors_%s_hnsw',
            w
        );
    END LOOP;
    FOREACH w IN ARRAY ARRAY[256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096] LOOP
        EXECUTE format(
            'UPDATE private_knowledge.chunk_vectors_%s v
                SET org_slug = c.org_slug
               FROM private_knowledge.chunks c
              WHERE c.id = v.chunk_id
                AND v.org_slug IS NULL',
            w
        );
        EXECUTE format(
            'ALTER TABLE private_knowledge.chunk_vectors_%s
                 ALTER COLUMN org_slug SET NOT NULL',
            w
        );
    END LOOP;
END;
$$;

-- Within Postgres's 63 bytes for every width and slug: the slug itself may
-- be longer, and may hold what an identifier cannot.
CREATE OR REPLACE FUNCTION private_knowledge.chunk_vectors_org_index_name(
    width integer,
    org   text
) RETURNS text AS $$
    SELECT format('idx_pk_chunk_vectors_%s_org_%s', width, md5(org))
$$ LANGUAGE sql IMMUTABLE;

-- Build the organization's index on the table of `width` once it has more
-- than `bound` vectors there; true when this call built it. A no-op for a
-- width pgvector cannot index (a `vector` above 2000 dimensions: those
-- tables are scanned in sequence, migration 15) and once the index exists.
-- The build holds writes to that one table (a SHARE lock) while it runs:
-- seconds, at the bound. One build at a time per database.
CREATE OR REPLACE FUNCTION private_knowledge.ensure_chunk_vectors_org_index(
    width integer,
    org   text,
    bound integer
) RETURNS boolean AS $$
DECLARE
    index_name text := private_knowledge.chunk_vectors_org_index_name(width, org);
    vectors    bigint;
BEGIN
    IF width > 2000 THEN
        RETURN false;
    END IF;
    IF to_regclass(format('private_knowledge.%I', index_name)) IS NOT NULL THEN
        RETURN false;
    END IF;
    EXECUTE format(
        'SELECT count(*) FROM (
             SELECT 1 FROM private_knowledge.chunks c
               JOIN private_knowledge.chunk_vectors_%s v ON v.chunk_id = c.id
              WHERE c.org_slug = $1
              LIMIT $2
         ) counted',
        width
    ) INTO vectors USING org, bound + 1;
    IF vectors <= bound THEN
        RETURN false;
    END IF;
    PERFORM pg_advisory_xact_lock(72085012);
    IF to_regclass(format('private_knowledge.%I', index_name)) IS NOT NULL THEN
        RETURN false;
    END IF;
    EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON private_knowledge.chunk_vectors_%s
              USING hnsw (embedding vector_cosine_ops)
               WITH (m = 16, ef_construction = 64)
              WHERE org_slug = %L',
        index_name, width, org
    );
    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Drop the organization's indexes, on the table of every width there is;
-- how many there were.
CREATE OR REPLACE FUNCTION private_knowledge.drop_chunk_vectors_org_indexes(
    org text
) RETURNS integer AS $$
DECLARE
    w          integer;
    index_name text;
    dropped    integer := 0;
BEGIN
    FOR w IN
        SELECT substring(t.relname FROM '^chunk_vectors_([0-9]+)$')::integer
          FROM pg_class t
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'private_knowledge'
           AND t.relkind = 'r'
           AND t.relname ~ '^chunk_vectors_[0-9]+$'
    LOOP
        index_name := private_knowledge.chunk_vectors_org_index_name(w, org);
        IF to_regclass(format('private_knowledge.%I', index_name)) IS NOT NULL THEN
            EXECUTE format('DROP INDEX IF EXISTS private_knowledge.%I', index_name);
            dropped := dropped + 1;
        END IF;
    END LOOP;
    RETURN dropped;
END;
$$ LANGUAGE plpgsql;

-- The organizations already past the bound.
DO $$
DECLARE
    w   integer;
    org text;
BEGIN
    FOREACH w IN ARRAY ARRAY[256, 384, 512, 768, 1024, 1536] LOOP
        FOR org IN EXECUTE format(
            'SELECT org_slug FROM private_knowledge.chunk_vectors_%s
              GROUP BY org_slug
             HAVING count(*) > 5000',
            w
        ) LOOP
            PERFORM private_knowledge.ensure_chunk_vectors_org_index(w, org, 5000);
        END LOOP;
    END LOOP;
END;
$$;

-- migrate:down
-- Deliberately empty, like the baseline.
