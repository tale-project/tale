import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { Sql } from 'postgres';

/** Real Postgres proof of 0173: the seeded GitHub schedules that never
 * started a run are switched off, and nothing else moves. Planted the way
 * the provisioning left them before packs seeded their triggers off — one
 * organization's triage schedule bound by the provisioning, switched on,
 * never fired, with a next-due instant a scan computed; its review schedule
 * fired once (the run since removed); its mail sync, another pack, never
 * fired — and a second organization's triage schedule a person bound. The
 * file is applied twice: the first switches off the one dead row (its
 * next-due instant dropped by 0170's reset trigger, so no scan claims it),
 * the second touches no row. */

interface TriggerState {
  orgId: string;
  name: string;
  enabled: boolean;
  nextDueAt: string | null;
  updatedAt: string;
}

export async function checkSeededGithubSchedulesOff(
  sql: Sql,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const seeded = randomUUID();
  const personal = randomUUID();
  const backdated = Date.now() - 86_400_000;
  for (const [id, label] of [
    [seeded, 'seeded'],
    [personal, 'personal'],
  ] as const) {
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${id}, ${`GitHub schedules (${label})`},
              ${`itest-github-schedules-${label}-${id.slice(0, 8)}`}, now())
    `;
  }
  const plant = (
    orgId: string,
    name: string,
    cron: string,
    createdBy: string,
    stamps: { lastFiredAt?: number; nextDueAt?: number } = {},
  ) => sql`
    INSERT INTO app.automation_triggers (
      org_id, name, kind, cron, timezone, enabled, created_by,
      created_at_ms, updated_at_ms, last_fired_at_ms, next_due_at_ms
    ) VALUES (
      ${orgId}, ${name}, 'schedule', ${cron}, 'UTC', true, ${createdBy},
      ${backdated}, ${backdated}, ${stamps.lastFiredAt ?? null},
      ${stamps.nextDueAt ?? null}
    )
  `;
  const state = async (): Promise<TriggerState[]> =>
    sql<TriggerState[]>`
      SELECT org_id AS "orgId", name, enabled,
             next_due_at_ms::text AS "nextDueAt",
             updated_at_ms::text AS "updatedAt"
      FROM app.automation_triggers
      WHERE org_id IN (${seeded}, ${personal})
      ORDER BY org_id = ${personal}, name
    `;
  const show = (rows: TriggerState[]): string =>
    rows
      .map(
        (row) =>
          `${row.orgId === seeded ? 'seeded' : 'personal'}/${row.name}:${row.enabled ? 'on' : 'off'}${row.nextDueAt === null ? '' : ' due'}`,
      )
      .join(', ');

  try {
    await plant(
      seeded,
      'github-triage-issues',
      '0 7 * * *',
      'system:provisioning',
      { nextDueAt: Date.now() + 3_600_000 },
    );
    await plant(
      seeded,
      'github-review-pull-requests',
      '*/30 * * * *',
      'system:provisioning',
      { lastFiredAt: backdated },
    );
    await plant(
      seeded,
      'gmail-sync-emails',
      '*/5 * * * *',
      'system:provisioning',
    );
    await plant(personal, 'github-triage-issues', '0 7 * * *', 'user-ada');

    const migration = await readFile(
      new URL(
        '../../db/migrations/0173_seeded_github_schedules_off.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const first = await sql.unsafe(migration);
    const after = await state();
    const second = await sql.unsafe(migration);
    const again = await state();
    const off = after.filter((row) => !row.enabled);
    const dead = off[0];
    // What the migration decides, read again after its second run: a
    // worker's scan may meanwhile move the next-due instant of the rows
    // still on, which is not the migration's to hold.
    const decided = (rows: TriggerState[]): string =>
      JSON.stringify(
        rows.map((row) => [
          row.orgId,
          row.name,
          row.enabled,
          row.enabled ? null : row.updatedAt,
        ]),
      );
    record(
      'migration 0173 switches off only the seeded GitHub schedules that never started a run, once',
      off.length === 1 &&
        dead?.orgId === seeded &&
        dead.name === 'github-triage-issues' &&
        dead.nextDueAt === null &&
        Number(dead.updatedAt) > backdated &&
        after.length === 4 &&
        second.count === 0 &&
        decided(again) === decided(after),
      `after: ${show(after)} (want only seeded/github-triage-issues off, not due); first run changed ${first.count} row(s) here or in other organizations, second run changed ${second.count} (want 0), unchanged by it=${decided(again) === decided(after)}`,
    );
  } finally {
    await sql`
      DELETE FROM app.automation_triggers
      WHERE org_id IN (${seeded}, ${personal})
    `;
    await sql`
      DELETE FROM "organization" WHERE "id" IN (${seeded}, ${personal})
    `;
  }
}
