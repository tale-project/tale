-- Competence records: who is qualified to respond to a governed review.
--
-- An org's `review_policy` may demand that a responder hold named
-- competences; these rows are the evidence. A revoked record is RETAINED —
-- it stays the audit trail behind every review it once justified — so
-- revocation is a stamp, never a delete.
CREATE TABLE app.competence_records (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL,
  -- The member holding it (Better Auth userId).
  user_id text NOT NULL,
  -- Org-defined free text, trimmed and bounded by the service.
  competence text NOT NULL,
  granted_by text NOT NULL,
  granted_at_ms bigint NOT NULL,
  -- Absent ⇒ the grant does not expire.
  expires_at_ms bigint,
  -- Revocation stamp; the row survives it.
  revoked_at_ms bigint,
  revoked_by text,
  -- Free text or URL pointing at the qualification evidence.
  evidence text
);

CREATE INDEX competence_records_org_user
  ON app.competence_records (org_id, user_id);
CREATE INDEX competence_records_org_competence
  ON app.competence_records (org_id, competence);

-- At most ONE live grant of a competence per member: re-granting requires
-- revoking first, so "who holds this right now" has exactly one answer and
-- the check cannot pick between two records.
CREATE UNIQUE INDEX competence_records_active_grant
  ON app.competence_records (org_id, user_id, competence)
  WHERE revoked_at_ms IS NULL;
