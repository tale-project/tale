-- The effect ledger: one row per call a run makes outside itself — a
-- connector write or a model call — keyed by where in the run it happens.
--
-- `started` commits before the call and `done` (with the output) after it. A
-- resumed run reuses a `done` output instead of calling again. A `started`
-- row nobody finished is a call that may or may not have happened: a write in
-- that state waits for a person (`resolution`) unless its action may safely
-- be repeated, so a server that stops mid-call never sends the same write
-- twice behind anyone's back.
--
-- The `started` insert is fenced by the run's claim epoch, so a walker that
-- no longer holds the run cannot begin a write. The unique key is the call's
-- address: two walkers racing for the same call meet on one row.
--
-- Rolling-deploy safe: a new table the previous image never reads; its run
-- deletes cascade into it, and organization teardown finds it by its
-- `org_id` column.
CREATE TABLE IF NOT EXISTS app.automation_node_attempts (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL REFERENCES app.automation_runs (id) ON DELETE CASCADE,
  org_id text NOT NULL,
  -- The node's path: its id at the top level, `<parent>[<item>:<pass>]/<id>`
  -- inside a subautomation, so a nested call has a stable address too.
  node_id text NOT NULL,
  item_index int NOT NULL DEFAULT 0,
  pass int NOT NULL DEFAULT 0,
  -- Bumped each time the call is made again (a re-callable call after an
  -- interruption, or a person choosing to run it again).
  attempt int NOT NULL DEFAULT 1,
  kind text NOT NULL CHECK (kind IN ('connector', 'llm')),
  node_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'done', 'failed')),
  -- The resolved input the call was made with: what a person deciding about
  -- an interrupted write is shown.
  input jsonb,
  output jsonb,
  error text,
  failure_code text,
  -- A person's decision about a `started` write: call it again, continue as
  -- if it returned nothing, or fail the run.
  resolution text CHECK (resolution IN ('retry', 'skip', 'fail')),
  resolved_by text,
  resolved_at_ms bigint,
  -- The process that made the call (host:pid:version:colour), never sent to
  -- a client.
  lease_owner text,
  claim_epoch int NOT NULL,
  started_at_ms bigint NOT NULL,
  finished_at_ms bigint,
  UNIQUE (run_id, node_id, item_index, pass)
);

-- A run's calls nobody finished: what a resumed run and its in-doubt card
-- look up.
CREATE INDEX IF NOT EXISTS automation_node_attempts_open
  ON app.automation_node_attempts (run_id) WHERE status = 'started';
CREATE INDEX IF NOT EXISTS automation_node_attempts_org
  ON app.automation_node_attempts (org_id);
