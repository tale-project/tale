-- A step-by-step record of every automation run: one row per unit of work —
-- a node as a whole, each forEach item, each repeatUntil pass, every node of
-- a subautomation it walked — and two for the run itself, its input
-- (`__start`) and its output (`__end`). It is what a person debugging a run
-- reads: when each unit started and ended, what it received and returned
-- (secrets withheld, values cut to a bound), which conditions decided what
-- and with which values, what it waited for and who decided, how often it
-- was attempted, and why it failed.
--
-- Display state only: the run's checkpoints remain what a resumed run reads,
-- and nothing here is ever read back to decide execution. A row is written in
-- the same transaction as the progress it describes, fenced by the run's
-- claim epoch, and replaced whole by the walker that holds the run — a
-- resumed run updates its rows, it never duplicates them, and an older
-- walker's late write never overwrites a newer one's.
--
-- Rows leave with their run (cascade) through deletion, retention and
-- erasure; organization teardown finds the table by its `org_id` column.
--
-- Rolling-deploy safe: a new table and a defaulted column the previous image
-- never reads; the runs it steps simply record nothing.
CREATE TABLE IF NOT EXISTS app.automation_node_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL REFERENCES app.automation_runs (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  -- The unit's step: its id at the top level, `<parent>[<item>:<pass>]/<id>`
  -- inside a subautomation; `__start` and `__end` for the run's input and
  -- output.
  path text NOT NULL,
  -- -1: the step as a whole, and no repeat pass.
  item_index int NOT NULL DEFAULT -1,
  pass int NOT NULL DEFAULT -1,
  node_id text NOT NULL,
  node_type text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('running', 'waiting', 'ok', 'skipped', 'failed')),
  started_at_ms bigint,
  ended_at_ms bigint,
  -- Time spent working, summed over the turns it ran in; waits are not in it.
  active_ms int NOT NULL DEFAULT 0,
  attempt int NOT NULL DEFAULT 1,
  skip_reason text CHECK (skip_reason IN ('when', 'else', 'upstream', 'error')),
  -- The run-level family of a failure (`Run.failureCode`'s vocabulary); the
  -- reason within it is in `record`.
  failure_code text,
  -- A ValueRecord each: the value as kept (secrets withheld, cut to a bound),
  -- its summary, shape, size and hash, and the places withheld or cut — so a
  -- summary read can select `input - 'value'` without shipping values.
  input jsonb,
  output jsonb,
  -- The rest of the unit's record: skip.via, failure, decisions, waits,
  -- attempts, counts and meta.
  record jsonb NOT NULL DEFAULT '{}'::jsonb,
  claim_epoch int NOT NULL,
  updated_at_ms bigint NOT NULL,
  UNIQUE (run_id, path, item_index, pass)
);

-- A run view's delta read (`?since=`): the rows a walker wrote since then.
CREATE INDEX IF NOT EXISTS automation_node_runs_updated
  ON app.automation_node_runs (run_id, updated_at_ms);
CREATE INDEX IF NOT EXISTS automation_node_runs_org
  ON app.automation_node_runs (org_id);

-- How many bytes of recorded values the run holds: past a fixed budget per
-- run the record keeps summaries and shapes only.
ALTER TABLE app.automation_runs
  ADD COLUMN IF NOT EXISTS record_bytes int NOT NULL DEFAULT 0;
