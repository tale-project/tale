-- Legacy walkers do not honour run leases or the effect ledger. A takeover
-- cannot tell whether their last external write happened, so preserve their
-- entire active set as an explicit nonterminal hold, never an invented cancel
-- or a synthetic node attempt. In-flight external effects may still finish.
--
-- Intentional compatibility boundary: old reads and canonical queued inserts
-- remain usable, but old automation execution writes fail with a SQL error.
-- Silently ignoring an UPDATE is unsafe: old progress treats that as success.
-- The protocol marker belongs to one reserved transaction, never a session.
-- All other application domains remain outside this fence.
--
-- The table lock is the cutover boundary. A transaction already holding a table
-- lock must finish first; a later statement sees the installed fence. Timeouts
-- roll back this whole migration instead of leaving a partially held fleet.
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE app.automation_runs IN ACCESS EXCLUSIVE MODE;

ALTER TABLE app.automation_runs
  ADD COLUMN IF NOT EXISTS legacy_quarantine jsonb;
COMMENT ON COLUMN app.automation_runs.legacy_quarantine IS
  'Preserved pre-protocol execution state with unknown external outcomes. Not user cancellation, not an effect-ledger resolution. Parent-owned so child-first erasure cannot remove the hold.';

ALTER TABLE app.automation_runs DROP CONSTRAINT IF EXISTS automation_runs_status_check;
ALTER TABLE app.automation_runs ADD CONSTRAINT automation_runs_status_check
  CHECK (status IN ('queued', 'running', 'waiting', 'quarantined', 'success', 'failed', 'cancelled'));
ALTER TABLE app.automation_run_events DROP CONSTRAINT IF EXISTS automation_run_events_kind_check;
ALTER TABLE app.automation_run_events ADD CONSTRAINT automation_run_events_kind_check
  CHECK (kind IN ('taken_over', 'handed_off', 'lease_expired', 'node_interrupted',
    'in_doubt', 'in_doubt_resolved', 'engine_deferred', 'legacy_quarantined', 'legacy_stop_requested'));

WITH held AS (
  UPDATE app.automation_runs SET
    legacy_quarantine = jsonb_build_object(
      'schemaVersion', 1, 'reason', 'legacy_execution_unproven',
      'observedAtMs', floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint,
      'prior', jsonb_build_object(
        'status', status, 'claimEpoch', claim_epoch, 'chainSeq', chain_seq,
        'engineProtocol', engine_protocol, 'wakeAtMs', wake_at_ms,
        'leaseEpoch', lease_epoch, 'leaseOwner', lease_owner,
        'leaseExpiresAtMs', lease_expires_at_ms),
      'resolution', NULL),
    status = 'quarantined', claim_epoch = claim_epoch + 1,
    chain_seq = chain_seq + 1, engine_protocol = 2,
    wake_at_ms = NULL, lease_owner = NULL, lease_expires_at_ms = NULL
  WHERE engine_protocol < 2 AND status IN ('queued', 'running', 'waiting')
  RETURNING id, org_id, legacy_quarantine
), events AS (
  INSERT INTO app.automation_run_events (run_id, org_id, at_ms, kind, detail)
  SELECT id, org_id, (legacy_quarantine ->> 'observedAtMs')::bigint,
    'legacy_quarantined', jsonb_build_object('reason', 'legacy_execution_unproven')
  FROM held RETURNING run_id, org_id
)
INSERT INTO app_realtime.outbox (org_id, entity, entity_id)
SELECT org_id, 'automation_run', run_id FROM events;

