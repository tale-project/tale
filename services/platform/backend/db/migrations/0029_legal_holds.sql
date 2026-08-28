-- 0.5 app migration 0029: legal holds — the preservation layer every
-- destructive path consults. Placement targets are `org` (whole tenant)
-- and `userMembership` (custodian cascade: every artifact whose author is
-- held is preserved); release is a maker-checker flow (a DIFFERENT admin
-- approves, then a cooldown) effected by the daily sweep. The 0.4
-- `activeLegalHoldClaims` OCC table collapses into the partial-unique
-- index below (rule 5): one ACTIVE hold per target, enforced by PG.

CREATE TABLE app.legal_holds (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('org', 'userMembership')),
  target_id text NOT NULL,
  -- Placement-time snapshot (user email / org name) — a hold is itself an
  -- audit record; the identity AT PLACEMENT is what forensics wants.
  target_label text NOT NULL,
  reason text NOT NULL,
  matter_ref text,
  placed_by text NOT NULL,
  placed_at_ms bigint NOT NULL,
  released_at_ms bigint,
  released_by text,
  release_reason text
);

CREATE UNIQUE INDEX legal_holds_one_active_per_target
  ON app.legal_holds (org_id, target_type, target_id)
  WHERE released_at_ms IS NULL;
CREATE INDEX legal_holds_org ON app.legal_holds (org_id, placed_at_ms DESC);

CREATE TABLE app.legal_hold_release_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  hold_id text NOT NULL REFERENCES app.legal_holds (id) ON DELETE CASCADE,
  requested_by text NOT NULL,
  requested_at_ms bigint NOT NULL,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'pending', 'approved', 'rejected', 'effected'
  )),
  approved_by text,
  approved_at_ms bigint,
  -- Approval + cooldown; the effect sweep releases past this moment.
  effective_at_ms bigint,
  rejected_by text,
  rejected_at_ms bigint
);

CREATE INDEX legal_hold_release_requests_org_status
  ON app.legal_hold_release_requests (org_id, status);
CREATE INDEX legal_hold_release_requests_hold
  ON app.legal_hold_release_requests (hold_id, status);
