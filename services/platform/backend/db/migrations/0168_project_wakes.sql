-- A slot release wakes the project's opted-in standing role (#4540). Until
-- now a freed agent slot changed nothing until the role's next cron minute:
-- the run's end recorded no release, and only an enabled schedule may start
-- project agents. This table is that release, durably: one row per project,
-- written in the same transaction as the run's terminal election (never in a
-- savepoint), so a release is recorded if and only if its run's end commits.
--
-- Every write to app.project_wakes holds the org's audit-chain key
-- (`lockAuditChain`), which every terminal election already holds through
-- its ledger entry — so no transaction ever waits on a wake row.

-- The opt-in: at most one enabled opted-in schedule per project (the claim
-- triggers below keep it for every writer). A schedule only; cleared on a
-- kind change, also one the previous image writes.
ALTER TABLE app.automation_triggers
  ADD COLUMN IF NOT EXISTS wake_on_slot_freed boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS automation_triggers_wake_targets
  ON app.automation_triggers (org_id) WHERE wake_on_slot_freed;

-- The workspace-free probe a release asks before it signals: is another run
-- of the agent still live in the same workspace? Only live rows are indexed.
CREATE INDEX IF NOT EXISTS project_agent_runs_live_session
  ON app.project_agent_runs (org_id, session_id, agent_id)
  WHERE status IN ('queued', 'running');

-- The generation an admitted wake-target start covers, read from the
-- admission's own snapshot (the releases committed before it). NULL on every
-- other run, and on rows written by an image before this one — nullable, so
-- it is safe mid-roll. Automatic retries do not copy it: the consume reads
-- the occurrence's slot-receipt run.
ALTER TABLE app.project_agent_runs
  ADD COLUMN IF NOT EXISTS wake_admitted_seq bigint;

CREATE TABLE IF NOT EXISTS app.project_wakes (
  org_id           text    NOT NULL,
  project_id       text    NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  -- The wake target T: the opted-in schedule bound to the project, same org
  -- (checked on write). No foreign key: a deleted or re-kinded trigger is
  -- mirrored as `target_disabled` and keeps the generation; only the
  -- project's deletion removes the row.
  trigger_id       text    NOT NULL,
  -- Releases recorded, in commit order (every writer holds the chain key).
  signal_seq       bigint  NOT NULL DEFAULT 0,
  -- Releases covered by a manager turn that captured them, LAUNCHED and
  -- SETTLED. A cancel, a failure, a refusal or an admission alone never
  -- advances it.
  consumed_seq     bigint  NOT NULL DEFAULT 0,
  fired_seq        bigint  NOT NULL DEFAULT 0,
  -- The latest wake occurrence (automation run id).
  fired_run_id     text,
  -- Consecutive non-serving ends in this generation; drives the capped
  -- backoff, which is never exhausted.
  attempts         integer NOT NULL DEFAULT 0,
  -- Not eligible before this: the circuit's exact retryAfter, or the backoff.
  not_before_ms    bigint,
  -- fired | admitted | served | not_admitted | manager_cancelled |
  -- manager_failed | paused | held | held_card | target_disabled | blocked
  outcome          text,
  outcome_at_ms    bigint,
  -- Mirrors an explicit operator state, e.g. paused_after_failures:<code>.
  blocked_reason   text,
  manager_task_id  text,
  manager_agent_id text,
  -- When the oldest uncovered release of this generation was recorded.
  pending_since_ms bigint,
  signaled_at_ms   bigint,
  updated_at_ms    bigint  NOT NULL,
  PRIMARY KEY (org_id, project_id),
  CHECK (consumed_seq <= signal_seq AND fired_seq <= signal_seq AND attempts >= 0)
);
CREATE INDEX IF NOT EXISTS project_wakes_pending
  ON app.project_wakes (org_id, project_id) WHERE signal_seq > consumed_seq;

-- The wake scan's visit clock, the fairness the recovery sweeps keep (0150):
-- each scan claims the pending rows visited longest ago (never visited
-- first), stamps them, and only then works them. A row that stays ineligible
-- — blocked, held, waiting, busy or failing — goes to the back instead of
-- taking a slot every minute ahead of a later project. Kept beside the wake
-- row, so the stamp never writes a wake row outside the chain key.
CREATE TABLE IF NOT EXISTS app.project_wake_visits (
  org_id        text   NOT NULL,
  project_id    text   NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  visited_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, project_id)
);

