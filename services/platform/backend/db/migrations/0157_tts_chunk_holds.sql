-- Voice output chunks hold their estimate while they are made
--
-- A voice output chunk being synthesized is spend in flight: its estimate
-- (`reserved_cost_cents`, the text's length at the voice's catalog price)
-- is written on the pending chunk row by the admission that let it start,
-- under the organization's budget-admission lock, and the budget
-- reservations (`backend/domains/governance/budget-reservations.ts`) count
-- every pending chunk carrying one — toward its requester, and toward the
-- project of the thread it reads aloud — so chunks and chat turns sent at
-- the same moment cannot pass a nearly reached cap together. The hold ends
-- with the row's `pending` status: the chunk turns `ready` and its cost is
-- booked, or `failed`, or the voice watchdog fails it once it is stale.
--
-- The partial index serves the reservations' read of an organization's
-- pending chunks; `ready` and `failed` rows, the vast majority, stay out.
--
-- Rolling-deploy safe: a nullable column the previous image never writes
-- or reads (its chunks hold nothing, as before), and an index.

ALTER TABLE app.tts_audio_chunks
  ADD COLUMN IF NOT EXISTS reserved_cost_cents double precision;

CREATE INDEX IF NOT EXISTS tts_audio_chunks_pending
  ON app.tts_audio_chunks (org_id)
  WHERE status = 'pending';
