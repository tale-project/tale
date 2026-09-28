/**
 * Real Postgres proof that a schedule outliving its organization never runs
 * again. What an organization deletion before 0.5.9 left behind is planted
 * under an org id no `organization` row carries — a saved version, its
 * deployment and an enabled schedule due for two minutes — beside a due
 * schedule of the live organization. One scan starts no run for the dead
 * organization, disables its schedule without claiming it, and names it in
 * one line; the live schedule next to it is still claimed. A second scan
 * does not see the disabled one at all, so the line is never written again.
 * Before any of that, the same scan runs where `"organization"` does not
 * resolve — as on a pure worker's first minutes on a fresh install, before
 * an api role has created Better Auth's tables — and must fire and disable
 * nothing rather than fail, saying that the enabled schedules wait.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { scanScheduledTriggers, type ScheduleScanResult } from './triggers.ts';

interface TriggerState {
  enabled: boolean;
  lastDueAt: number | null;
  lastFiredAt: number | null;
  lastSkipReason: string | null;
}

export async function checkDeletedOrgSchedules(
  sql: Sql,
  ctx: { orgId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const deadOrgId = `itest-deleted-org-${randomUUID()}`;
  const name = 'ops/orphaned-schedule';
  const liveName = `ops/live-beside-orphan-${randomUUID().slice(0, 8)}`;
  const backdated = Date.now() - 120_000;
  await sql`
    INSERT INTO app.automations (
      org_id, name, version, document, created_by, created_at_ms
    ) VALUES (
      ${deadOrgId}, ${name}, 1,
      ${sql.json({
        version: 1,
        name,
        nodes: [
          {
            id: 'echo',
            type: 'transform',
            input: { via: '{{ input.trigger }}' },
            code: 'return { ok: input.via }',
          },
        ],
        output: '{{ nodes.echo.output.ok }}',
      })},
      'itest', ${backdated}
    )
  `;
  await sql`
    INSERT INTO app.automation_deployments (
      org_id, name, version, deployed_by, deployed_at_ms
    ) VALUES (${deadOrgId}, ${name}, 1, 'itest', ${backdated})
  `;
  const planted = await sql<{ id: string; orgId: string }[]>`
    INSERT INTO app.automation_triggers (
      org_id, name, kind, cron, timezone, enabled, last_fired_at_ms,
      last_due_at_ms, created_by, created_at_ms, updated_at_ms
    ) VALUES
      (${deadOrgId}, ${name}, 'schedule', '* * * * *', 'UTC', true,
       ${backdated}, ${backdated}, 'itest', ${backdated}, ${backdated}),
      (${ctx.orgId}, ${liveName}, 'schedule', '* * * * *', 'UTC', true,
       ${backdated}, ${backdated}, 'itest', ${backdated}, ${backdated})
    RETURNING id, org_id AS "orgId"
  `;
  const orphanId = planted.find((row) => row.orgId === deadOrgId)?.id ?? '';
  const liveId = planted.find((row) => row.orgId === ctx.orgId)?.id ?? '';
  const stateOf = async (id: string): Promise<TriggerState | undefined> =>
    (
      await sql<TriggerState[]>`
        SELECT enabled, last_due_at_ms::float8 AS "lastDueAt",
               last_fired_at_ms::float8 AS "lastFiredAt",
               last_skip_reason AS "lastSkipReason"
        FROM app.automation_triggers WHERE id = ${id}
      `
    )[0];

  // A worker whose connection cannot see Better Auth's tables — a fresh
  // install's first minutes, or a search path that hides them: inside a
  // rolled-back transaction whose search path is `app` alone,
  // "organization" is a relation that does not exist. The scan must
  // neither fail on it nor read "no such organization" as a deletion and
  // retire what it cannot see; the due schedules planted above are enabled,
  // so it says that they wait, in one line.
  const fresh: { scan?: ScheduleScanResult; error: string; lines: string[] } = {
    error: '',
    lines: [],
  };
  const freshWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    fresh.lines.push(args.map(String).join(' '));
    freshWarn(...args);
  };
  try {
    await sql.begin(async (tx) => {
      await tx`SET LOCAL search_path TO app`;
      fresh.scan = await scanScheduledTriggers(tx);
      throw new Error('itest-rollback');
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== 'itest-rollback') fresh.error = message;
  } finally {
    console.warn = freshWarn;
  }
  const waitingLines = fresh.lines.filter((line) =>
    line.includes('enabled schedule(s) wait'),
  );
  record(
    'a worker scan that sees no organization table fires and disables nothing, does not fail, and says schedules wait',
    fresh.error === '' &&
      fresh.scan?.pages === 0 &&
      fresh.scan.examined === 0 &&
      fresh.scan.fired === 0 &&
      fresh.scan.orphaned === 0 &&
      waitingLines.length === 1,
    `error=${fresh.error || 'none'}, pages=${fresh.scan?.pages} examined=${fresh.scan?.examined} fired=${fresh.scan?.fired} orphaned=${fresh.scan?.orphaned} (want 0 each), waiting lines=${waitingLines.length} (want 1)`,
  );

  // Every line the two scans write, so "named once" is observed, not assumed.
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
    warn(...args);
  };
  let first: ScheduleScanResult | undefined;
  let second: ScheduleScanResult | undefined;
  let runs = -1;
  let orphan: TriggerState | undefined;
  let live: TriggerState | undefined;
  try {
    first = await scanScheduledTriggers(sql);
    orphan = await stateOf(orphanId);
    live = await stateOf(liveId);
    second = await scanScheduledTriggers(sql);
    const started = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.automation_runs
      WHERE org_id = ${deadOrgId}
    `;
    runs = started[0]?.count ?? -1;
  } finally {
    console.warn = warn;
    await sql`
      DELETE FROM app.automation_triggers WHERE id IN (${orphanId}, ${liveId})
    `;
    await sql`
      DELETE FROM app.automation_deployments WHERE org_id = ${deadOrgId}
    `;
    await sql`DELETE FROM app.automations WHERE org_id = ${deadOrgId}`;
  }
  const naming = lines.filter((line) => line.includes(`${deadOrgId}/${name}`));
  record(
    'a schedule whose organization no longer exists starts no run and ends up disabled, named once',
    orphanId !== '' &&
      runs === 0 &&
      orphan?.enabled === false &&
      // Never claimed: the cursor and the ledger are as the deletion left
      // them, so nothing read as a fire or a skip of this minute.
      orphan.lastDueAt === backdated &&
      orphan.lastFiredAt === backdated &&
      orphan.lastSkipReason === null &&
      (first?.orphaned ?? 0) >= 1 &&
      naming.length === 1 &&
      naming.every((line) =>
        line.includes('whose organization no longer exists'),
      ),
    `runs=${runs} (want 0), enabled=${orphan?.enabled} (want false), claimed=${orphan?.lastDueAt !== backdated} (want false), skip=${orphan?.lastSkipReason ?? 'none'}, orphaned=${first?.orphaned}/${second?.orphaned}, lines naming it=${naming.length} (want 1)`,
  );
  record(
    'the scan that disables an orphaned schedule still claims a live schedule beside it',
    liveId !== '' &&
      live?.enabled === true &&
      (live.lastDueAt ?? 0) > backdated &&
      live.lastSkipReason === 'not_deployed',
    `live enabled=${live?.enabled}, claimed=${(live?.lastDueAt ?? 0) > backdated}, skip=${live?.lastSkipReason ?? 'none'} (want not_deployed — nothing is deployed under its name)`,
  );
}
