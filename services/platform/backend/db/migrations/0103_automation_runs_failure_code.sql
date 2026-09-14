-- A failed automation run names WHY with a stable code, beside its sentence.
--
-- `detail` carried the failure as free text only ("echo: Error: …"), in a
-- contract that elsewhere insists a client branch on the `code`, never on
-- the sentence (2026-09-14 evaluation, g5-3): "the provider ran out of
-- credit", "the connector token expired", "the author's JavaScript threw"
-- and "the model refused" all arrived as `status: "failed"` plus prose whose
-- wording is not contractual, so every integrator ended up regex-matching
-- `detail`. This column is the code — `node_error`, `connector_error`, the
-- provider codes the chat surface documents, the agent codes, and so on —
-- written by `finishRun` when the stepper lands the run on `failed`; the API
-- answers it as `failureCode`.
--
-- Nullable, no backfill: a run failed before this release keeps its sentence
-- and no code (a client reads the absence as "unknown"). Rolling-deploy
-- safe: the previous image neither reads nor writes the column, and both
-- run INSERTs name their columns explicitly.

ALTER TABLE app.automation_runs
  ADD COLUMN IF NOT EXISTS failure_code text;