ALTER TABLE app.automation_runs DROP CONSTRAINT IF EXISTS automation_runs_legacy_quarantine_check;
ALTER TABLE app.automation_runs
  ADD CONSTRAINT automation_runs_legacy_quarantine_check CHECK ((
    (legacy_quarantine IS NULL AND status <> 'quarantined') OR
    (legacy_quarantine IS NOT NULL AND status = 'quarantined'
      AND octet_length(legacy_quarantine::text) <= 8192
      AND jsonb_typeof(legacy_quarantine) = 'object'
      AND legacy_quarantine ?& ARRAY['schemaVersion', 'reason', 'observedAtMs', 'prior', 'resolution']
      AND legacy_quarantine - ARRAY['schemaVersion', 'reason', 'observedAtMs', 'prior', 'resolution'] = '{}'::jsonb
      AND legacy_quarantine -> 'schemaVersion' = '1'::jsonb
      AND legacy_quarantine ->> 'reason' = 'legacy_execution_unproven'
      AND jsonb_typeof(legacy_quarantine -> 'observedAtMs') = 'number'
      AND jsonb_typeof(legacy_quarantine -> 'prior') = 'object'
      AND (legacy_quarantine -> 'resolution' = 'null'::jsonb OR (
        jsonb_typeof(legacy_quarantine -> 'resolution') = 'object'
        AND legacy_quarantine -> 'resolution' ?& ARRAY['action', 'actor', 'at']
        AND (legacy_quarantine -> 'resolution') - ARRAY['action', 'actor', 'at'] = '{}'::jsonb
        AND legacy_quarantine -> 'resolution' ->> 'action' = 'stop'
        AND jsonb_typeof(legacy_quarantine -> 'resolution' -> 'actor') = 'string'
        AND length(legacy_quarantine -> 'resolution' ->> 'actor') BETWEEN 1 AND 200
        AND jsonb_typeof(legacy_quarantine -> 'resolution' -> 'at') = 'number'
      ))
      AND engine_protocol >= 2 AND wake_at_ms IS NULL
      AND lease_owner IS NULL AND lease_expires_at_ms IS NULL)
  ) IS TRUE);

-- A held task's effects are unresolved. A new run must not bypass the hold by
-- choosing another automation name or a fresh run id for the same task.
DROP INDEX IF EXISTS app.automation_runs_one_live_per_task_subject;
CREATE UNIQUE INDEX automation_runs_one_live_per_task_subject
  ON app.automation_runs (org_id, project_id, (input -> 'task' ->> 'id'))
  WHERE status IN ('queued', 'running', 'waiting', 'quarantined')
    AND input -> 'task' ->> 'id' IS NOT NULL;

