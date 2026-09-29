-- A managed agent turn's image generation, kept on the turn's op row.
--
-- `generate_image` (`core/node_only/sandbox/workspace_image_tool.ts`) calls
-- the organization's image provider from the platform, outside the turn's
-- gateway key, so neither the key's allowance nor the in-flight holds ever
-- saw that spend: with no budget rule a turn could generate images until its
-- deadline. The op row now carries what the admission needs, all written
-- under the organization's budget-admission lock
-- (`domains/sandbox/image-generation.ts`):
--
--   image_call_started_at_ms  when the turn's one in-flight generation was
--                             admitted; NULL when none runs. A second call
--                             is refused while it is set, unless it is stale
--                             (a process that died mid-call).
--   image_hold_cents          that call's estimated cost, and
--   image_hold_requests       the image requests it may make: the hold it
--                             adds to the op's own (`budget_cents`) in the
--                             budget reservations until its cost is booked.
--   images_admitted           image requests admitted this turn, against the
--                             per-turn ceiling.
--   image_spent_cents         what the turn's images cost, as booked in the
--                             usage ledger: measured against the turn's
--                             allowance together with its model spend.
--
-- Additive with defaults: the previous image neither reads nor writes these
-- columns, and an op it creates starts with no hold and nothing spent.

ALTER TABLE app.sandbox_session_ops
  ADD COLUMN IF NOT EXISTS image_call_started_at_ms bigint,
  ADD COLUMN IF NOT EXISTS image_hold_cents double precision NOT NULL DEFAULT 0
    CHECK (image_hold_cents >= 0),
  ADD COLUMN IF NOT EXISTS image_hold_requests integer NOT NULL DEFAULT 0
    CHECK (image_hold_requests >= 0),
  ADD COLUMN IF NOT EXISTS images_admitted integer NOT NULL DEFAULT 0
    CHECK (images_admitted >= 0),
  ADD COLUMN IF NOT EXISTS image_spent_cents double precision NOT NULL
    DEFAULT 0 CHECK (image_spent_cents >= 0);

-- A hold exists only while a call is in flight: the admission writes the
-- marker and the hold together, and the settle clears them together.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'app.sandbox_session_ops'::regclass
      AND conname = 'sandbox_session_ops_image_hold_in_flight'
  ) THEN
    ALTER TABLE app.sandbox_session_ops
      ADD CONSTRAINT sandbox_session_ops_image_hold_in_flight CHECK (
        image_call_started_at_ms IS NOT NULL
        OR (image_hold_cents = 0 AND image_hold_requests = 0)
      );
  END IF;
END $$;
