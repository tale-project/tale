-- Managed review contexts bind fixed native review envelopes without recursive report gates.
-- Ordinary tasks remain default-off; only explicit pristine enrollment opts in.
-- The discriminator lets PostgreSQL referential integrity arbitrate both
-- arrival orders between enrollment and old child/dependency writers, even
-- under READ COMMITTED. No custom cross-task lock ordering is introduced.
ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS review_context boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_review_context boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_review_context_identity
  ON app.tasks(id, review_context);
ALTER TABLE app.task_dependencies
  ADD COLUMN IF NOT EXISTS endpoint_review_context boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app.tasks'::regclass AND conname = 'tasks_ordinary_parent') THEN
    ALTER TABLE app.tasks ADD CONSTRAINT tasks_ordinary_parent CHECK (parent_review_context = false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app.tasks'::regclass AND conname = 'tasks_parent_review_context') THEN
    -- MATCH SIMPLE permits a null parent. The original single-key FK still
    -- performs SET NULL; this NO ACTION check observes that completed action.
    ALTER TABLE app.tasks ADD CONSTRAINT tasks_parent_review_context
      FOREIGN KEY (parent_task_id, parent_review_context)
      REFERENCES app.tasks(id, review_context) ON UPDATE RESTRICT ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app.task_dependencies'::regclass AND conname = 'task_dependencies_ordinary_endpoints') THEN
    ALTER TABLE app.task_dependencies ADD CONSTRAINT task_dependencies_ordinary_endpoints
      CHECK (endpoint_review_context = false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app.task_dependencies'::regclass AND conname = 'task_dependencies_blocker_review_context') THEN
    ALTER TABLE app.task_dependencies ADD CONSTRAINT task_dependencies_blocker_review_context
      FOREIGN KEY (blocker_task_id, endpoint_review_context)
      REFERENCES app.tasks(id, review_context) ON UPDATE RESTRICT ON DELETE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app.task_dependencies'::regclass AND conname = 'task_dependencies_blocked_review_context') THEN
    ALTER TABLE app.task_dependencies ADD CONSTRAINT task_dependencies_blocked_review_context
      FOREIGN KEY (blocked_task_id, endpoint_review_context)
      REFERENCES app.tasks(id, review_context) ON UPDATE RESTRICT ON DELETE NO ACTION;
  END IF;
END $$;

-- Operational review contexts prevent review reports recursively generating
-- another mandatory review. No existing task is enrolled or backfilled.
-- Only purpose-created native contexts opt in after an editor's exact CAS.
CREATE TABLE IF NOT EXISTS app.task_review_contexts (
  -- Old generic deletion writers must refuse rather than bypass the new
  -- maintained legal-hold check. New task retirement explicitly removes
  -- contexts after that guard and transactional run cancellation.
  task_id text PRIMARY KEY,
  task_review_context boolean NOT NULL DEFAULT true CHECK (task_review_context),
  org_id text NOT NULL,
  project_id text NOT NULL REFERENCES app.projects(id) ON DELETE RESTRICT,
  -- Retained if the agent is removed: deletion disables future admission,
  -- never reclassifies this task as an ordinary deliverable.
  reviewer_agent_id text NOT NULL,
  enabled boolean NOT NULL,
  created_at_ms bigint NOT NULL,
  updated_at_ms bigint NOT NULL,
  UNIQUE (task_id, org_id, project_id, reviewer_agent_id),
  FOREIGN KEY (task_id, task_review_context) REFERENCES app.tasks(id, review_context)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS task_review_contexts_org_project
  ON app.task_review_contexts(org_id, project_id);

CREATE TABLE IF NOT EXISTS app.task_review_batches (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  project_id text NOT NULL,
  context_task_id text NOT NULL,
  reviewer_agent_id text NOT NULL,
  manager_agent_id text NOT NULL,
  -- Run IDs and target identities are evidence references, not ownership
  -- FKs. Ordinary run retention and source task deletion keep their rules;
  -- missing evidence then makes a read incomplete, never approved.
  issuer_run_id text NOT NULL,
  request_id text NOT NULL,
  targets jsonb NOT NULL CHECK (jsonb_typeof(targets) = 'array'
    AND jsonb_array_length(targets) BETWEEN 1 AND 20),
  envelope_hash text NOT NULL CHECK (envelope_hash ~ '^[a-f0-9]{64}$'),
  created_at_ms bigint NOT NULL,
  FOREIGN KEY (context_task_id, org_id, project_id, reviewer_agent_id)
    REFERENCES app.task_review_contexts(task_id, org_id, project_id, reviewer_agent_id)
    ON DELETE CASCADE,
  UNIQUE (context_task_id, manager_agent_id, request_id)
);
CREATE INDEX IF NOT EXISTS task_review_batches_org_project
  ON app.task_review_batches(org_id, project_id);
ALTER TABLE app.project_agent_runs ADD COLUMN IF NOT EXISTS review_batch_id text
  REFERENCES app.task_review_batches(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS project_agent_runs_review_batch
  ON app.project_agent_runs(review_batch_id, seq) WHERE review_batch_id IS NOT NULL;

-- Context and envelope identity outlive enable/disable and run retention.
-- No new user PII is copied here. Existing audit pseudonymisation, held
-- project/task deletion checks and org-owned catalog teardown remain owners.
CREATE OR REPLACE FUNCTION app.guard_review_context_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.task_id, NEW.org_id, NEW.project_id, NEW.reviewer_agent_id, NEW.created_at_ms, NEW.task_review_context)
     IS DISTINCT FROM
     (OLD.task_id, OLD.org_id, OLD.project_id, OLD.reviewer_agent_id, OLD.created_at_ms, OLD.task_review_context) THEN
    RAISE EXCEPTION 'A review context identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_context_identity ON app.task_review_contexts;
CREATE TRIGGER review_context_identity BEFORE UPDATE ON app.task_review_contexts
  FOR EACH ROW EXECUTE FUNCTION app.guard_review_context_identity();

CREATE OR REPLACE FUNCTION app.guard_review_batch_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A review batch envelope is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_batch_identity ON app.task_review_batches;
CREATE TRIGGER review_batch_identity BEFORE UPDATE ON app.task_review_batches
  FOR EACH ROW EXECUTE FUNCTION app.guard_review_batch_identity();

-- Runs still use the existing agent-before-task admission lock and unique
-- live-run election. Ordinary tasks take the old path unchanged. An old
-- worker cannot create a non-attested run on an enrolled context, including
-- while the context is disabled, or discard a binding during an update.
CREATE OR REPLACE FUNCTION app.guard_review_context_run()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  context app.task_review_contexts%ROWTYPE;
  batch app.task_review_batches%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.review_batch_id IS DISTINCT FROM OLD.review_batch_id THEN
    RAISE EXCEPTION 'A review run binding is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO context FROM app.task_review_contexts WHERE task_id = NEW.task_id;
  IF NOT FOUND THEN
    IF NEW.review_batch_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM app.tasks WHERE id = NEW.task_id AND review_context = true
    ) THEN
      RAISE EXCEPTION 'A batch run requires an enrolled context' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO batch FROM app.task_review_batches WHERE id = NEW.review_batch_id;
  IF NOT FOUND OR NEW.org_id <> context.org_id OR NEW.project_id <> context.project_id
    OR NEW.agent_id <> context.reviewer_agent_id OR NEW.in_place IS DISTINCT FROM true
    OR NEW.started_via IS DISTINCT FROM 'agent'
    OR batch.context_task_id <> NEW.task_id OR batch.org_id <> NEW.org_id
    OR batch.project_id <> NEW.project_id OR batch.reviewer_agent_id <> NEW.agent_id
    OR NEW.started_via_agent_id IS DISTINCT FROM batch.manager_agent_id
    OR NEW.started_via_run_id IS DISTINCT FROM batch.issuer_run_id THEN
    RAISE EXCEPTION 'An enrolled context requires its exact native review batch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_context_run ON app.project_agent_runs;
CREATE TRIGGER review_context_run BEFORE INSERT OR UPDATE OF
  review_batch_id, org_id, project_id, task_id, agent_id, in_place,
  started_via, started_via_agent_id, started_via_run_id
  ON app.project_agent_runs FOR EACH ROW EXECUTE FUNCTION app.guard_review_context_run();

-- An explicit status tool, legacy completion or old approval writer must
-- not recreate the report gate. Disabling never removes this identity.
CREATE OR REPLACE FUNCTION app.guard_review_context_task()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE context app.task_review_contexts%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.review_context THEN
    RAISE EXCEPTION 'Create an ordinary task before explicit review-context enrollment'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.review_context AND NOT NEW.review_context THEN
    RAISE EXCEPTION 'A review context cannot be reclassified as ordinary work'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO context FROM app.task_review_contexts WHERE task_id = NEW.id;
  IF NOT FOUND THEN
    IF TG_OP = 'UPDATE' AND OLD.review_context THEN
      RAISE EXCEPTION 'An enrolled task lost its retained review identity'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'in_review' OR NEW.org_id <> context.org_id
    OR NEW.project_id <> context.project_id OR NEW.parent_task_id IS NOT NULL
    OR NEW.external_system IS NOT NULL OR NEW.external_id IS NOT NULL
    OR NEW.external_url IS NOT NULL OR NEW.source_thread_id IS NOT NULL
    OR NEW.thread_id IS NOT NULL OR NEW.source_discussion_thread_id IS NOT NULL
    OR NEW.repeat_rule IS NOT NULL OR NEW.repeat_next_task_id IS NOT NULL
    OR NEW.repeat_continued_at_ms IS NOT NULL
    OR NOT ((NEW.assignee_id IS NULL AND NEW.assignee_type IS NULL)
      OR (NEW.assignee_type IS NOT DISTINCT FROM 'agent'
        AND NEW.assignee_id IS NOT DISTINCT FROM context.reviewer_agent_id)) THEN
    RAISE EXCEPTION 'A review context cannot become an implementation task'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_context_task ON app.tasks;
CREATE TRIGGER review_context_task BEFORE INSERT OR UPDATE OF
  review_context, status, org_id, project_id, parent_task_id, external_system, external_id,
  repeat_rule, repeat_next_task_id, repeat_continued_at_ms, assignee_type, assignee_id, external_url, source_thread_id,
  thread_id, source_discussion_thread_id ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.guard_review_context_task();

CREATE OR REPLACE FUNCTION app.guard_review_context_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resource_type = 'task_review' AND EXISTS (
    SELECT 1 FROM app.task_review_contexts
    WHERE task_id = NEW.resource_id AND org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'A review context cannot acquire a report review gate'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_context_approval ON app.approvals;
CREATE TRIGGER review_context_approval BEFORE INSERT OR UPDATE OF
  org_id, resource_type, resource_id ON app.approvals
  FOR EACH ROW EXECUTE FUNCTION app.guard_review_context_approval();

-- A context is exclusively a native reviewer workspace, not an automation
-- subject. Existing automation task fencing still owns ordinary work.
CREATE OR REPLACE FUNCTION app.guard_review_context_automation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.task_review_contexts
    WHERE org_id = NEW.org_id AND task_id = NEW.input -> 'task' ->> 'id') THEN
    RAISE EXCEPTION 'A review context requires a native review batch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS review_context_automation ON app.automation_runs;
CREATE TRIGGER review_context_automation BEFORE INSERT OR UPDATE OF org_id, input
  ON app.automation_runs FOR EACH ROW EXECUTE FUNCTION app.guard_review_context_automation();
