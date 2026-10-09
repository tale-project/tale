/** Real Postgres proof of the run record's store (migration 0190,
 * `node-runs.ts`): a run is born with its `__start` row and the bytes it
 * stored; a progress write carries its rows and their bytes in its own
 * transaction, and a write the fence refuses records nothing; a late write
 * of an older walker never replaces a newer walker's row; a long step's
 * start write is fenced by the run row itself; the next turn reads back only
 * the units still open; the record reads back whole, with only the events a
 * reader may see, then by what changed since its cursor; a step's items page
 * in order, a unit reads whole with its ledger call, two runs of one
 * automation compare and two of different ones do not; a run runs again
 * whole or from a step, a fork born with the steps it reuses and their
 * record, a replay of an unfinished run or a fork more real than its source
 * refused, a double submit starting one replay; and the rows leave with
 * their run, a replay keeping how it came to be. */
import type { Sql } from 'postgres';

import { createRecorder } from '../../../lib/engine/core/record/recorder.ts';
import type { NodeRunRecord } from '../../../lib/engine/core/record/types.ts';
import { recordBudget } from '../../../lib/engine/core/record/value.ts';
import { jsonParam } from '../../db/sql.ts';
import { eraseSubjectAutomationRuns } from '../erasure/service.ts';
import {
  readOpenNodeRuns,
  recordNodeRunsStarted,
  writeNodeRunsInTx,
} from './node-runs.ts';
import { readReplayPlan, replayRunInTx } from './replay.ts';
import {
  readNodeDetail,
  readNodePage,
  readRunComparison,
  readRunRecord,
} from './run-record.ts';
import {
  AutomationError,
  beginRun,
  decodeRunInput,
  deploy,
  recordProgress,
  saveVersion,
} from './store.ts';
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
      nodes: [
        { id: 'one', type: 'transform', input: {}, code: 'return 1;' },
        {
          id: 'two',
          type: 'transform',
          input: { x: '{{ nodes.one.output }}' },
          code: 'return input.x;',
        },
      ],
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

  // ---- what jsonb refuses never fails the write: half an emoji and a NUL
  // character in a step's output are kept as U+FFFD, and the write commits.
  const odd = createRecorder({ now: () => Date.now(), budget: recordBudget() });
  const oddKey = { path: 'odd', item: -1, pass: -1 };
  odd.unitStarted(oddKey, { nodeId: 'odd', nodeType: 'transform' });
  odd.unitFinished(oddKey, {
    status: 'ok',
    output: { value: 'cut \ud83d and nul \u0000' },
  });
  await sql.begin(async (tx) => {
    await writeNodeRunsInTx(tx, {
      organizationId: orgId,
      runId,
      epoch: 2,
      rows: odd.drain(),
    });
  });
  const storable = (await rowsOf(runId)).find((r) => r.path === 'odd');
  record(
    'a step output jsonb would refuse is stored as it can be, never failing the write',
    JSON.stringify(storable?.output ?? null).includes(
      'cut \ufffd and nul \ufffd',
    ),
    `odd=${JSON.stringify(storable)}`,
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

  // ---- a step's items page in order; a unit reads whole with its call.
  const items = createRecorder({
    now: () => Date.now(),
    budget: recordBudget(),
  });
  const stepKey = { path: 'one', item: -1, pass: -1 };
  items.unitStarted(stepKey, { nodeId: 'one', nodeType: 'transform' });
  for (const [item, status] of [
    [0, 'ok'],
    [1, 'failed'],
    [2, 'ok'],
  ] as const) {
    const key = { path: 'one', item, pass: -1 };
    items.unitStarted(key, { nodeId: 'one', nodeType: 'transform' });
    items.unitInput(key, { n: item });
    items.unitFinished(key, { status, output: { n: item * 10 } });
  }
  items.unitFinished(stepKey, { status: 'failed' });
  await sql.begin(async (tx) => {
    await writeNodeRunsInTx(tx, {
      organizationId: orgId,
      runId,
      epoch: 2,
      rows: items.drain(),
    });
    await markAutomationWriterInTx(tx);
    await tx`
      INSERT INTO app.automation_node_attempts
        (run_id, org_id, node_id, item_index, pass, attempt, kind, node_type,
         status, input, output, lease_owner, claim_epoch, started_at_ms,
         finished_at_ms)
      VALUES (${runId}, ${orgId}, 'one', 2, 0, 1, 'connector', 'transform',
        'done',
        ${jsonParam(tx, { token: `ghp_${'q'.repeat(36)}`, n: 2 })}::jsonb,
        ${jsonParam(tx, { n: 20 })}::jsonb, ${seenBy}, 2, ${Date.now()},
        ${Date.now()})
    `;
  });
  const firstPage = await readNodePage(sql, {
    organizationId: orgId,
    runId,
    path: 'one',
    limit: 2,
  });
  const secondPage = await readNodePage(sql, {
    organizationId: orgId,
    runId,
    path: 'one',
    limit: 2,
    ...(firstPage?.next != null && { cursor: firstPage.next }),
  });
  const failedPage = await readNodePage(sql, {
    organizationId: orgId,
    runId,
    path: 'one',
    status: 'failed',
  });
  let unreadable = 'accepted';
  try {
    await readNodePage(sql, {
      organizationId: orgId,
      runId,
      path: 'one',
      cursor: 'x',
    });
  } catch (error) {
    unreadable = error instanceof AutomationError ? error.code : String(error);
  }
  const itemDetail = await readNodeDetail(sql, {
    organizationId: orgId,
    runId,
    path: 'one',
    item: 2,
  });
  const stepDetail = await readNodeDetail(sql, {
    organizationId: orgId,
    runId,
    path: 'one',
  });
  const ghost = await readNodeDetail(sql, {
    organizationId: orgId,
    runId,
    path: 'one',
    item: 9,
  });
  const unitsOf = (page: typeof firstPage) =>
    JSON.stringify(page?.units.map((u) => `${u.item}:${u.status}`));
  record(
    "a step's items page in order, failed ones alone on request; a unit reads whole with its call, its secrets withheld",
    unitsOf(firstPage) === '["0:succeeded","1:failed"]' &&
      firstPage?.next === '1:-1' &&
      unitsOf(secondPage) === '["2:succeeded"]' &&
      secondPage?.next === null &&
      unitsOf(failedPage) === '["1:failed"]' &&
      unreadable === 'INVALID_CURSOR' &&
      JSON.stringify(itemDetail?.output?.value) === '{"n":20}' &&
      itemDetail?.call?.status === 'done' &&
      !JSON.stringify(itemDetail.call).includes('ghp_') &&
      !JSON.stringify(itemDetail.call).includes(seenBy) &&
      stepDetail?.counts?.items === 3 &&
      stepDetail.call === undefined &&
      ghost === null,
    `pages=${unitsOf(firstPage)}→${firstPage?.next}, ${unitsOf(secondPage)}→${secondPage?.next}, failed=${unitsOf(failedPage)} cursor=${unreadable} item=${JSON.stringify(itemDetail?.output?.value)} call=${JSON.stringify(itemDetail?.call ?? null).slice(0, 160)} step=${JSON.stringify(stepDetail?.counts)}/${stepDetail?.call === undefined} ghost=${ghost === null}`,
  );

  // ---- two runs of one automation compare; two of different ones do not.
  const again = await beginRun(sql, {
    organizationId: orgId,
    name,
    input: { who: 'grace' },
    mode: 'mock',
    startedBy: userId,
    requireOrgScope: true,
  });
  const otherName = 'itest/node-runs-other';
  await saveVersion(sql, {
    organizationId: orgId,
    name: otherName,
    document: {
      version: 1,
      name: otherName,
      nodes: [{ id: 'one', type: 'transform', input: {}, code: 'return 1;' }],
    },
    actor: userId,
  });
  await deploy(sql, {
    organizationId: orgId,
    name: otherName,
    version: 1,
    actor: userId,
  });
  const other = await beginRun(sql, {
    organizationId: orgId,
    name: otherName,
    input: {},
    mode: 'mock',
    startedBy: userId,
    requireOrgScope: true,
  });
  const diff = await readRunComparison(sql, {
    organizationId: orgId,
    runId,
    otherRunId: again?.runId ?? '',
  });
  let mismatch = 'accepted';
  try {
    await readRunComparison(sql, {
      organizationId: orgId,
      runId,
      otherRunId: other?.runId ?? '',
    });
  } catch (error) {
    mismatch = error instanceof AutomationError ? error.code : String(error);
  }
  record(
    'two runs of one automation compare from their records; two of different automations are refused',
    diff?.input.equal === false &&
      diff.input.changes.some((c) => c.pointer === '/who') &&
      diff.version.same &&
      mismatch === 'RUN_COMPARE_MISMATCH',
    `input=${JSON.stringify(diff?.input.changes.map((c) => c.pointer))} same=${diff?.version.same} mismatch=${mismatch}`,
  );
  await sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    await tx`
      DELETE FROM app.automation_runs
      WHERE id IN (${again?.runId ?? ''}, ${other?.runId ?? ''})
    `;
  });

  // ---- a run runs again: whole, or from a step, keeping what it finished.
  await sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    await tx`
      UPDATE app.automation_runs SET
        status = 'success', finished_at_ms = ${Date.now()},
        checkpoints = ${jsonParam(tx, {
          nodes: {
            one: {
              status: 'ok',
              output: 1,
              trace: { node: 'one', type: 'transform', status: 'ok' },
              effects: [],
            },
            two: {
              status: 'ok',
              output: 1,
              trace: { node: 'two', type: 'transform', status: 'ok' },
              effects: [],
            },
          },
          executions: 2,
        })}::jsonb
      WHERE id = ${runId}
    `;
  });
  const fromTwo = { kind: 'from' as const, from: 'two' };
  const plan = await readReplayPlan(sql, {
    organizationId: orgId,
    sourceRunId: runId,
    request: fromTwo,
    canStartLive: false,
  });
  const fork = await sql.begin((tx) =>
    replayRunInTx(tx, {
      organizationId: orgId,
      sourceRunId: runId,
      request: fromTwo,
      startedBy: userId,
      canStartLive: false,
      idempotencyKey: 'fork-1',
    }),
  );
  const forkAgain = await sql.begin((tx) =>
    replayRunInTx(tx, {
      organizationId: orgId,
      sourceRunId: runId,
      request: fromTwo,
      startedBy: userId,
      canStartLive: false,
      idempotencyKey: 'fork-1',
    }),
  );
  const forkRun = (
    await sql<
      {
        replayOf: string | null;
        kind: string | null;
        fromNode: string | null;
        checkpoints: { nodes: Record<string, { reused?: { runId: string } }> };
        input: unknown;
      }[]
    >`
      SELECT replay_of_run_id AS "replayOf", replay_kind AS kind,
             replay_from_node AS "fromNode", checkpoints, input
      FROM app.automation_runs WHERE id = ${fork?.runId ?? ''}
    `
  )[0];
  const forkRows = await sql<{ path: string; reused: string | null }[]>`
    SELECT path, record -> 'meta' -> 'reused' ->> 'runId' AS reused
    FROM app.automation_node_runs
    WHERE run_id = ${fork?.runId ?? ''} AND item_index = -1 AND pass = -1
    ORDER BY path
  `;
  record(
    'a fork is born with the steps it reuses — finished, marked, their record copied — and says what it replays; a double submit starts it once',
    plan?.refusal === undefined &&
      JSON.stringify(plan?.reuse.map((r) => r.nodeId)) === '["one"]' &&
      JSON.stringify(plan?.rerun.map((r) => r.nodeId)) === '["two"]' &&
      fork?.reused === 1 &&
      forkRun?.replayOf === runId &&
      forkRun.kind === 'from' &&
      forkRun.fromNode === 'two' &&
      forkRun.checkpoints.nodes.one?.reused?.runId === runId &&
      forkRun.checkpoints.nodes.two === undefined &&
      forkRows.some((r) => r.path === 'one' && r.reused === runId) &&
      forkRows.some((r) => r.path === '__start' && r.reused === null) &&
      forkAgain?.duplicate === true &&
      forkAgain.runId === fork?.runId,
    `plan=${JSON.stringify(plan?.reuse)}/${JSON.stringify(plan?.rerun.map((r) => r.nodeId))} fork=${JSON.stringify(fork)} row=${JSON.stringify({ ...forkRun, input: undefined })} rows=${JSON.stringify(forkRows)} again=${JSON.stringify(forkAgain)}`,
  );

  const refusalOf = async (
    sourceRunId: string,
    request: Parameters<typeof replayRunInTx>[1]['request'],
  ): Promise<string> => {
    try {
      await sql.begin((tx) =>
        replayRunInTx(tx, {
          organizationId: orgId,
          sourceRunId,
          request,
          startedBy: userId,
          canStartLive: true,
        }),
      );
      return 'started';
    } catch (error) {
      return error instanceof AutomationError ? error.code : String(error);
    }
  };
  const rerunWhole = await sql.begin((tx) =>
    replayRunInTx(tx, {
      organizationId: orgId,
      sourceRunId: runId,
      request: { kind: 'again' },
      startedBy: userId,
      canStartLive: false,
    }),
  );
  const wholeRun = (
    await sql<{ kind: string | null; input: unknown; nodes: number }[]>`
      SELECT replay_kind AS kind, input,
             (SELECT count(*)::int FROM jsonb_object_keys(checkpoints -> 'nodes'))
               AS nodes
      FROM app.automation_runs WHERE id = ${rerunWhole?.runId ?? ''}
    `
  )[0];
  const unfinished = await refusalOf(rerunWhole?.runId ?? '', fromTwo);
  const moreReal = await refusalOf(runId, { ...fromTwo, mode: 'live' });
  const unknownStep = await refusalOf(runId, { kind: 'from', from: 'ghost' });
  record(
    'a run runs again whole with its own input; an unfinished run, a fork more real than its source and a step that is not there are refused',
    wholeRun?.kind === 'again' &&
      JSON.stringify(decodeRunInput(wholeRun.input)) === '{"who":"ada"}' &&
      wholeRun.nodes === 0 &&
      unfinished === 'REPLAY_RUN_NOT_FINISHED' &&
      moreReal === 'REPLAY_MODE_MISMATCH' &&
      unknownStep === 'REPLAY_NODE_UNKNOWN',
    `whole=${JSON.stringify(wholeRun)} unfinished=${unfinished} moreReal=${moreReal} unknown=${unknownStep}`,
  );

  // ---- erasing a person takes the runs that replay theirs with them.
  const subject = `itest-erased-${Date.now()}`;
  const subjectRun = await beginRun(sql, {
    organizationId: orgId,
    name,
    input: { who: 'noah' },
    mode: 'mock',
    startedBy: `user:${subject}`,
    requireOrgScope: true,
  });
  await sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    await tx`
      UPDATE app.automation_runs SET status = 'failed',
        finished_at_ms = ${Date.now()}
      WHERE id = ${subjectRun?.runId ?? ''}
    `;
  });
  const colleagueReplay = await sql.begin((tx) =>
    replayRunInTx(tx, {
      organizationId: orgId,
      sourceRunId: subjectRun?.runId ?? '',
      request: { kind: 'again' },
      startedBy: userId,
      canStartLive: false,
    }),
  );
  const erased = await eraseSubjectAutomationRuns(sql, orgId, subject);
  const left = await sql<{ id: string }[]>`
    SELECT id FROM app.automation_runs
    WHERE id IN (${subjectRun?.runId ?? ''}, ${colleagueReplay?.runId ?? ''})
  `;
  record(
    'erasing a person removes their runs and the runs that replay them [ERASE-R10]',
    erased.deleted === 2 && left.length === 0,
    `deleted=${erased.deleted} left=${left.length}`,
  );

  // ---- the rows leave with their run; a replay keeps how it came to be.
  await sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    await tx`DELETE FROM app.automation_runs WHERE id = ${runId}`;
  });
  const gone = await rowsOf(runId);
  const orphan = (
    await sql<{ replayOf: string | null; kind: string | null }[]>`
      SELECT replay_of_run_id AS "replayOf", replay_kind AS kind
      FROM app.automation_runs WHERE id = ${fork?.runId ?? ''}
    `
  )[0];
  record(
    'the run record leaves with its run, and a replay of it still says it was one',
    gone.length === 0 && orphan?.replayOf === null && orphan.kind === 'from',
    `rows left=${gone.length} replay=${JSON.stringify(orphan)}`,
  );
  await sql.begin(async (tx) => {
    await markAutomationWriterInTx(tx);
    await tx`
      DELETE FROM app.automation_runs
      WHERE id IN (${fork?.runId ?? ''}, ${rerunWhole?.runId ?? ''})
    `;
  });
}
