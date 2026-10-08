/** Opposing PostgreSQL scan plans must not deadlock the shared visit stamp. */
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { Sql } from 'postgres';

import type { RecordCheck } from '../../integration-lane-helpers.ts';
import { stampVisited } from './watchdogs.ts';

export async function checkSandboxWatchdogVisits(
  sql: Sql,
  ctx: { orgId: string },
  record: RecordCheck,
): Promise<void> {
  const nonce = randomUUID().replaceAll('-', '');
  const ids = [`visit-${nonce}-a`, `visit-${nonce}-b`];
  const trigger = `visit_${nonce}`;
  const gate = Math.floor(Math.random() * 1_000_000_000);
  const now = Date.now();
  const control = await sql.reserve();
  let owner: number | undefined;
  let priorTimeout: string | undefined;
  const operations: Array<Promise<{ ok: boolean; code?: string }>> = [];
  const pids: number[] = [];
  let installed = false;
  let primaryError: unknown;
  const waitForBlocker = async (index: number) => {
    const end = Date.now() + 5_000;
    while (Date.now() < end) {
      const pid = pids[index];
      if (pid !== undefined) {
        const [row] = await sql<{ blockers: number[] }[]>`
          SELECT pg_blocking_pids(${pid}) AS blockers
        `;
        if (row && row.blockers.length > 0) return row.blockers;
      }
      await delay(10);
    }
    throw new Error('Watchdog visit fixture did not reach its owned lock');
  };
  const start = (
    index: number,
    sequential: boolean,
  ): Promise<{ ok: boolean; code?: string }> => {
    const operation = sql
      .begin(async (tx) => {
        await tx`SELECT set_config('statement_timeout', '8000', true),
        set_config('plan_cache_mode', 'force_custom_plan', true),
        set_config('enable_seqscan', ${sequential ? 'on' : 'off'}, true),
        set_config('enable_indexscan', ${sequential ? 'off' : 'on'}, true),
        set_config('enable_indexonlyscan', 'off', true),
        set_config('enable_bitmapscan', 'off', true),
        set_config('enable_tidscan', 'off', true),
        set_config('tale.watchdog_visit_gate', ${String(gate + index)}, true),
        set_config('tale.watchdog_visit_rows', ${ids.join(',')}, true)`;
        const [row] = await tx<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        if (!row) throw new Error('Missing owned watchdog fixture connection');
        pids[index] = row.pid;
        const plan = await tx`EXPLAIN (FORMAT JSON)
        SELECT id FROM app.sandbox_sessions WHERE id = ANY(${ids})`;
        if (
          !JSON.stringify(plan).includes(
            `"Node Type":"${sequential ? 'Seq Scan' : 'Index Scan'}"`,
          )
        ) {
          throw new Error(
            'Watchdog fixture did not use the intended scan plan',
          );
        }
        await stampVisited(
          tx,
          (sequential ? ids : ids.toReversed()).map((id) => ({
            id,
            sessionId: id,
            orgId: ctx.orgId,
          })),
          now + index,
        );
      })
      .then(
        () => ({ ok: true }),
        (error: unknown) => ({
          ok: false,
          code:
            error !== null && typeof error === 'object' && 'code' in error
              ? String(error.code)
              : 'fixture_error',
        }),
      );
    operations.push(operation);
    return operation;
  };
  try {
    const [settings] = await control<{ pid: number; timeout: string }[]>`
      SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS timeout
    `;
    if (!settings)
      throw new Error('Missing watchdog fixture control connection');
    owner = settings.pid;
    priorTimeout = settings.timeout;
    await control`SELECT set_config('statement_timeout', '8000', false)`;
    // Physical heap order opposes the primary key. No other lane's rows
    // match either this trigger's transaction-local list or these IDs.
    for (const id of ids.toReversed()) {
      await control`INSERT INTO app.sandbox_sessions (
        id, org_id, session_id, status, owner_type, owner_id, created_by,
        created_at_ms, expires_at_ms
      ) VALUES (${id}, ${ctx.orgId}, ${id}, 'stopped', 'project', ${id},
        'itest:wd', ${now}, ${now + 3_600_000})`;
    }
    const heap = await control<{ id: string }[]>`
      SELECT id FROM app.sandbox_sessions WHERE id = ANY(${ids}) ORDER BY ctid
    `;
    if (heap[0]?.id !== ids[1] || heap[1]?.id !== ids[0]) {
      throw new Error(
        'Watchdog fixture heap order did not oppose its key order',
      );
    }
    await control`CREATE FUNCTION ${control(`pg_temp.${trigger}`)}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id IN (replace(TG_NAME, '_', '-') || '-a', replace(TG_NAME, '_', '-') || '-b')
          AND NEW.id = ANY(string_to_array(current_setting('tale.watchdog_visit_rows', true), ',')) THEN
          PERFORM pg_advisory_xact_lock(current_setting('tale.watchdog_visit_gate')::bigint);
        END IF;
        RETURN NEW;
      END
      $$`;
    await control`CREATE TRIGGER ${control(trigger)}
      BEFORE UPDATE OF last_reconciled_at_ms ON app.sandbox_sessions
      FOR EACH ROW EXECUTE FUNCTION ${control(`pg_temp.${trigger}`)}()`;
    installed = true;
    await control`SELECT pg_advisory_lock(${gate}::bigint), pg_advisory_lock(${gate + 1}::bigint)`;
    const first = start(0, true);
    const firstBlockers = await waitForBlocker(0);
    if (!firstBlockers.includes(owner ?? -1))
      throw new Error('First visit did not reach its owned barrier');
    const second = start(1, false);
    const secondBlockers = await waitForBlocker(1);
    // Old unordered updates enter opposite row barriers. Ordered locks
    // make the second statement wait for the first before either update.
    const waitedForFirst = secondBlockers.includes(pids[0] ?? -1);
    await control`SELECT pg_advisory_unlock(${gate}::bigint), pg_advisory_unlock(${gate + 1}::bigint)`;
    const outcomes = await Promise.all([first, second]);
    const rows = await control<
      { id: string; visited: number; status: string }[]
    >`
      SELECT id, last_reconciled_at_ms::float8 AS visited, status
      FROM app.sandbox_sessions WHERE id = ANY(${ids}) ORDER BY id
    `;
    record(
      'sandbox watchdog visit stamps serialize overlapping scan orders without losing either complete visited set',
      waitedForFirst &&
        outcomes.every((result) => result.ok) &&
        rows.length === 2 &&
        rows.every(
          (row) => row.visited === now + 1 && row.status === 'stopped',
        ),
      `waitedForFirst=${waitedForFirst}, outcomes=${outcomes.map((r) => (r.ok ? 'ok' : r.code)).join(',')}, stamped=${rows.filter((row) => row.visited === now + 1).length}/2`,
    );
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await control`SELECT pg_advisory_unlock(${gate}::bigint), pg_advisory_unlock(${gate + 1}::bigint)`;
      // Each transaction's statement timeout bounds settlement, including
      // failed readiness. Rejections were handled as soon as work started.
      await Promise.all(operations);
      if (installed)
        await control`DROP TRIGGER ${control(trigger)} ON app.sandbox_sessions`;
      await control`DROP FUNCTION IF EXISTS ${control(`pg_temp.${trigger}`)}()`;
      await control`DELETE FROM app.sandbox_sessions WHERE id = ANY(${ids})`;
    } catch (error) {
      primaryError ??= error;
      console.warn('[itest] watchdog visit fixture cleanup failed');
    } finally {
      try {
        if (priorTimeout !== undefined) {
          await control`SELECT set_config('statement_timeout', ${priorTimeout}, false)`;
        }
      } catch (error) {
        primaryError ??= error;
      }
      control.release();
    }
  }
  if (primaryError !== undefined) throw primaryError;
}
