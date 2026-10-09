/** Real Postgres proof of the run record's store (migration 0190,
 * `node-runs.ts`): a run is born with its `__start` row and the bytes it
 * stored; a progress write carries its rows and their bytes in its own
 * transaction, and a write the fence refuses records nothing; a late write
 * of an older walker never replaces a newer walker's row; a long step's
 * start write is fenced by the run row itself; the next turn reads back only
 * the units still open; the record reads back whole, with only the events a
 * reader may see, then by what changed since its cursor; and the rows leave
 * with their run. */
import type { Sql } from 'postgres';

import { createRecorder } from '../../../lib/engine/core/record/recorder.ts';
import type { NodeRunRecord } from '../../../lib/engine/core/record/types.ts';
import { recordBudget } from '../../../lib/engine/core/record/value.ts';
import { jsonParam } from '../../db/sql.ts';
import {
  readOpenNodeRuns,
  recordNodeRunsStarted,
  writeNodeRunsInTx,
} from './node-runs.ts';
import { readRunRecord } from './run-record.ts';
import { beginRun, deploy, recordProgress, saveVersion } from './store.ts';
import { markAutomationWriterInTx } from './writer-protocol.ts';

interface Row {
  path: string;
  status: string;
  attempt: number;
  claimEpoch: number;
  output: { value?: unknown } | null;
}

