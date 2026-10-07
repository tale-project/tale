-- migrate:up
--
-- A table of vectors per width, beside the web chunks — the web corpus's
-- half of private_knowledge/00000000000015_chunk_vectors_by_width.sql, which
-- says why and how.
--
--   chunk_vectors_<width>   chunk_id   the chunk the vector embeds (1:1)
--                           embedding  vector(<width>)
--
-- A site's chunks are shared by every organization that registered its
-- domain, and those organizations may use embedding models of different
-- widths. Each gets its own vectors for the same chunks, in the table of
-- its width: a scan embeds the chunks that have none at its organization's
-- width and leaves the other widths alone. A page whose text changed is
-- chunked again, which removes its vectors of every width (ON DELETE
-- CASCADE); each organization's next scan embeds the new chunks.
--
-- Rolling-safe and idempotent the same way: `chunks.embedding` and its
-- index stay for one release, a trigger copies what the previous image
-- writes there, the new image writes there too at the column's declared
-- width, and the existing vectors are copied once, below.

DO $$
DECLARE
    w integer;
BEGIN
    FOREACH w IN ARRAY ARRAY[256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096] LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS public_web.chunk_vectors_%s (
                 chunk_id  BIGINT PRIMARY KEY
                           REFERENCES public_web.chunks(id) ON DELETE CASCADE,
                 embedding vector(%s) NOT NULL
             )',
            w, w
        );
    END LOOP;
END;
$$;

-- What the previous image writes into `chunks.embedding` during the roll.
-- The trigger names no column, for the reason the private_knowledge
-- migration gives: the previous image alters the column's type to pin it.
CREATE OR REPLACE FUNCTION public_web.mirror_legacy_chunk_embedding()
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
            'INSERT INTO public_web.chunk_vectors_%s (chunk_id, embedding)
             VALUES ($1, $2)
             ON CONFLICT (chunk_id) DO UPDATE SET embedding = EXCLUDED.embedding',
            w
        ) USING NEW.id, NEW.embedding;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chunks_mirror_legacy_embedding ON public_web.chunks;
CREATE TRIGGER chunks_mirror_legacy_embedding
    AFTER INSERT OR UPDATE ON public_web.chunks
    FOR EACH ROW
    EXECUTE FUNCTION public_web.mirror_legacy_chunk_embedding();

-- The existing vectors: one pass for a column declared at a width, each row
-- by its own width for an undeclared one.
DO $$
DECLARE
    widths   integer[] := ARRAY[256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096];
    declared text;
    w        integer;
BEGIN
    SELECT format_type(atttypid, atttypmod) INTO declared
      FROM pg_attribute
     WHERE attrelid = 'public_web.chunks'::regclass
       AND attname = 'embedding'
       AND NOT attisdropped;

    IF declared IS NULL THEN
        RETURN;
    END IF;

    IF declared ~ '^vector\(\d+\)$' THEN
        w := substring(declared FROM '\d+')::integer;
        IF w = ANY (widths) THEN
            EXECUTE format(
                'INSERT INTO public_web.chunk_vectors_%s (chunk_id, embedding)
                 SELECT id, embedding FROM public_web.chunks
                  WHERE embedding IS NOT NULL
                 ON CONFLICT (chunk_id) DO NOTHING',
                w
            );
        ELSIF EXISTS (SELECT 1 FROM public_web.chunks WHERE embedding IS NOT NULL) THEN
            RAISE WARNING 'public_web.chunks.embedding is % - a width this release has no table for. Its vectors stay in that column and are not searched; the organizations using this database have to choose a supported vector width and scan their websites again.', declared;
        END IF;
    ELSIF declared = 'vector' THEN
        FOREACH w IN ARRAY widths LOOP
            EXECUTE format(
                'INSERT INTO public_web.chunk_vectors_%s (chunk_id, embedding)
                 SELECT id, embedding FROM public_web.chunks
                  WHERE embedding IS NOT NULL AND vector_dims(embedding) = %s
                 ON CONFLICT (chunk_id) DO NOTHING',
                w, w
            );
        END LOOP;
    END IF;
END;
$$;

-- The approximate index, after the copy; none above pgvector's 2000
-- dimensions.
DO $$
DECLARE
    w integer;
BEGIN
    FOREACH w IN ARRAY ARRAY[256, 384, 512, 768, 1024, 1536] LOOP
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_pw_chunk_vectors_%s_hnsw
                 ON public_web.chunk_vectors_%s
              USING hnsw (embedding vector_cosine_ops)
               WITH (m = 16, ef_construction = 64)',
            w, w
        );
    END LOOP;
END;
$$;

-- migrate:down
-- Deliberately empty, like the baseline: dropping the tables would discard
-- every embedding of every crawled page.
