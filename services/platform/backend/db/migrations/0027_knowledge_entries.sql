-- 0.5 app migration 0027: user-contributed knowledge entries — small
-- markdown facts keyed by a normalized topic. At most ONE row per
-- (org, topic_key) is 'active'; a write to an existing topic supersedes the
-- previous version (the chain stays for audit/undo). The active row is
-- backed by a documents row (source_provider 'knowledge') so indexing,
-- agent scoping, citations, and deletion ride the document pipeline.

CREATE TABLE app.knowledge_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  org_id text NOT NULL,
  topic text NOT NULL,
  topic_key text NOT NULL,
  content text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'superseded')),
  document_id text,
  source text NOT NULL CHECK (source IN ('chat', 'manual')),
  source_thread_id text,
  source_message_id text,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  superseded_by text,
  superseded_at_ms bigint,
  deleted_at_ms bigint
);

CREATE INDEX knowledge_entries_org_topic
  ON app.knowledge_entries (org_id, topic_key, status);
CREATE INDEX knowledge_entries_org_status
  ON app.knowledge_entries (org_id, status, seq DESC);
CREATE INDEX knowledge_entries_document
  ON app.knowledge_entries (document_id)
  WHERE document_id IS NOT NULL;
