-- Which text named the agent on a `mention` run of a project agent.
--
-- Two texts can @mention a project agent into work: a comment posted on the
-- task, and the task's description (on create, and the mentions an edit
-- adds). A comment's body is the run's `feedback`, the delta the turn
-- addresses first. A description kick stores NO copy: the turn reads the
-- description as it stands when it starts, which may be minutes after the
-- kick (a queued run, a capacity park). A copy taken at kick time would put
-- the text an edit replaced beside the edited description, as an instruction
-- that outranks it. The column tells the turn host which of the two to read,
-- and how to phrase it: a resumed conversation does not re-read the brief,
-- so it is handed the description as the edit that named the agent.
--
-- NULL on every run that no mention started (manual, auto_retry), and on the
-- rows written before this column existed (all comment kicks, read as such).
--
-- Rolling-deploy safe: a nullable column. The previous image neither writes
-- nor reads it; its comment kicks leave it NULL, which the checks admit.

ALTER TABLE app.project_agent_runs
  ADD COLUMN mention_source text,
  ADD CONSTRAINT project_agent_runs_mention_source_kind
    CHECK (mention_source IN ('comment', 'description')),
  -- Only a mention names a text; a manual or retry kick leaves it NULL.
  ADD CONSTRAINT project_agent_runs_mention_source_trigger
    CHECK (mention_source IS NULL OR trigger = 'mention'),
  -- The rule the column exists for: a description kick carries no copy.
  ADD CONSTRAINT project_agent_runs_mention_source_no_snapshot
    CHECK (mention_source IS DISTINCT FROM 'description' OR feedback IS NULL);
