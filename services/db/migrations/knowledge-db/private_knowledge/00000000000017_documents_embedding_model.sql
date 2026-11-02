-- migrate:up
--
-- Which embedding model made a document's vectors.
--
-- Vectors are kept per width (`chunk_vectors_<width>`, migration 15), so an
-- organization that moves to a model of another width finds none of a
-- document's vectors and embeds it again. A move to another model of the
-- SAME width found them all: the document read as fully indexed, and its
-- vectors — another model's, which no query the new model embeds can be
-- compared with — stayed in search by meaning until its content changed.
--
--   embedding_model  the model whose vectors the document's chunks hold, by
--                    the name the organization's embedding settings state.
--                    NULL on a document indexed before this release: it is
--                    taken to be the model the settings state, and saving or
--                    removing the model stamps it with that model first. An
--                    empty name marks vectors whose model is no longer known;
--                    no model the settings can state matches it.
--
-- A document whose name differs from the model the settings state is
-- embedded again from its first chunk, and its vectors are not searched
-- meanwhile. The provider is no part of it: the same model reached through
-- another provider makes the same vectors.
--
-- ADD COLUMN without a default: metadata-only, idempotent, rolling-safe —
-- the previous image never writes the column. A document it indexes first
-- during the roll reads NULL and passes for the model stated, so a model
-- saved during the roll can leave it with the old model's vectors until it
-- is indexed again. One it indexes again keeps the name it had; when that
-- is no longer the model stated, the daily corpus reconcile puts it back in
-- the queue.

ALTER TABLE private_knowledge.documents
    ADD COLUMN IF NOT EXISTS embedding_model TEXT;

-- migrate:down
-- Deliberately empty, like the baseline.
