-- Rows of organizations deleted before the teardown cascaded.
--
-- Until #3240 (0.5.9) `deleteOrganization` removed an organization's
-- preferences, memories, SSO team mirrors and Better Auth's own rows, and
-- left every other org-keyed app row behind: projects, tasks, documents,
-- conversations, usage, automations — and their enabled schedule triggers,
-- which the minutely scan went on firing for a tenant that no longer existed
-- (it now disables such a schedule instead: `scanScheduledTriggers`).
-- The deletion now cascades over every `org_id`-bearing app table
-- (`listOrgOwnedTables`, backend/domains/organizations/service.ts); this
-- backfill removes what the deletions on 0.5.0–0.5.8 stranded, the way that
-- cascade would have: the same catalog walk, child tables before the tables
-- they reference (a binding still pins its project without a cascade), and
-- the governance ledger kept — `ORG_TEARDOWN_KEEPS` as it stands with this
-- file: the audit chain outlives the tenant it describes, and a slug
-- tombstone is cleared by its own teardown job.
--
-- A row is stranded when no "organization" row carries its org_id. A
-- deleted organization with an ACTIVE legal hold keeps every row: the
-- teardown has refused such a deletion since 0.5.8, but on 0.5.0–0.5.7 an
-- organization could be deleted under a hold, and what it stranded is
-- exactly what the hold preserves. A released hold does not count.
--
-- Guarded: app migrations apply BEFORE Better Auth creates its tables on a
-- fresh database (`backend/db/migrate.ts`), and a fresh database has nothing
-- stranded. Idempotent and bounded: one DELETE per table, and a re-run finds
-- nothing left to remove. Rolling-deploy safe: the previous image serves
-- nothing of an organization that no longer exists. Its trigger scan may
-- still claim a stranded schedule while this runs; the DELETE waits for that
-- claim on the trigger row, and triggers go before the runs they reference,
-- so the run it started is removed with the rest.
DO $$
DECLARE
  pending text[];
  ready text[];
  tbl text;
BEGIN
  IF to_regclass('"organization"') IS NULL THEN
    RETURN;
  END IF;

  -- Names in byte order ("C"), the order `orderChildrenFirst` walks in,
  -- whatever collation the database was created with.
  SELECT coalesce(
    array_agg(c.table_name::text ORDER BY c.table_name::text COLLATE "C"),
    '{}'
  )
  INTO pending
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.table_schema = 'app' AND c.column_name = 'org_id'
    AND t.table_type = 'BASE TABLE'
    AND c.table_name NOT IN (
      'audit_logs',
      'audit_chain_heads',
      'audit_integrity_progress',
      'organization_tombstones'
    );

  WHILE cardinality(pending) > 0 LOOP
    -- Ready: no table still pending references it, so no child row this
    -- walk has yet to delete can pin one of its rows.
    SELECT coalesce(array_agg(p ORDER BY p COLLATE "C"), '{}')
    INTO ready
    FROM unnest(pending) AS p
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace ns ON ns.oid = child.relnamespace
      WHERE con.contype = 'f' AND ns.nspname = 'app'
        AND parent.relnamespace = child.relnamespace
        AND parent.relname = p AND child.relname <> p
        AND child.relname = ANY (pending)
    );
    IF cardinality(ready) = 0 THEN
      -- A reference cycle: only cascading constraints can delete it anyway.
      ready := pending;
    END IF;

    FOREACH tbl IN ARRAY ready LOOP
      EXECUTE format(
        $sql$
          DELETE FROM app.%I AS t
          WHERE NOT EXISTS (
              SELECT 1 FROM "organization" AS o WHERE o."id" = t.org_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM app.legal_holds AS h
              WHERE h.org_id = t.org_id AND h.released_at_ms IS NULL
            )
        $sql$,
        tbl
      );
    END LOOP;

    pending := ARRAY(
      SELECT p FROM unnest(pending) AS p
      WHERE p <> ALL (ready)
      ORDER BY p COLLATE "C"
    );
  END LOOP;
END $$;