-- One wake target per project (AUTO-R29), as a rule the database keeps for
-- every writer — this image's doors and the previous image's, which never
-- heard of the claim, alike. A binding carries whether its automation's
-- schedule claims the project (opted in, and enabled or paused by its
-- failures), and at most one binding of a project may. Triggers keep the flag:
-- a binding takes it from its schedule as it is written, and a change of a
-- schedule's claim rewrites that automation's bindings. Every claim change
-- bumps the automation's fence row, which a binding write takes first: a
-- SERIALIZABLE writer whose snapshot predates the change (the REST install
-- door) fails with a serialization error and retries, never writing a stale
-- claim. Claims are written under per-project keys, always the fence first
-- and then the projects in project order; only a claiming write takes a
-- project key — a false binding takes none, so writers of schedules that do
-- not claim (every schedule, before an opt-in) never wait on each other
-- beyond what they did before this migration. This image's binding change
-- takes all of its keys before its first write, so two of them never wait
-- for each other crosswise. The previous image takes its keys only as it
-- writes claiming rows, so two of its binding changes of claiming schedules
-- that trade projects can still deadlock: PostgreSQL then aborts one whole
-- transaction (40P01) and nothing is half-written. No claim backfill:
-- before this migration no schedule has opted in, so every existing
-- binding's false is already its claim; the fence rows are backfilled below.
ALTER TABLE app.automation_project_bindings
  ADD COLUMN IF NOT EXISTS wakes boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS automation_project_bindings_one_wake
  ON app.automation_project_bindings (org_id, project_id) WHERE wakes;

-- The fence: one row per automation that was ever bound or claimed; its
-- generation moves with every change of the schedule's claim.
CREATE TABLE IF NOT EXISTS app.automation_wake_fences (
  org_id          text   NOT NULL,
  automation_name text   NOT NULL,
  generation      bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, automation_name)
);

