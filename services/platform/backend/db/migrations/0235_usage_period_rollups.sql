-- A period's usage in rollup rows, so a budget admission reads a few rows
-- instead of summing the ledger.
--
-- Every admission summed the ledger rows of its scopes' periods while it held
-- the organization's admission lock (`periodUsage` in
-- `backend/domains/governance/budget-gate.ts`, `lockBudgetAdmission` in
-- `budget-reservations.ts`). The organization's cap read every row of its
-- period, so each admission cost more as the organization's usage grew, and
-- its admissions queued behind each other for it. The gate reads these
-- instead:
--
-- - `usage_period_totals`: an organization's period, one row;
-- - `usage_period_subject_totals`: a period per ledger subject (`user_id`)
--   and key (`api_key_id`, '' for none). A person's sum reads their rows, a
--   key's its own, and a team's the rows of its current members and of the
--   keys it owns, resolved when it is read, so a membership change or a
--   revoked key moves nothing.
--
-- Their figures are the gate's: the tokens and cost of every ledger row, and
-- the requests of the rows no connector names (GOV-R15). `ledger_rows`
-- counts the ledger rows a total holds, so a total whose rows are all gone
-- (erasure, retention, teardown) is deleted rather than kept as a zero under
-- a person's id.
--
-- No writer touches them. Statement triggers on both ledger tables append
-- each statement's net change to the journal `usage_period_deltas`, one row
-- per organization, period, subject and key, from the statement's transition
-- tables. That covers every writer: the booking upsert, the previous image's
-- upsert of the parent during a roll, retention's and erasure's deletes, and
-- the organization teardown. A booking only appends, so bookings never wait
-- for one another on a row they all share. A fold
-- (`backend/domains/governance/usage-rollups.ts`) moves an organization's
-- journal into its totals under its admission lock, and the gate reads the
-- totals and the journal rows not folded yet in one statement, so a change
-- counts once on whichever side of a fold it is read.
--
-- A statement fires the statement triggers of the table it names, and a
-- parent's transition tables carry the rows of its children (CREATE
-- TRIGGER), so each change is journaled once: a booking names the child, the
-- deleters name the parent. A transition table needs a trigger per event.
--
-- Cost is numeric. Each float8 enters through the float8-to-numeric cast (15
-- significant digits), so a booking's +x and its deletion's -x cancel
-- exactly, and a total is the exact sum of its ledger rows' values. The gate
-- compares it as float8, as it compared the ledger's float8 sum.
--
-- Backfill: `app.rebuild_usage_period_rollups(org)` replaces an
-- organization's totals with its ledger's sums. It runs here for each
-- organization once the triggers exist. CREATE TRIGGER locks each ledger
-- table against writes until the migration commits, as 0232's index build
-- did, so no booking falls between the backfill and the journal.
--
-- Rolling-deploy safe: the previous image never reads the new tables, and
-- the triggers journal its ledger writes as well.

CREATE TABLE IF NOT EXISTS app.usage_period_totals (
  org_id text NOT NULL,
  period_key text NOT NULL,
  total_tokens bigint NOT NULL DEFAULT 0,
  cost_estimate_cents numeric NOT NULL DEFAULT 0,
  request_count bigint NOT NULL DEFAULT 0,
  ledger_rows bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, period_key)
);

-- The primary key serves a person's and a team's sum (`user_id = ANY`); the
-- index a key's (`api_key_id = $id`).
CREATE TABLE IF NOT EXISTS app.usage_period_subject_totals (
  org_id text NOT NULL,
  period_key text NOT NULL,
  user_id text NOT NULL,
  api_key_id text NOT NULL,
  total_tokens bigint NOT NULL DEFAULT 0,
  cost_estimate_cents numeric NOT NULL DEFAULT 0,
  request_count bigint NOT NULL DEFAULT 0,
  ledger_rows bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, period_key, user_id, api_key_id)
);

CREATE INDEX IF NOT EXISTS usage_period_subject_totals_api_key
  ON app.usage_period_subject_totals (org_id, period_key, api_key_id);

-- What the ledger's writers changed and no fold has moved into the totals
-- yet; a fold deletes what it moves.
CREATE TABLE IF NOT EXISTS app.usage_period_deltas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL,
  period_key text NOT NULL,
  user_id text NOT NULL,
  api_key_id text NOT NULL,
  total_tokens bigint NOT NULL,
  cost_estimate_cents numeric NOT NULL,
  request_count bigint NOT NULL,
  ledger_rows bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS usage_period_deltas_org_period
  ON app.usage_period_deltas (org_id, period_key);

