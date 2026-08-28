-- 0.5 app migration 0009: the task board core.
--
-- tasks + activity timeline + dependencies + label catalog + board views.
-- Access control is INHERITED from the parent project (no task-level ACL).
-- Board ordering uses a lexicographic fractional rank (LexoRank-style).
-- Deferred to their owning domains (ledger): discussion-comment metadata
-- (chat thread store), project agent runs, attachments/outputs blobs
-- (storage router) — the jsonb columns exist so those land without a
-- reshape.

CREATE TABLE app.tasks (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,

  title text NOT NULL,
  description text,

  -- Self-described blob refs ([{fileId,fileName,fileType,fileSize}]).
  attachments jsonb,
  -- Agent deliverables ([{fileId,fileName,fileType,fileSize,producedAt,runId}]).
  outputs jsonb,

  -- Human-readable per-project number (KEY-n); claimed from
  -- projects.task_counter in the same transaction as the insert.
  number int,

  status text NOT NULL CHECK (status IN (
    'backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'
  )),
  priority text CHECK (priority IN ('p0', 'p1', 'p2', 'p3')),
  label_ids text[] NOT NULL DEFAULT '{}',

  -- Polymorphic single assignee: user id / project-agent id / automation name.
  assignee_type text CHECK (assignee_type IN ('user', 'agent', 'app')),
  assignee_id text,

  reviewer_user_id text,
  parent_task_id text REFERENCES app.tasks (id) ON DELETE SET NULL,

  comment_count int NOT NULL DEFAULT 0,

  rank text NOT NULL,

  external_system text,
  external_id text,
  external_url text,

  start_date_ms bigint,
  start_notified_at_ms bigint,
  due_date_ms bigint,

  sla_level int,
  sla_level_at_ms bigint,
  status_changed_at_ms bigint,

  total_cost_cents int,
  agent_run_count int NOT NULL DEFAULT 0,
  last_agent_run_at_ms bigint,

  thread_id text,
  discussion_thread_id text,
  source_discussion_thread_id text,

  created_by text NOT NULL,
  created_by_type text NOT NULL CHECK (created_by_type IN ('user', 'agent', 'app')),
  claimed_at_ms bigint,
  completed_at_ms bigint,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  archived_at_ms bigint
);

CREATE INDEX tasks_org ON app.tasks (org_id);
CREATE INDEX tasks_project_status_rank ON app.tasks (project_id, status, rank);
CREATE INDEX tasks_project_archived ON app.tasks (project_id, archived_at_ms);
CREATE INDEX tasks_assignee ON app.tasks (org_id, assignee_type, assignee_id);
CREATE INDEX tasks_parent ON app.tasks (parent_task_id);
CREATE INDEX tasks_org_external ON app.tasks (org_id, external_system, external_id);
CREATE INDEX tasks_org_updated ON app.tasks (org_id, updated_at_ms DESC);
CREATE INDEX tasks_org_reviewer ON app.tasks (org_id, reviewer_user_id);
CREATE INDEX tasks_org_due ON app.tasks (org_id, due_date_ms);
CREATE INDEX tasks_org_status ON app.tasks (org_id, status);

-- Append-only per-task activity timeline (the product-facing Activity tab;
-- the org-wide audit chain stays the compliance trail).
CREATE TABLE app.task_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL,
  task_id text NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
  project_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent')),
  actor_id text NOT NULL,
  action text NOT NULL,
  from_value text,
  to_value text,
  -- Workflow attribution ({workflowSlug, wfExecutionId}) when applicable.
  context jsonb,
  created_at_ms bigint NOT NULL
);

CREATE INDEX task_activity_task ON app.task_activity (task_id, created_at_ms);
CREATE INDEX task_activity_org_created
  ON app.task_activity (org_id, created_at_ms DESC);

-- Advisory "blocked by" DAG edges, same-project only, cycles rejected at
-- write time.
CREATE TABLE app.task_dependencies (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  project_id text NOT NULL,
  blocker_task_id text NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
  blocked_task_id text NOT NULL REFERENCES app.tasks (id) ON DELETE CASCADE,
  created_by text NOT NULL,
  created_by_type text NOT NULL CHECK (created_by_type IN ('user', 'agent')),
  created_at_ms bigint NOT NULL,
  UNIQUE (blocker_task_id, blocked_task_id)
);

CREATE INDEX task_dependencies_blocked ON app.task_dependencies (blocked_task_id);
CREATE INDEX task_dependencies_project ON app.task_dependencies (project_id);

-- Project-scoped label catalog; one row per normalized name per project.
CREATE TABLE app.task_labels (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  created_by text NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  UNIQUE (project_id, name)
);

CREATE INDEX task_labels_org ON app.task_labels (org_id);

-- Saved board/table/timeline views (named grouping + filters + sort).
CREATE TABLE app.board_views (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('personal', 'shared')),
  view_type text NOT NULL CHECK (view_type IN ('board', 'table', 'timeline')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort jsonb,
  is_default boolean,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL
);

CREATE INDEX board_views_project ON app.board_views (project_id);
CREATE INDEX board_views_project_owner ON app.board_views (project_id, owner_id);