CREATE OR REPLACE FUNCTION app.guard_automation_writer_protocol()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  compatible boolean := current_setting('tale.automation_writer_protocol', true) = '2';
BEGIN
  -- GREATEST ignores NULL: normalizing it could lower a future stored floor
  -- after the less-than comparison also returned NULL. Absence is no protocol.
  IF TG_OP <> 'DELETE' AND NEW.engine_protocol IS NULL THEN
    RAISE EXCEPTION 'automation writer protocol must be explicit' USING ERRCODE = 'P7501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM app.assert_automation_cutover_visible();
    -- The old task index has a nullable project component. Preserve an
    -- org-level held task against a later project-bound run as well.
    IF EXISTS (
      SELECT 1 FROM app.automation_runs r
      WHERE r.org_id = NEW.org_id AND r.legacy_quarantine IS NOT NULL
        AND r.input -> 'task' ->> 'id' = NEW.input -> 'task' ->> 'id'
        AND (r.project_id = NEW.project_id OR r.project_id IS NULL OR NEW.project_id IS NULL)
    ) THEN
      RAISE EXCEPTION 'legacy automation holds this task' USING ERRCODE = 'P7502';
    END IF;
    -- Old beginRun names its columns. Permit only its pristine queued shape;
    -- stamp the floor here, which an old named-column INSERT cannot bypass.
    IF compatible IS NOT TRUE AND (
      NEW.status = 'queued' AND NEW.claim_epoch = 0 AND NEW.chain_seq = 0
      AND NEW.claimed_at_ms IS NULL AND NEW.finished_at_ms IS NULL
      AND NEW.lease_owner IS NULL AND NEW.lease_expires_at_ms IS NULL
      AND NEW.lease_epoch IS NULL AND NEW.engine_protocol = 1
      AND NEW.checkpoints = '{"nodes":{},"executions":0}'::jsonb
      AND NEW.output IS NULL AND NEW.trace IS NULL AND NEW.effects IS NULL
    ) IS NOT TRUE THEN
      RAISE EXCEPTION 'automation writer protocol 2 required' USING ERRCODE = 'P7501';
    END IF;
    IF NEW.legacy_quarantine IS NOT NULL THEN
      RAISE EXCEPTION 'legacy automation hold is preserved' USING ERRCODE = 'P7502';
    END IF;
    NEW.engine_protocol := GREATEST(NEW.engine_protocol, 2);
    RETURN NEW;
  END IF;
  IF compatible IS NOT TRUE THEN
    RAISE EXCEPTION 'automation writer protocol 2 required' USING ERRCODE = 'P7501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.legacy_quarantine IS NOT NULL THEN
      RAISE EXCEPTION 'legacy automation hold is preserved' USING ERRCODE = 'P7502';
    END IF;
    RETURN OLD;
  END IF;
  -- The only permitted change to a hold is one explicit stop REQUEST. All
  -- original facts, status, epochs, checkpoints and task exclusion remain.
  -- This transaction-local exact-run capability is set only by the guarded
  -- API after row-lock/CAS and acknowledgment, not by general writer setup.
  IF OLD.legacy_quarantine IS NOT NULL
    AND current_setting('tale.automation_legacy_stop_run', true) = OLD.id
    AND OLD.legacy_quarantine -> 'resolution' = 'null'::jsonb
    AND jsonb_typeof(NEW.legacy_quarantine -> 'resolution') = 'object'
    AND NEW.legacy_quarantine - 'resolution' = OLD.legacy_quarantine - 'resolution'
    AND to_jsonb(NEW) - 'legacy_quarantine' = to_jsonb(OLD) - 'legacy_quarantine'
  THEN
    RETURN NEW;
  END IF;
  IF (OLD.legacy_quarantine IS NOT NULL AND NEW IS DISTINCT FROM OLD)
    OR NEW.legacy_quarantine IS DISTINCT FROM OLD.legacy_quarantine
    OR NEW.engine_protocol < OLD.engine_protocol THEN
    RAISE EXCEPTION 'legacy automation hold is preserved' USING ERRCODE = 'P7502';
  END IF;
  NEW.engine_protocol := GREATEST(NEW.engine_protocol, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS automation_writer_protocol ON app.automation_runs;
CREATE TRIGGER automation_writer_protocol
  BEFORE INSERT OR UPDATE OR DELETE ON app.automation_runs
  FOR EACH ROW EXECUTE FUNCTION app.guard_automation_writer_protocol();

-- Organization erasure visits org-owned child tables before their parent.
-- Preserve the evidence even if a child DELETE is issued on its own; relying
-- only on the parent's later refusal would protect a transaction, not a row.
-- The boot migrator appends this exact ledger row in THIS transaction. A
-- pre-cutover REPEATABLE READ/SERIALIZABLE snapshot cannot see it and must
-- retry, rather than overlook a newly held parent. The held fact is immutable
-- afterwards, so these lookups need no reverse parent row locks. A complete
-- database restore retains ledger + holds; a missing ledger is not a bypass.
-- The bundled database defaults to tale,public; other installations use
-- public. Resolve the SAME relation the boot writer uses now, then retain its
-- quoted schema/name, not an OID or a caller-dependent search_path lookup.
DO $migration$
DECLARE
  ledger regclass := pg_catalog.to_regclass('app_migrations');
  qualified_ledger text;
BEGIN
  SELECT pg_catalog.format('%I.%I', n.nspname, c.relname)
    INTO qualified_ledger
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = ledger AND c.relkind = 'r';
  IF qualified_ledger IS NULL THEN
    RAISE EXCEPTION 'automation cutover migration ledger is missing';
  END IF;
  EXECUTE pg_catalog.format($definition$
    CREATE OR REPLACE FUNCTION app.assert_automation_cutover_visible()
    RETURNS void LANGUAGE plpgsql AS $body$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM %s WHERE name = '0163_automation_legacy_protocol.sql'
      ) THEN
        RAISE EXCEPTION 'automation cutover requires a fresh transaction' USING ERRCODE = '40001';
      END IF;
    END;
    $body$;
  $definition$, qualified_ledger);
END;
$migration$;

CREATE OR REPLACE FUNCTION app.preserve_legacy_automation_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  held boolean;
BEGIN
  PERFORM app.assert_automation_cutover_visible();
  SELECT legacy_quarantine IS NOT NULL INTO held
  FROM app.automation_runs WHERE id = OLD.run_id;
  IF held IS TRUE THEN
    RAISE EXCEPTION 'legacy automation evidence is preserved' USING ERRCODE = 'P7502';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS preserve_legacy_automation_evidence ON app.automation_run_events;
CREATE TRIGGER preserve_legacy_automation_evidence
  BEFORE DELETE ON app.automation_run_events
  FOR EACH ROW EXECUTE FUNCTION app.preserve_legacy_automation_evidence();
