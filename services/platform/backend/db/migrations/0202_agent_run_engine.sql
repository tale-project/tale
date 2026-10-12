-- How a project agent's run executes, and where its transcript lives.
--
-- A run used to be a coding harness in a sandbox, always. The organization's
-- standard agent now starts a run on the same engine a chat reply runs on —
-- the model, the tools and the skills, with a light sandbox for code only
-- when a call needs one — and hands the run to the harness in the agent's
-- full workspace only when the work needs a repository, a browser or hours
-- (`lib/agent/work-tools.ts`, `use_workspace`).
--
-- `engine` says which of the two drives the run NOW: `native`, or `harness`.
-- Every run written before this column, and every run an older image
-- inserts while a deploy rolls, is a harness run — the default says so — and
-- the `harness` column keeps naming the runtime a hand-over starts, for a
-- run that begins native.
--
-- `thread_id` is the run's transcript: a `task_run` thread whose messages
-- are what the native turn said and did, in the parts a chat reply carries
-- (steps, tool results, the files it made). It is bare — no
-- `thread_metadata` row — so no chat list ever shows it; the people who can
-- read the task read it through the task. A harness run has none: its
-- transcript is its sandbox op's log. The thread is not the run's to
-- delete: a task's retirement deletes it with the task, and the FK only
-- clears the pointer if the thread goes some other way.
--
-- `handoff` is what a native pass wrote when it handed the run to the
-- harness: why it could not finish, and the brief for its successor. It is
-- what the harness turn's prompt reads, and what makes a retry of that run
-- go straight to the harness instead of starting native again.
--
-- Rolling-deploy safe: a defaulted column, two nullable ones, no backfill.
ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'harness'
    CHECK (engine IN ('native', 'harness')),
  ADD COLUMN IF NOT EXISTS thread_id text
    REFERENCES app.threads (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handoff jsonb;

-- The watchdog's question: which native runs are working now.
CREATE INDEX IF NOT EXISTS project_agent_runs_native_running
  ON app.project_agent_runs (org_id, started_at_ms)
  WHERE engine = 'native' AND status = 'running';
