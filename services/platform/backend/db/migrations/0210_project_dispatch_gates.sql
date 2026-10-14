-- A dispatch's gates (`domains/tasks/dispatch-gates.ts`): signals from
-- outside the platform that hold the ready work they govern — a CI system
-- whose runner queue is full, a deploy freeze. The dispatch's configuration
-- declares each gate; this table holds what was last reported on it.
--
-- One row per (project, gate key), written by each report: the state the
-- report left the gate in (`held`), the value it carried when the gate
-- judges values (hysteresis between the gate's `holdAt` and `recoverBelow`),
-- why, when and by whom. `last_start_at_ms` is when dispatch last started
-- work the gate governs, for its start spacing. A gate the configuration no
-- longer declares keeps its row until the project is deleted; a pass reads
-- only the declared ones.
CREATE TABLE IF NOT EXISTS app.project_dispatch_gates (
  project_id text NOT NULL REFERENCES app.projects (id) ON DELETE CASCADE,
  gate_key text NOT NULL,
  org_id text NOT NULL,
  held boolean NOT NULL DEFAULT false,
  -- The value of the last report, null for a report of a state.
  value double precision,
  reason text,
  -- When the last report came in, epoch ms; null before the first.
  reported_at_ms bigint,
  -- `user:<id>`, `api-key:<id>` — whoever reported last.
  reported_by text,
  last_start_at_ms bigint,
  updated_at_ms bigint NOT NULL,
  PRIMARY KEY (project_id, gate_key)
);

CREATE INDEX IF NOT EXISTS project_dispatch_gates_org_idx
  ON app.project_dispatch_gates (org_id);
