-- Keep admitted projects and voice cost holds stable until settlement
--
-- A chat moved to another project used to move its live hold while its bill
-- still named the original project. Voice chunks checked booked usage only,
-- so distinct requests racing a cap could all pass. New writers stamp the
-- exact admitted projects ([] means deliberately none), and pending voice
-- attempts carry their estimated cost until ready/failed settlement.
--
-- NULL preserves compatibility with previous writers and identifies legacy
-- unstamped rows; it must not be confused with an authoritative empty array.
-- No historical projects or provider outcomes can be inferred by a backfill.
-- Strict reservation guarantees begin with new admissions after old writers
-- have retired; nullable additive columns alone do not fence old processes.

ALTER TABLE app.generations
  ADD COLUMN IF NOT EXISTS project_ids text[];

ALTER TABLE app.tts_audio_chunks
  ADD COLUMN IF NOT EXISTS project_ids text[],
  ADD COLUMN IF NOT EXISTS reserved_cost_cents double precision;

-- Read only pending attempts, not all retained audio, at every admission.
CREATE INDEX IF NOT EXISTS tts_audio_chunks_pending_budget
  ON app.tts_audio_chunks (org_id) WHERE status = 'pending';

-- Direct automation model calls use the existing op reservation/settlement
-- ledger. Their settled transport rows use the same bounded age sweep as
-- model-api rows, with a separate literal-kind index for its ordered batch.
CREATE INDEX IF NOT EXISTS sandbox_session_ops_automation_llm_started
  ON app.sandbox_session_ops (started_at_ms)
  WHERE kind = 'automation-llm';