-- One statement's net change per organization, period, subject and key: the
-- rows it added count up, the rows it removed count down, and an update
-- counts its new figures up and its old ones down. A group that nets to
-- nothing (an upsert that inserted where its update fired) is not written.
CREATE OR REPLACE FUNCTION app.journal_usage_ledger_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO app.usage_period_deltas (
      org_id, period_key, user_id, api_key_id,
      total_tokens, cost_estimate_cents, request_count, ledger_rows
    )
    SELECT org_id, period_key, user_id, coalesce(api_key_id, ''),
           sum(total_tokens),
           sum(cost_estimate_cents::numeric),
           sum(CASE WHEN connector_name IS NULL THEN request_count ELSE 0 END),
           count(*)
    FROM new_rows
    GROUP BY org_id, period_key, user_id, coalesce(api_key_id, '');
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO app.usage_period_deltas (
      org_id, period_key, user_id, api_key_id,
      total_tokens, cost_estimate_cents, request_count, ledger_rows
    )
    SELECT org_id, period_key, user_id, coalesce(api_key_id, ''),
           -sum(total_tokens),
           -sum(cost_estimate_cents::numeric),
           -sum(CASE WHEN connector_name IS NULL THEN request_count ELSE 0 END),
           -count(*)
    FROM old_rows
    GROUP BY org_id, period_key, user_id, coalesce(api_key_id, '');
  ELSE
    INSERT INTO app.usage_period_deltas (
      org_id, period_key, user_id, api_key_id,
      total_tokens, cost_estimate_cents, request_count, ledger_rows
    )
    SELECT org_id, period_key, user_id, api_key_id,
           sum(total_tokens), sum(cost_estimate_cents), sum(request_count),
           sum(ledger_rows)
    FROM (
      SELECT org_id, period_key, user_id,
             coalesce(api_key_id, '') AS api_key_id,
             total_tokens::numeric AS total_tokens,
             cost_estimate_cents::numeric AS cost_estimate_cents,
             (CASE WHEN connector_name IS NULL THEN request_count ELSE 0 END)::numeric
               AS request_count,
             1::numeric AS ledger_rows
      FROM new_rows
      UNION ALL
      SELECT org_id, period_key, user_id, coalesce(api_key_id, ''),
             -total_tokens::numeric,
             -cost_estimate_cents::numeric,
             -(CASE WHEN connector_name IS NULL THEN request_count ELSE 0 END)::numeric,
             -1::numeric
      FROM old_rows
    ) AS change
    GROUP BY org_id, period_key, user_id, api_key_id
    HAVING sum(total_tokens) <> 0 OR sum(cost_estimate_cents) <> 0
        OR sum(request_count) <> 0 OR sum(ledger_rows) <> 0;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS usage_ledger_journal_insert ON app.usage_ledger;
CREATE TRIGGER usage_ledger_journal_insert
  AFTER INSERT ON app.usage_ledger
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.journal_usage_ledger_changes();

DROP TRIGGER IF EXISTS usage_ledger_journal_update ON app.usage_ledger;
CREATE TRIGGER usage_ledger_journal_update
  AFTER UPDATE ON app.usage_ledger
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.journal_usage_ledger_changes();

DROP TRIGGER IF EXISTS usage_ledger_journal_delete ON app.usage_ledger;
CREATE TRIGGER usage_ledger_journal_delete
  AFTER DELETE ON app.usage_ledger
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.journal_usage_ledger_changes();

DROP TRIGGER IF EXISTS usage_ledger_provider_journal_insert ON app.usage_ledger_provider;
CREATE TRIGGER usage_ledger_provider_journal_insert
  AFTER INSERT ON app.usage_ledger_provider
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.journal_usage_ledger_changes();

DROP TRIGGER IF EXISTS usage_ledger_provider_journal_update ON app.usage_ledger_provider;
CREATE TRIGGER usage_ledger_provider_journal_update
  AFTER UPDATE ON app.usage_ledger_provider
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.journal_usage_ledger_changes();

DROP TRIGGER IF EXISTS usage_ledger_provider_journal_delete ON app.usage_ledger_provider;
CREATE TRIGGER usage_ledger_provider_journal_delete
  AFTER DELETE ON app.usage_ledger_provider
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION app.journal_usage_ledger_changes();

-- An organization's totals, rebuilt from its ledger. The journal rows are
-- deleted in the statement that reads the ledger, so both come from one
-- snapshot: a booking that committed before it is counted from the ledger and
-- its journal row dropped, one that commits after it keeps its journal row
-- for the next fold. Run it where no fold runs at the same time: here, or
-- under the organization's admission lock.
CREATE OR REPLACE FUNCTION app.rebuild_usage_period_rollups(target_org text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM app.usage_period_subject_totals WHERE org_id = target_org;
  DELETE FROM app.usage_period_totals WHERE org_id = target_org;
  WITH counted AS (
    DELETE FROM app.usage_period_deltas WHERE org_id = target_org
  )
  INSERT INTO app.usage_period_subject_totals (
    org_id, period_key, user_id, api_key_id,
    total_tokens, cost_estimate_cents, request_count, ledger_rows
  )
  SELECT org_id, period_key, user_id, coalesce(api_key_id, ''),
         sum(total_tokens),
         sum(cost_estimate_cents::numeric),
         sum(CASE WHEN connector_name IS NULL THEN request_count ELSE 0 END),
         count(*)
  FROM app.usage_ledger
  WHERE org_id = target_org
  GROUP BY org_id, period_key, user_id, coalesce(api_key_id, '');
  INSERT INTO app.usage_period_totals (
    org_id, period_key,
    total_tokens, cost_estimate_cents, request_count, ledger_rows
  )
  SELECT org_id, period_key,
         sum(total_tokens), sum(cost_estimate_cents), sum(request_count),
         sum(ledger_rows)
  FROM app.usage_period_subject_totals
  WHERE org_id = target_org
  GROUP BY org_id, period_key;
END;
$$;

SELECT app.rebuild_usage_period_rollups(orgs.org_id)
FROM (SELECT DISTINCT org_id FROM app.usage_ledger) AS orgs;
