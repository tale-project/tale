-- Knowledge entries an agent writes read `source = 'agent'`.
--
-- `app.knowledge_entries.source` names where a fact came from: 'chat' (a
-- conversation the assistant captured it from), 'manual' (a person typed it
-- in the Knowledge entries form) or 'api' (the REST door, 0111). A project
-- agent or an automation's agent step granted the `knowledge_entry_write`
-- workspace tool now adds facts and new versions of them; those rows carry
-- 'agent', so a person reading the table's Source column, and every agent
-- reading the entry back, can tell an agent-written fact from one a person
-- curated. The writing agent is named in `created_by` (a project agent's id,
-- or `automation:<name>`), as a person's user id is for the other lanes.
--
-- The CHECK constraint 0111 widened is widened once more to admit 'agent';
-- nothing is backfilled — no row carried this lane before.
--
-- Rolling-deploy safe: the previous image writes only 'chat', 'manual' and
-- 'api', which the widened constraint still admits, and it never reads the
-- new value as anything but a string.
ALTER TABLE app.knowledge_entries
  DROP CONSTRAINT IF EXISTS knowledge_entries_source_check;
ALTER TABLE app.knowledge_entries
  ADD CONSTRAINT knowledge_entries_source_check
    CHECK (source IN ('chat', 'manual', 'api', 'agent'));
