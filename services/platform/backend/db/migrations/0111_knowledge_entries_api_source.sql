-- Knowledge entries written over the REST door read `source = 'api'`.
--
-- `app.knowledge_entries.source` names where a fact came from: 'chat' (a
-- conversation the assistant captured it from) or 'manual' (a person typed
-- it in the Knowledge entries form). The REST door (`POST/PATCH
-- /api/v1/knowledge-entries`) stamped 'manual' too, so an operator reading
-- the table's Source column could not tell an API-imported fact from a
-- hand-typed one (2026-09-19 evaluation, K5-3). The CHECK constraint 0027
-- created is widened to admit 'api'; nothing is backfilled — rows the door
-- wrote before this release stay 'manual', honestly the value they carried.
--
-- Rolling-deploy safe: the previous image writes only 'chat' and 'manual',
-- which the widened constraint still admits; the constraint 0027 created
-- was unnamed, so it carries Postgres's generated name.
ALTER TABLE app.knowledge_entries
  DROP CONSTRAINT IF EXISTS knowledge_entries_source_check;
ALTER TABLE app.knowledge_entries
  ADD CONSTRAINT knowledge_entries_source_check
    CHECK (source IN ('chat', 'manual', 'api'));