-- The claim of an automation's schedule, as its trigger row says now.
CREATE OR REPLACE FUNCTION app.automation_wake_claims(p_org text, p_name text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((
    SELECT kind = 'schedule' AND wake_on_slot_freed
           AND (enabled OR last_skip_reason IS NOT DISTINCT FROM 'paused_after_failures')
    FROM app.automation_triggers
    WHERE org_id = p_org AND name = p_name
  ), false)
$$;

-- The fence, held shared: created if missing. Under SERIALIZABLE, a fence row
-- created or bumped since the snapshot raises a serialization failure here.
CREATE OR REPLACE FUNCTION app.lock_automation_wake_fence(p_org text, p_name text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO app.automation_wake_fences (org_id, automation_name)
  VALUES (p_org, p_name)
  ON CONFLICT (org_id, automation_name) DO NOTHING;
  PERFORM 1 FROM app.automation_wake_fences
  WHERE org_id = p_org AND automation_name = p_name
  FOR SHARE;
END
$$;

-- One project's claim key: taken after the fence, in project order.
CREATE OR REPLACE FUNCTION app.lock_project_wake(p_org text, p_project text)
RETURNS void LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(
    hashtextextended('project-wake:' || p_org || '/' || p_project, 0)
  )
$$;

-- A binding as it is written takes its schedule's claim, read under the
-- fence. Only a claiming binding takes its project's claim key: a false one
-- enters no one-wake index entry, so it needs no order with any other
-- writer — and the previous image's binding loops, which insert in the
-- caller's order with no retry, never wait on each other here (R5-F1).
CREATE OR REPLACE FUNCTION app.automation_binding_wake_claim()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.lock_automation_wake_fence(NEW.org_id, NEW.automation_name);
  NEW.wakes := app.automation_wake_claims(NEW.org_id, NEW.automation_name);
  IF NEW.wakes THEN
    PERFORM app.lock_project_wake(NEW.org_id, NEW.project_id);
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS automation_binding_wake_claim
  ON app.automation_project_bindings;
CREATE TRIGGER automation_binding_wake_claim
  BEFORE INSERT OR UPDATE ON app.automation_project_bindings
  FOR EACH ROW EXECUTE FUNCTION app.automation_binding_wake_claim();

-- Every automation bound before this migration gets its fence row now (after
-- the trigger exists, so no binding is missed), so two of its binding writes
-- never meet at the row's first insert; one bound later gets it with its
-- first binding, in that binding's transaction.
INSERT INTO app.automation_wake_fences (org_id, automation_name)
SELECT DISTINCT org_id, automation_name FROM app.automation_project_bindings
ON CONFLICT (org_id, automation_name) DO NOTHING;

-- A binding change's claim keys, all taken before its first write (R4-F3):
-- the fence, then — only when the schedule claims, read under the fence —
-- every project it is bound to now or asks for, in project order. A change
-- whose schedule does not claim takes no project key (R5-F1).
CREATE OR REPLACE FUNCTION app.lock_automation_wake_keys(
  p_org text, p_name text, p_projects text[]
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_claims boolean;
  v_project text;
BEGIN
  PERFORM app.lock_automation_wake_fence(p_org, p_name);
  v_claims := app.automation_wake_claims(p_org, p_name);
  IF v_claims THEN
    FOR v_project IN
      SELECT claim_keys.project_id FROM (
        SELECT project_id FROM app.automation_project_bindings
        WHERE org_id = p_org AND automation_name = p_name
        UNION
        SELECT unnest(p_projects)
      ) AS claim_keys
      ORDER BY claim_keys.project_id COLLATE "C"
    LOOP
      PERFORM app.lock_project_wake(p_org, v_project);
    END LOOP;
  END IF;
  RETURN v_claims;
END
$$;

-- Rewrite an automation's bindings to its schedule's claim: bump the fence
-- (exclusively), take the projects in order, then write.
CREATE OR REPLACE FUNCTION app.sync_automation_wake_claims(p_org text, p_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_claims boolean := app.automation_wake_claims(p_org, p_name);
  v_project text;
BEGIN
  INSERT INTO app.automation_wake_fences AS f (org_id, automation_name, generation)
  VALUES (p_org, p_name, 1)
  ON CONFLICT (org_id, automation_name)
    DO UPDATE SET generation = f.generation + 1;
  FOR v_project IN
    SELECT project_id FROM app.automation_project_bindings
    WHERE org_id = p_org AND automation_name = p_name
    ORDER BY project_id COLLATE "C"
  LOOP
    PERFORM app.lock_project_wake(p_org, v_project);
  END LOOP;
  UPDATE app.automation_project_bindings SET wakes = v_claims
  WHERE org_id = p_org AND automation_name = p_name
    AND wakes IS DISTINCT FROM v_claims;
END
$$;

-- Only a schedule can opt in: any writer that makes a trigger something else
-- clears it (the previous image's kind change kept it).
CREATE OR REPLACE FUNCTION app.automation_trigger_wake_kind()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> 'schedule' THEN
    NEW.wake_on_slot_freed := false;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS automation_trigger_wake_kind ON app.automation_triggers;
CREATE TRIGGER automation_trigger_wake_kind
  BEFORE INSERT OR UPDATE OF kind, wake_on_slot_freed ON app.automation_triggers
  FOR EACH ROW EXECUTE FUNCTION app.automation_trigger_wake_kind();

-- A change of a schedule's claim — by any writer: a save, a switch-off, a
-- kind change, a delete, a rename — rewrites its bindings. A pause by
-- failures keeps the claim, so the pause (which holds the audit chain) never
-- writes here.
CREATE OR REPLACE FUNCTION app.automation_trigger_wake_sync()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_old boolean := false;
  v_new boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := OLD.kind = 'schedule' AND OLD.wake_on_slot_freed
      AND (OLD.enabled OR OLD.last_skip_reason IS NOT DISTINCT FROM 'paused_after_failures');
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new := NEW.kind = 'schedule' AND NEW.wake_on_slot_freed
      AND (NEW.enabled OR NEW.last_skip_reason IS NOT DISTINCT FROM 'paused_after_failures');
  END IF;
  IF TG_OP = 'UPDATE'
     AND (OLD.org_id, OLD.name) IS DISTINCT FROM (NEW.org_id, NEW.name) THEN
    PERFORM app.sync_automation_wake_claims(OLD.org_id, OLD.name);
    PERFORM app.sync_automation_wake_claims(NEW.org_id, NEW.name);
  ELSIF v_old IS DISTINCT FROM v_new THEN
    IF TG_OP = 'DELETE' THEN
      PERFORM app.sync_automation_wake_claims(OLD.org_id, OLD.name);
    ELSE
      PERFORM app.sync_automation_wake_claims(NEW.org_id, NEW.name);
    END IF;
  END IF;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS automation_trigger_wake_sync ON app.automation_triggers;
CREATE TRIGGER automation_trigger_wake_sync
  AFTER INSERT OR DELETE
     OR UPDATE OF org_id, name, kind, enabled, wake_on_slot_freed, last_skip_reason
  ON app.automation_triggers
  FOR EACH ROW EXECUTE FUNCTION app.automation_trigger_wake_sync();
