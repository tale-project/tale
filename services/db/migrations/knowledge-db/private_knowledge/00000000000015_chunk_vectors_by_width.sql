-- migrate:up
--
-- A table of vectors per width, beside the chunks.
--
-- Until here a chunk carried its vector in `chunks.embedding`, one column of
-- ONE declared width for the whole database: the first embedding model used
-- narrowed the column, and from then on every model of another width was
-- refused. An organization could not move to a model of another width
-- without a database of its own, even when the corpus was empty, and
-- organizations sharing a database had to agree on one width.
--
-- Now every supported width has its table, created here and never at
-- runtime:
--
--   chunk_vectors_<width>   chunk_id   the chunk the vector embeds (1:1)
--                           embedding  vector(<width>)
--
-- A chunk's text, its keyword index and its scope stamps stay where they
-- are; only the vector moved. The platform writes a vector to the table of
-- the width the organization's model states and searches that table alone,
-- so vectors of different widths never meet. A row here belongs to the
-- organization of its chunk and is only ever read through it; deleting a
-- chunk deletes its vectors (ON DELETE CASCADE).
--
-- The widths are the platform's `KNOWLEDGE_VECTOR_WIDTHS`
-- (packages/shared/src/schemas/knowledge.ts); a guard test holds the two
-- lists equal. Adding a width is a new numbered migration that creates its
-- table in both corpus schemas.
--
-- Rolling-safe: `chunks.embedding` and its index stay for one release, and
-- the previous image keeps reading and writing them. A trigger copies what
-- it writes there into the table of that width, so a document indexed by
-- the previous image during the roll is searchable by the new one. The new
-- image writes the old column as well whenever the column is declared at
-- the width it is writing (the platform's `legacyColumnWidth`) — the one
-- width the previous image can read — so what it indexes is searchable by
-- the previous image during the roll, and after a rollback. A later
-- migration drops the column, its index, the trigger and
-- `create_chunks_hnsw_index()` together, with that write.
--
-- The existing vectors are copied once, below. That copy and the index
-- build over it take time in proportion to the corpus (an index over a
-- million 1536-wide vectors is minutes, more with a small
-- `maintenance_work_mem`), and the vectors are stored twice until the old
-- column is dropped. A corpus whose column is declared at a width outside
-- the list keeps its vectors in the old column and gets a warning: its
-- organizations have to choose a listed width and index again.
--
-- Idempotent: every statement converges on a re-run.

DO $$
DECLARE
    w integer;
BEGIN
    FOREACH w IN ARRAY ARRAY[256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096] LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS private_knowledge.chunk_vectors_%s (
                 chunk_id  BIGINT PRIMARY KEY
                           REFERENCES private_knowledge.chunks(id) ON DELETE CASCADE,
                 embedding vector(%s) NOT NULL
             )',
            w, w
        );
    END LOOP;
END;
$$;

-- What the previous image writes into `chunks.embedding` during the roll.
-- Before the copy, so no vector written while the copy runs is missed.
--
-- The trigger names no column — neither `UPDATE OF embedding` nor a WHEN
-- on it — because either makes the column part of the trigger's
-- definition, and the previous image's first index on a database it has
-- not pinned yet alters the column's type (`ALTER COLUMN embedding TYPE
-- vector(<width>)`), which Postgres refuses for such a column. The
-- function returns at once for a row with no vector, or an unchanged one.
CREATE OR REPLACE FUNCTION private_knowledge.mirror_legacy_chunk_embedding()
RETURNS trigger AS $$
DECLARE
    w integer;
BEGIN
    IF NEW.embedding IS NULL THEN
        RETURN NULL;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.embedding IS NOT DISTINCT FROM NEW.embedding THEN
        RETURN NULL;
    END IF;
    w := vector_dims(NEW.embedding);
    IF w = ANY (ARRAY[256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096]) THEN
        EXECUTE format(
            'INSERT INTO private_knowledge.chunk_vectors_%s (chunk_id, embedding)
             VALUES ($1, $2)
             ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding',
            w
        ) USING NEW.id, NEW.embedding;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chunks_mirror_legacy_embedding ON private_knowledge.chunks;
CREATE TRIGGER chunks_mirror_legacy_embedding
    AFTER INSERT OR UPDATE ON private_knowledge.chunks
    FOR EACH ROW
    EXECUTE FUNCTION private_knowledge.mirror_legacy_chunk_embedding();

-- The existing vectors. A column declared at one width holds that width
-- alone, so it is copied in one pass; an undeclared column (`vector`) may
-- hold any, and each row goes by its own width.
DO $$
DECLARE
    widths   integer[] := ARRAY[256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096];
    declared text;
    w        integer;
BEGIN
    SELECT format_type(atttypid, atttypmod) INTO declared
      FROM pg_attribute
     WHERE attrelid = 'private_knowledge.chunks'::regclass
       AND attname = 'embedding'
       AND NOT attisdropped;

    IF declared IS NULL THEN
        RETURN;
    END IF;

    IF declared ~ '^vector\(\d+\)$' THEN
        w := substring(declared FROM '\d+')::integer;
        IF w = ANY (widths) THEN
            EXECUTE format(
                'INSERT INTO private_knowledge.chunk_vectors_%s (chunk_id, embedding)
                 SELECT id, embedding FROM private_knowledge.chunks
                  WHERE embedding IS NOT NULL
                 ON CONFLICT (chunk_id) DO NOTHING',
                w
            );
        ELSIF EXISTS (SELECT 1 FROM private_knowledge.chunks WHERE embedding IS NOT NULL) THEN
            RAISE WARNING 'private_knowledge.chunks.embedding is % - a width this release has no table for. Its vectors stay in that column and are not searched; the organizations using this database have to choose a supported vector width and index their documents again.', declared;
        END IF;
    ELSIF declared = 'vector' THEN
        FOREACH w IN ARRAY widths LOOP
            EXECUTE format(
                'INSERT INTO private_knowledge.chunk_vectors_%s (chunk_id, embedding)
                 SELECT id, embedding FROM private_knowledge.chunks
                  WHERE embedding IS NOT NULL AND vector_dims(embedding) = %s
                 ON CONFLICT (chunk_id) DO NOTHING',
                w, w
            );
        END LOOP;
    END IF;
END;
$$;

-- The approximate index, after the copy (one build over the loaded rows is
-- far faster than maintaining it row by row). pgvector cannot index a
-- `vector` above 2000 dimensions: the wider tables are scanned in sequence,
-- as a wider column was before.
DO $$
DECLARE
    w integer;
BEGIN
    FOREACH w IN ARRAY ARRAY[256, 384, 512, 768, 1024, 1536] LOOP
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_pk_chunk_vectors_%s_hnsw
                 ON private_knowledge.chunk_vectors_%s
              USING hnsw (embedding vector_cosine_ops)
               WITH (m = 16, ef_construction = 64)',
            w, w
        );
    END LOOP;
END;
$$;

-- migrate:down
-- Deliberately empty, like the baseline: dropping the tables would discard
-- every embedding. Remove with an explicit, reviewed migration instead.
