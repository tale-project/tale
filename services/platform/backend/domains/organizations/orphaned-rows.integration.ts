/**
 * Real Postgres proof of the backfill that removes what organization
 * deletions before 0.5.9 stranded (`…_rows_of_deleted_organizations.sql`).
 * At boot the file finds no `organization` table yet — app migrations run
 * before Better Auth's — so this lane is the only place its DELETE runs. It
 * re-applies the file over a planted fixture inside ONE transaction that is
 * rolled back: the backfill removes every stranded row in the database, and
 * the rollback is what keeps it off the rows other lanes planted.
 *
 * The fixture: a deleted organization with rows along every kind of foreign
 * key the child-first walk has to order — a cascade (a webhook delivery, a
 * table with no org id, under its trigger), SET NULL (a document in a folder
 * and a project; a trigger naming its last run) and NO ACTION (a binding
 * pinning its project) — plus a released legal hold and the governance
 * ledger (an audit row, a slug tombstone); a second deleted organization
 * under an ACTIVE hold; and the live organization the harness signed in to.
 */
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';

import type { Sql, TransactionSql } from 'postgres';

/** What the teardown keeps (`ORG_TEARDOWN_KEEPS`), and so the backfill. */
const LEDGER: ReadonlySet<string> = new Set([
  'audit_logs',
  'audit_chain_heads',
  'audit_integrity_progress',
  'organization_tombstones',
]);

/** Per organization: table → its rows there (tables it has none in omitted). */
type OrgRows = Record<string, Record<string, number>>;

async function orgRows(
  tx: TransactionSql,
  tables: readonly string[],
  orgIds: readonly string[],
): Promise<OrgRows> {
  const rows: OrgRows = {};
  for (const orgId of orgIds) rows[orgId] = {};
  for (const table of tables) {
    const counts = await tx<{ orgId: string; count: number }[]>`
      SELECT org_id AS "orgId", count(*)::int AS count
      FROM ${tx(`app.${table}`)}
      WHERE org_id = ANY(${[...orgIds]}::text[])
      GROUP BY org_id
    `;
    for (const { orgId, count } of counts) {
      const own = rows[orgId];
      if (own) own[table] = count;
    }
  }
  return rows;
}

const describeRows = (rows: Record<string, number> | undefined): string =>
  Object.entries(rows ?? {})
    .map(([table, count]) => `${table}=${count}`)
    .join(',') || 'none';

class RollbackFixture extends Error {}

