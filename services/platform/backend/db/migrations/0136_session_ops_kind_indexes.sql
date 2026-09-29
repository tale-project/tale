-- Keep the sandbox op readers fast once model-endpoint requests share the
-- table.
--
-- Every request through the model endpoints for API keys is one row in
-- `app.sandbox_session_ops` (`kind = 'model-api'`) — far more rows than the
-- agent turns the table was built for. The harness readers (the Sandboxes
-- page's run stats and the harness-health hint, `domains/sandbox/routes.ts`)
-- want an organization's AGENT turns in a time window, and until now found
-- them through `(org_id, status)`: every finished op of the organization,
-- model calls included, was walked to keep the few agent turns. The first
-- index lets them seek straight to `(org_id, kind)` and the window.
--
-- The second serves the sweep that deletes settled model-endpoint rows a
-- week after they started (`domains/model_api/retention.ts`): the ledger is
-- the durable record of their spend, the op row only carries it to the
-- settlement. Partial, so it holds the model-endpoint rows alone.
--
-- Plain CREATE INDEX: a migration runs in one transaction, so CONCURRENTLY is
-- unavailable; the table is small on every deployment this ships to (the
-- model endpoints are new). Rolling-deploy safe: indexes only.

CREATE INDEX IF NOT EXISTS sandbox_session_ops_org_kind_started
  ON app.sandbox_session_ops (org_id, kind, started_at_ms);

CREATE INDEX IF NOT EXISTS sandbox_session_ops_model_api_started
  ON app.sandbox_session_ops (started_at_ms)
  WHERE kind = 'model-api';
