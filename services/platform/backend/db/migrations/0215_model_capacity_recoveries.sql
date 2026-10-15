-- When a model answered again after a capacity hold (0205), so new work on it
-- ramps up instead of meeting it all at once.
--
-- Clearing a hold wakes the runs parked on the model in waves 15 seconds
-- apart (one, two, four, … at most a sixteenth of them). The work a project's
-- dispatch held back while the model was at capacity has no such waves: once
-- the hold row is gone, a dispatch without a spacing between starts would
-- start its whole free room on the model in one pass, hundreds of runs in a
-- pool kept on one agent. One row per (organization, provider, model) records
-- when its hold last cleared (`domains/tasks/model-capacity-holds.ts`); for
-- the five minutes the waves of 500 runs take, dispatch starts no more runs on
-- the model than those waves have let through, counting every run of the
-- organization started on it since then.
--
-- A table of its own, not a column on the hold: a hold row means the model is
-- held, and an image that does not know a cleared marker would read a kept row
-- as a hold that ran out and make its next run the probe. The previous image
-- never reads this table and clears holds without writing it; its clears are
-- then not ramped, as before. Organization-scoped like every row an
-- organization owns; the organization deletion walk removes them by `org_id`.
CREATE TABLE IF NOT EXISTS app.model_capacity_recoveries (
  org_id text NOT NULL,
  -- The hold's key: the run's `model_provider`, or '' when it named none.
  model_provider text NOT NULL,
  model text NOT NULL,
  -- When the hold cleared, epoch ms: the ramp's waves count from here. A
  -- later clear moves it; a ramp that is over reads as none.
  cleared_at_ms bigint NOT NULL,
  PRIMARY KEY (org_id, model_provider, model)
);
