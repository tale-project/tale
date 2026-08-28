-- 0.5 app migration 0030: the per-org APPLIED retention bounds snapshot —
-- the runtime source of truth the cleanup clamps against. Operator file /
-- env edits do NOT take effect until an admin applies them (the 0.4
-- proposal-gate posture); the row records what was applied and by whom.

CREATE TABLE app.retention_applied_bounds (
  org_id text PRIMARY KEY,
  -- {category: {min, max}} — the minimal clamp shape.
  bounds jsonb NOT NULL,
  applied_by text NOT NULL,
  applied_at_ms bigint NOT NULL
);