export async function checkOrphanedOrgRowsBackfill(
  sql: Sql,
  ctx: { orgId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const migrationsDir = new URL('../../db/migrations/', import.meta.url);
  const file = (await readdir(migrationsDir)).find((name) =>
    name.endsWith('_rows_of_deleted_organizations.sql'),
  );
  if (file === undefined) {
    record(
      'org backfill: the migration file is in place',
      false,
      'no *_rows_of_deleted_organizations.sql under backend/db/migrations',
    );
    return;
  }
  const backfill = await readFile(new URL(file, migrationsDir), 'utf8');
  const suffix = randomUUID();
  const dead = `itest-dead-org-${suffix}`;
  const held = `itest-held-org-${suffix}`;
  const live = ctx.orgId;
  const orgIds = [dead, held, live];

  let before: OrgRows = {};
  let first: OrgRows = {};
  let second: OrgRows = {};
  const deliveries = { before: -1, after: -1 };
  try {
    await sql.begin(async (tx) => {
      const tables = (
        await tx<{ tableName: string }[]>`
          SELECT c.table_name AS "tableName"
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema = 'app' AND c.column_name = 'org_id'
            AND t.table_type = 'BASE TABLE'
          ORDER BY c.table_name
        `
      ).map((row) => row.tableName);

      const now = Date.now();
      const projectId = randomUUID();
      const folderId = randomUUID();
      const name = 'ops/stranded';
      await tx`
        INSERT INTO app.projects (
          id, org_id, name, created_by, created_at_ms, updated_at_ms
        ) VALUES
          (${projectId}, ${dead}, 'Stranded project', 'itest', ${now}, ${now}),
          (${randomUUID()}, ${held}, 'Held project', 'itest', ${now}, ${now})
      `;
      await tx`
        INSERT INTO app.folders (id, org_id, name, created_at_ms)
        VALUES (${folderId}, ${dead}, 'Stranded folder', ${now})
      `;
      await tx`
        INSERT INTO app.documents (
          org_id, project_id, folder_id, created_at_ms, updated_at_ms
        ) VALUES (${dead}, ${projectId}, ${folderId}, ${now}, ${now})
      `;
      await tx`
        INSERT INTO app.automation_project_bindings (
          org_id, automation_name, project_id, bound_at_ms, bound_by
        ) VALUES (${dead}, ${name}, ${projectId}, ${now}, 'itest')
      `;
      await tx`
        INSERT INTO app.automations (
          org_id, name, version, document, created_by, created_at_ms
        ) VALUES (${dead}, ${name}, 1, ${tx.json({ version: 1 })}, 'itest', ${now})
      `;
      await tx`
        INSERT INTO app.automation_deployments (
          org_id, name, version, deployed_by, deployed_at_ms
        ) VALUES (${dead}, ${name}, 1, 'itest', ${now})
      `;
      const runs = await tx<{ id: string }[]>`
        INSERT INTO app.automation_runs (
          org_id, name, version, status, mode, started_by, started_at_ms
        ) VALUES (
          ${dead}, ${name}, 1, 'success', 'live', 'trigger:stranded', ${now}
        )
        RETURNING id
      `;
      const triggers = await tx<{ id: string }[]>`
        INSERT INTO app.automation_triggers (
          org_id, name, kind, cron, timezone, enabled, last_run_id,
          created_by, created_at_ms, updated_at_ms
        ) VALUES (
          ${dead}, ${name}, 'schedule', '* * * * *', 'UTC', true,
          ${runs[0]?.id ?? null}, 'itest', ${now}, ${now}
        )
        RETURNING id
      `;
      const triggerId = triggers[0]?.id ?? '';
      await tx`
        INSERT INTO app.automation_webhook_deliveries (
          trigger_id, delivery_key, source, received_at_ms, expires_at_ms
        ) VALUES (
          ${triggerId}, ${`stranded-${suffix}`}, 'itest', ${now},
          ${now + 60_000}
        )
      `;
      // A hold released before the deletion protects nothing; an active
      // one keeps the whole organization.
      await tx`
        INSERT INTO app.legal_holds (
          org_id, target_type, target_id, target_label, reason, placed_by,
          placed_at_ms, released_at_ms, released_by
        ) VALUES
          (${dead}, 'org', ${dead}, 'Stranded', 'itest', 'itest', ${now - 1000},
           ${now}, 'itest'),
          (${held}, 'org', ${held}, 'Held', 'itest', 'itest', ${now},
           NULL, NULL)
      `;
      await tx`
        INSERT INTO app.audit_logs (
          org_id, actor_id, actor_type, action, category, resource_type,
          resource_id, ts, status, integrity_hash
        ) VALUES (
          ${dead}, 'itest', 'user', 'organization_deleted', 'auth',
          'organization', ${dead}, ${now}, 'success', ${`itest-${suffix}`}
        )
      `;
      await tx`
        INSERT INTO app.organization_tombstones (slug, org_id, deleted_at_ms)
        VALUES (${`itest-dead-${suffix}`}, ${dead}, ${now})
      `;
      const deliveryCount = async (): Promise<number> =>
        (
          await tx<{ count: number }[]>`
            SELECT count(*)::int AS count
            FROM app.automation_webhook_deliveries
            WHERE trigger_id = ${triggerId}
          `
        )[0]?.count ?? -1;

      before = await orgRows(tx, tables, orgIds);
      deliveries.before = await deliveryCount();
      await tx.unsafe(backfill);
      first = await orgRows(tx, tables, orgIds);
      deliveries.after = await deliveryCount();
      await tx.unsafe(backfill);
      second = await orgRows(tx, tables, orgIds);
      throw new RollbackFixture();
    });
  } catch (error) {
    if (!(error instanceof RollbackFixture)) {
      record(
        'org backfill: the file applies over stranded rows',
        false,
        `threw ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
  }

  const plantedDead = Object.keys(before[dead] ?? {});
  const leftDead = Object.keys(first[dead] ?? {}).filter(
    (table) => !LEDGER.has(table),
  );
  record(
    "org backfill: a deleted organization's stranded rows go along every foreign-key kind, and the governance ledger stays",
    plantedDead.length >= 11 &&
      deliveries.before === 1 &&
      leftDead.length === 0 &&
      deliveries.after === 0 &&
      first[dead]?.audit_logs === 1 &&
      first[dead]?.organization_tombstones === 1,
    `planted=${describeRows(before[dead])} deliveries=${deliveries.before}; after: ${describeRows(first[dead])} deliveries=${deliveries.after} (want the ledger only: audit_logs=1,organization_tombstones=1)`,
  );
  record(
    'org backfill: a deleted organization under an active legal hold, and a live one, keep every row',
    before[held]?.projects === 1 &&
      before[held]?.legal_holds === 1 &&
      isDeepStrictEqual(first[held], before[held]) &&
      Object.keys(before[live] ?? {}).length > 0 &&
      isDeepStrictEqual(first[live], before[live]),
    `held: ${describeRows(before[held])} → ${describeRows(first[held])}; live: ${Object.keys(before[live] ?? {}).length} tables, unchanged=${isDeepStrictEqual(first[live], before[live])}`,
  );
  record(
    'org backfill: re-applying the file changes nothing',
    isDeepStrictEqual(second, first),
    `second pass equal to the first=${isDeepStrictEqual(second, first)}`,
  );
}
