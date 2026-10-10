-- Whose runs a replay carries, kept on the replay itself: the starters of
-- every run in its lineage — the run it replays, and the runs that one
-- replays in turn. A replay copies its source's input (and, from a step,
-- its results), so an erasure of any of those people must find it; the
-- link to the source alone could not, since deleting the source (retention,
-- a person, an earlier erasure) nulls it (0191's ON DELETE SET NULL).
--
-- Rolling-deploy safe: a nullable column the previous image never selects;
-- the previous image starts no replays.
ALTER TABLE app.automation_runs
  ADD COLUMN IF NOT EXISTS replay_lineage_started_by text[];