DROP TRIGGER IF EXISTS preserve_legacy_automation_evidence ON app.automation_node_attempts;
CREATE TRIGGER preserve_legacy_automation_evidence
  BEFORE DELETE ON app.automation_node_attempts
  FOR EACH ROW EXECUTE FUNCTION app.preserve_legacy_automation_evidence();
DROP TRIGGER IF EXISTS preserve_legacy_automation_evidence ON app.automation_human_asks;

-- Asking and answering have standalone writers and an INSERT ON CONFLICT
-- fold. Check both parents of a move, so changing run_id cannot shed a hold.
CREATE OR REPLACE FUNCTION app.preserve_legacy_automation_ask()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.assert_automation_cutover_visible();
  IF TG_OP <> 'INSERT' AND EXISTS (
    SELECT 1 FROM app.automation_runs
    WHERE id = OLD.run_id AND legacy_quarantine IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'legacy automation evidence is preserved' USING ERRCODE = 'P7502';
  END IF;
  IF TG_OP <> 'DELETE' AND EXISTS (
    SELECT 1 FROM app.automation_runs
    WHERE id = NEW.run_id AND legacy_quarantine IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'legacy automation evidence is preserved' USING ERRCODE = 'P7502';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS preserve_legacy_automation_ask ON app.automation_human_asks;
CREATE TRIGGER preserve_legacy_automation_ask
  BEFORE INSERT OR UPDATE OR DELETE ON app.automation_human_asks
  FOR EACH ROW EXECUTE FUNCTION app.preserve_legacy_automation_ask();

-- The old task-agent start reads only the three executable automation
-- statuses. Its new row belongs to another table, so the run's unique index
-- cannot preserve held-task exclusion by itself.
CREATE OR REPLACE FUNCTION app.refuse_legacy_held_task_start()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.assert_automation_cutover_visible();
  IF EXISTS (
    SELECT 1 FROM app.automation_runs r
    WHERE r.org_id = NEW.org_id
      AND (r.project_id = NEW.project_id OR r.project_id IS NULL)
      AND r.input -> 'task' ->> 'id' = NEW.task_id
      AND r.legacy_quarantine IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'legacy automation holds this task' USING ERRCODE = 'P7502';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS refuse_legacy_held_task_start ON app.project_agent_runs;
CREATE TRIGGER refuse_legacy_held_task_start
  BEFORE INSERT ON app.project_agent_runs
  FOR EACH ROW EXECUTE FUNCTION app.refuse_legacy_held_task_start();

-- A held run's task subject is JSON-linked, not an ON DELETE foreign key.
-- Refuse its retirement before task/project cascades can erase that subject.
CREATE OR REPLACE FUNCTION app.preserve_legacy_automation_subject()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app.assert_automation_cutover_visible();
  IF TG_TABLE_NAME = 'tasks' THEN
    IF EXISTS (
    SELECT 1 FROM app.automation_runs r
    WHERE r.org_id = OLD.org_id
      AND (r.project_id = OLD.project_id OR r.project_id IS NULL)
      AND r.input -> 'task' ->> 'id' = OLD.id
      AND r.legacy_quarantine IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'legacy automation holds this task' USING ERRCODE = 'P7502';
    END IF;
  ELSIF TG_TABLE_NAME = 'projects' THEN
    IF EXISTS (
    SELECT 1 FROM app.automation_runs r
    WHERE r.org_id = OLD.org_id AND r.legacy_quarantine IS NOT NULL
      AND (r.project_id = OLD.id OR (r.project_id IS NULL AND EXISTS (
        SELECT 1 FROM app.tasks t WHERE t.org_id = OLD.org_id
          AND t.project_id = OLD.id AND t.id = r.input -> 'task' ->> 'id'
      )))
    ) THEN
      RAISE EXCEPTION 'legacy automation holds this project' USING ERRCODE = 'P7502';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS preserve_legacy_automation_subject ON app.tasks;
CREATE TRIGGER preserve_legacy_automation_subject
  BEFORE DELETE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.preserve_legacy_automation_subject();
DROP TRIGGER IF EXISTS preserve_legacy_automation_subject ON app.projects;
CREATE TRIGGER preserve_legacy_automation_subject
  BEFORE DELETE ON app.projects
  FOR EACH ROW EXECUTE FUNCTION app.preserve_legacy_automation_subject();
