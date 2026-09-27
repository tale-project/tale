-- Competence grants that outlived the membership.
--
-- `removeMembershipCascade` (backend/auth/membership.ts) revoked only the
-- `tale:` platform capabilities when a member left the organization; a
-- qualification grant (any other slug — the evidence a review policy
-- requires of an approver) stayed live, showed as "Former member · Active"
-- in the register, and re-attached to the person the moment the same user
-- was re-added (the rows are keyed by user id). The cascade now revokes
-- every live grant; this backfill closes the grants earlier removals left
-- open, exactly as the cascade would have: stamped revoked by 'system',
-- never deleted — the register is the trail.
--
-- Guarded: app migrations apply BEFORE Better Auth creates its tables on a
-- fresh database (`backend/db/migrate.ts`), and on a fresh database there is
-- no grant to close. Idempotent and bounded: a re-run finds no live grant
-- whose holder is not a member. Rolling-deploy safe: the previous image reads
-- a revoked row as revoked already, and a member's grants are untouched.
DO $$
BEGIN
  IF to_regclass('"member"') IS NOT NULL THEN
    UPDATE app.competence_records c SET
      revoked_at_ms = (extract(epoch FROM now()) * 1000)::bigint,
      revoked_by = 'system'
    WHERE c.revoked_at_ms IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "member" m
        WHERE m."organizationId" = c.org_id AND m."userId" = c.user_id
      );
  END IF;
END $$;