export async function checkAutomationNodeRuns(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const name = 'itest/node-runs';
  await saveVersion(sql, {
    organizationId: orgId,
    name,
    document: {
      version: 1,
      name,
      nodes: [{ id: 'one', type: 'transform', input: {}, code: 'return 1;' }],
    },
    actor: userId,
  });
  await deploy(sql, { organizationId: orgId, name, version: 1, actor: userId });

  const rowsOf = (runId: string) => sql<Row[]>`
    SELECT path, status, attempt, claim_epoch AS "claimEpoch", output
    FROM app.automation_node_runs WHERE run_id = ${runId}
    ORDER BY path, item_index, pass
  `;
  const bytesOf = async (runId: string): Promise<number> => {
    const rows = await sql<{ recordBytes: number }[]>`
      SELECT record_bytes AS "recordBytes" FROM app.automation_runs
      WHERE id = ${runId}
    `;
    return rows[0]?.recordBytes ?? -1;
  };

  // ---- a run is born with what it was given.
  const begun = await beginRun(sql, {
    organizationId: orgId,
    name,
    input: { who: 'ada' },
    mode: 'mock',
    startedBy: userId,
    requireOrgScope: true,
  });
  const runId = begun?.runId ?? '';
  const born = await rowsOf(runId);
  const bornBytes = await bytesOf(runId);
  record(
    'a run is born with its __start row and the bytes it stored',
    born.length === 1 &&
      born[0]?.path === '__start' &&
      born[0].status === 'ok' &&
      JSON.stringify(born[0].output?.value) === '{"who":"ada"}' &&
      bornBytes > 0,
    `rows=${JSON.stringify(born.map((r) => r.path))} output=${JSON.stringify(born[0]?.output?.value)} bytes=${bornBytes}`,
  );

  // The walker at epoch 2 holds the run.
  await sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    await tx`
      UPDATE app.automation_runs SET status = 'running', claim_epoch = 2
      WHERE id = ${runId}
    `;
  });
  const unit = (status: NodeRunRecord['status'], output?: unknown) => {
    const recorder = createRecorder({
      now: () => Date.now(),
      budget: recordBudget(),
    });
    const key = { path: 'one', item: -1, pass: -1 };
    recorder.unitStarted(key, { nodeId: 'one', nodeType: 'transform' });
    if (status !== 'running') {
      recorder.unitFinished(key, {
        status: status === 'waiting' ? 'ok' : status,
        output,
      });
    }
    return recorder.drain();
  };

  // ---- a progress write carries its rows; a refused one records nothing.
  const stale = await recordProgress(sql, {
    organizationId: orgId,
    runId,
    epoch: 1,
    executions: 0,
    nodeRuns: unit('ok', 'stale'),
  });
  const afterStale = await rowsOf(runId);
  const progressed = await recordProgress(sql, {
    organizationId: orgId,
    runId,
    epoch: 2,
    executions: 1,
    nodeRuns: unit('ok', 'fresh'),
  });
  const afterProgress = await rowsOf(runId);
  const progressBytes = await bytesOf(runId);
  const one = afterProgress.find((r) => r.path === 'one');
  record(
    'a progress write carries its rows and their bytes; a write the fence refuses records nothing',
    stale.status === 'stale' &&
      afterStale.length === 1 &&
      progressed.status === 'running' &&
      one?.status === 'ok' &&
      one.claimEpoch === 2 &&
      one.output?.value === 'fresh' &&
      progressBytes > bornBytes,
    `stale=${stale.status} rows=${afterStale.length}; progressed=${progressed.status} one=${JSON.stringify(one)} bytes=${bornBytes}→${progressBytes}`,
  );

  // ---- an older walker's late write never replaces a newer one's row.
  await sql.begin(async (tx) => {
    await writeNodeRunsInTx(tx, {
      organizationId: orgId,
      runId,
      epoch: 1,
      rows: unit('failed', 'late'),
    });
  });
  const afterLate = (await rowsOf(runId)).find((r) => r.path === 'one');
  record(
    "an older walker's late write never replaces a newer walker's row",
    afterLate?.status === 'ok' && afterLate.output?.value === 'fresh',
    `one=${JSON.stringify(afterLate)}`,
  );

  // ---- the start write is fenced by the run row itself.
  const startedStale = await recordNodeRunsStarted(sql, {
    organizationId: orgId,
    runId,
    epoch: 1,
    rows: unit('running'),
  });
  const startedLive = await recordNodeRunsStarted(sql, {
    organizationId: orgId,
    runId,
    epoch: 2,
    rows: unit('running'),
  });
  const open = await readOpenNodeRuns(sql, orgId, runId);
  record(
    "a long step's start write is fenced by the run, and the next turn reads back only open units",
    !startedStale.written &&
      startedLive.written &&
      open.length === 1 &&
      open[0]?.key.path === 'one' &&
      open[0].status === 'running',
    `stale=${startedStale.written} live=${startedLive.written} open=${JSON.stringify(open.map((r) => `${r.key.path}:${r.status}`))}`,
  );

  // ---- the record reads back whole, then by what changed since.
  const firstRead = await readRunRecord(sql, { organizationId: orgId, runId });
  const at = Math.max(Date.now(), (firstRead?.cursor ?? 0) + 1);
  const seenBy = 'host:1:v1:blue';
  await sql`
    INSERT INTO app.automation_run_events
      (run_id, org_id, at_ms, kind, instance, detail)
    VALUES
      (${runId}, ${orgId}, ${at}, 'node_interrupted', ${seenBy},
       ${jsonParam(sql, { path: 'one', reason: 'lease_expired', instance: seenBy })}::jsonb),
      (${runId}, ${orgId}, ${at}, 'legacy_quarantined', ${seenBy}, NULL)
  `;
  const whole = await readRunRecord(sql, { organizationId: orgId, runId });
  const quiet = await readRunRecord(sql, {
    organizationId: orgId,
    runId,
    since: (whole?.cursor ?? 0) + 1,
  });
  const foreign = await readRunRecord(sql, {
    organizationId: `${orgId}-elsewhere`,
    runId,
  });
  const event = whole?.events[0];
  record(
    'the record reads back with its steps, the events a reader may see and a cursor; nothing is new past the cursor',
    whole?.source === 'record' &&
      whole.nodes.some((n) => n.path === 'one' && n.status === 'running') &&
      whole.events.length === 1 &&
      whole.eventsTotal === 1 &&
      event?.kind === 'node_interrupted' &&
      event.nodeId === 'one' &&
      event.reason === 'lease_expired' &&
      !JSON.stringify(whole).includes(seenBy) &&
      whole.cursor === at &&
      quiet?.nodes.length === 0 &&
      quiet.events.length === 0 &&
      foreign === null,
    `source=${whole?.source} nodes=${JSON.stringify(whole?.nodes.map((n) => `${n.path}:${n.status}`))} events=${JSON.stringify(whole?.events)} total=${whole?.eventsTotal} cursor=${whole?.cursor}/${at} quiet=${quiet?.nodes.length}/${quiet?.events.length} foreign=${foreign === null}`,
  );

  // ---- the rows leave with their run.
  await sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    await tx`DELETE FROM app.automation_runs WHERE id = ${runId}`;
  });
  const gone = await rowsOf(runId);
  record(
    'the run record leaves with its run',
    gone.length === 0,
    `rows left=${gone.length}`,
  );
}
