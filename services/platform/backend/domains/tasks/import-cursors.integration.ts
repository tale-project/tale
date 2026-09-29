/** Real Postgres proof of a scheduled issue import that resumes across its
 * occurrences (`import-cursors.ts`, migration 0140).
 *
 * The minute scan fires a project-bound automation shaped like the
 * autonomous cycle's intake: read the source's position
 * (`task.get_import_cursor`), import ONE batch from it through a
 * subautomation, save the importer's `nextCursor` (`task.save_import_cursor`)
 * and post a receipt. The subautomation stands in for the vendor importer:
 * a synthetic listing of {@link TOTAL} open issues paged {@link LIMIT} at a
 * time behind an opaque cursor, written through the real
 * `task.upsert_issues`, and failing on demand (a control task's title) the
 * way a vendor outage fails the real one.
 *
 * Proven: the third batch (page 3) arrives on the third saved occurrence and
 * drains the pass; a failed source saves nothing and its batch is resumed,
 * not skipped, by the next occurrence; the pass after a drain starts over;
 * a position that fails three reads in a row is restarted instead of being
 * retried forever; an overlapping save cannot move the pass backwards; and
 * another project's position is out of reach.
 *
 * And the compare token is the position's REVISION, not its cursor text:
 * a delayed save from a completed pass is refused although the fresh pass is
 * back at the same empty cursor; a save holding a position from before a
 * restart is refused although the new pass reaches the same cursor again; a
 * stale end-of-list cannot complete a running pass; and no revision repeats. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { deploy, saveVersion, setTrigger } from '../automations/store.ts';
import { scanScheduledTriggers } from '../automations/triggers.ts';
import { pgTaskStore } from '../connectors/task-store.ts';
import { IMPORT_CURSOR_MAX_ATTEMPTS } from './import-cursors.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

interface LaneCtx {
  orgId: string;
  userId: string;
}

const WAIT_MS = 45_000;
/** Open issues in the synthetic source, and the batch one occurrence
 * imports: three batches, the last one short. */
const TOTAL = 120;
const LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return predicate();
}

export async function checkImportCursorContinuation(
  sql: Sql,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const name = `itest/intake-${suffix}`;
  const importer = `itest/intake-source-${suffix}`;
  const source = `itest/source-${suffix}`;
  const store = pgTaskStore(sql);
  let controlTask = '';
  let receiptTask = '';

  const insertTask = async (projectId: string, title: string) => {
    const taskId = randomUUID();
    await sql`
      INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
        created_by, created_by_type, created_at_ms, updated_at_ms)
      VALUES (${taskId}, ${orgId}, ${projectId}, ${title}, 'todo',
        ${`c${suffix}${title.length}`}, ${userId}, 'user', ${now}, ${now})
    `;
    return taskId;
  };
  const cursorRow = async () => {
    const rows = await sql<
      {
        cursor: string | null;
        batch: number;
        attempts: number;
        lastDrainedAt: number | null;
      }[]
    >`
      SELECT next_cursor AS "cursor", batch, attempts,
             last_drained_at_ms::float8 AS "lastDrainedAt"
      FROM app.task_import_cursors
      WHERE org_id = ${orgId} AND project_id = ${projectA}
        AND external_system = 'github' AND source = ${source}
    `;
    return rows[0];
  };
  const imported = async (): Promise<number> => {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.tasks
      WHERE org_id = ${orgId} AND project_id = ${projectA}
        AND external_system = 'github'
        AND external_id LIKE ${`${source}#%`}
    `;
    return rows[0]?.count ?? -1;
  };
  const automationRuns = async (): Promise<number> => {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.automation_runs
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    return rows[0]?.count ?? -1;
  };
  /** One occurrence: make the current minute due, claim it, let the worker
   * land its run, read its output. */
  const fire = async (): Promise<{
    runId: string;
    status: string;
    output: Record<string, unknown> | null;
  }> => {
    const before = await automationRuns();
    await sql`
      UPDATE app.automation_triggers
      SET last_due_at_ms = ${Date.now() - 120_000}, last_fired_at_ms = NULL
      WHERE org_id = ${orgId} AND name = ${name}
    `;
    await scanScheduledTriggers(sql);
    const runs = await sql<{ id: string }[]>`
      SELECT id FROM app.automation_runs
      WHERE org_id = ${orgId} AND name = ${name}
      ORDER BY started_at_ms DESC, id DESC LIMIT 1
    `;
    const runId = runs[0]?.id ?? '';
    if ((await automationRuns()) === before || runId === '') {
      return { runId: '', status: 'not_fired', output: null };
    }
    await waitFor(async () => {
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM app.automation_runs WHERE id = ${runId}
      `;
      return ['success', 'failed', 'cancelled'].includes(rows[0]?.status ?? '');
    }, WAIT_MS);
    const rows = await sql<{ status: string; output: unknown }[]>`
      SELECT status, output FROM app.automation_runs WHERE id = ${runId}
    `;
    const output = rows[0]?.output;
    return {
      runId,
      status: rows[0]?.status ?? 'missing',
      output: isRecord(output) ? output : null,
    };
  };
  const part = (
    occurrence: { output: Record<string, unknown> | null },
    key: 'cursor' | 'source' | 'saved',
  ): Record<string, unknown> => {
    const value = occurrence.output?.[key];
    return isRecord(value) ? value : {};
  };
  const receipts = async (): Promise<string[]> => {
    const { comments } = await store.listComments({
      organizationId: orgId,
      taskId: receiptTask,
    });
    return comments.map((comment) => comment.body);
  };

  try {
    for (const [id, title] of [
      [projectA, 'Intake project'],
      [projectB, 'Neighbour project'],
    ] as const) {
      await sql`
        INSERT INTO app.projects (id, org_id, name, created_by,
                                  created_at_ms, updated_at_ms)
        VALUES (${id}, ${orgId}, ${title}, ${userId}, ${now}, ${now})
      `;
    }
    controlTask = await insertTask(projectA, 'ok');
    receiptTask = await insertTask(projectA, 'Intake receipts');
    const setSource = (state: 'ok' | 'fail') =>
      sql`UPDATE app.tasks SET title = ${state} WHERE id = ${controlTask}`;

    // The stand-in importer: the vendor importers' contract (cursor in,
    // `imported`/`created`/`nextCursor` out), one bounded batch per call.
    const importerDocument = {
      version: 1,
      name: importer,
      nodes: [
        {
          id: 'page',
          type: 'transform',
          input: {
            cursor: '{{ input.cursor ?? "" }}',
            limit: '{{ input.limit }}',
            fail: '{{ input.fail === true }}',
          },
          code: [
            "if (input.fail) throw new Error('itest: the source is unavailable');",
            `const total = ${TOTAL};`,
            "const offset = input.cursor === '' ? 0 : JSON.parse(input.cursor).offset;",
            'const end = Math.min(offset + input.limit, total);',
            'const syncedAt = Date.now();',
            'const issues = [];',
            'for (let n = offset + 1; n <= end; n++) {',
            `  const url = 'https://github.com/${source}/issues/' + n;`,
            `  const title = 'Source issue ' + n;`,
            `  issues.push({ externalSystem: 'github', externalId: '${source}#' + n, title, description: 'Synthetic', externalUrl: url, externalIssue: { id: '${suffix}-' + n, title, description: 'Synthetic', url, state: 'open', syncedAt, repositoryId: 4242, number: n } });`,
            '}',
            'return { issues, nextCursor: end < total ? JSON.stringify({ offset: end }) : null };',
          ].join('\n'),
        },
        {
          id: 'tasks',
          type: 'task.upsert_issues',
          input: {
            projectId: '{{ input.projectId }}',
            issues: '{{ nodes.page.output.issues }}',
          },
        },
        {
          id: 'report',
          type: 'transform',
          input: {
            tasks: '{{ nodes.tasks.output }}',
            nextCursor: '{{ nodes.page.output.nextCursor }}',
          },
          code: [
            'const created = input.tasks.filter((task) => task.created).length;',
            'return { imported: input.tasks.length, created, updated: input.tasks.length - created, truncated: input.nextCursor !== null, nextCursor: input.nextCursor };',
          ].join('\n'),
        },
      ],
      output: '{{ nodes.report.output }}',
    };
    const document = {
      version: 1,
      name,
      nodes: [
        { id: 'control', type: 'task.get', input: { taskId: controlTask } },
        {
          id: 'cursor',
          type: 'task.get_import_cursor',
          onError: 'continue',
          input: { projectId: projectA, externalSystem: 'github', source },
        },
        {
          id: 'source',
          type: 'subautomation',
          automation: importer,
          onError: 'continue',
          input: {
            projectId: projectA,
            limit: LIMIT,
            cursor: '{{ nodes.cursor.output.cursor }}',
            fail: '{{ nodes.control.output.title === "fail" }}',
          },
        },
        {
          id: 'saved',
          type: 'task.save_import_cursor',
          onError: 'continue',
          input: {
            projectId: projectA,
            externalSystem: 'github',
            source,
            revision: '{{ nodes.cursor.output.revision }}',
            next: '{{ nodes.source.output.nextCursor ?? "" }}',
          },
        },
        {
          id: 'receipt',
          type: 'task.comment',
          input: {
            taskId: receiptTask,
            body: 'Intake receipt — batch {{ nodes.saved.output.batch }}{{ nodes.cursor.output.resumed ? " (resumed)" : "" }}{{ nodes.cursor.output.restarted ? " (restarted)" : "" }}: {{ nodes.source.output.imported }} imported, {{ nodes.source.output.created }} new; {{ nodes.saved.output.drained ? "pass complete" : "continues next occurrence" }}.',
          },
        },
      ],
      output: {
        cursor: '{{ nodes.cursor.output }}',
        source: '{{ nodes.source.output }}',
        saved: '{{ nodes.saved.output }}',
      },
    };
    await saveVersion(sql, {
      organizationId: orgId,
      name: importer,
      document: importerDocument,
      actor: userId,
      projectId: projectA,
    });
    await deploy(sql, {
      organizationId: orgId,
      name: importer,
      version: 1,
      actor: userId,
    });
    await saveVersion(sql, {
      organizationId: orgId,
      name,
      document,
      actor: userId,
      projectId: projectA,
    });
    await deploy(sql, {
      organizationId: orgId,
      name,
      version: 1,
      actor: userId,
    });
    await setTrigger(sql, {
      organizationId: orgId,
      name,
      trigger: {
        kind: 'schedule',
        cron: '* * * * *',
        timezone: 'Europe/Zurich',
        enabled: true,
      },
      actor: userId,
    });

    // ---- occurrence 1: the first batch of a fresh pass ------------------
    const first = await fire();
    const afterFirst = await cursorRow();
    const firstCount = await imported();
    record(
      'import cursor: the first occurrence imports one batch of a fresh pass and saves where the next one starts',
      first.status === 'success' &&
        part(first, 'cursor').cursor === '' &&
        part(first, 'cursor').batch === 1 &&
        part(first, 'cursor').resumed === false &&
        part(first, 'source').imported === LIMIT &&
        part(first, 'saved').saved === true &&
        part(first, 'saved').drained === false &&
        part(first, 'saved').batch === 1 &&
        afterFirst?.cursor === JSON.stringify({ offset: LIMIT }) &&
        afterFirst.batch === 1 &&
        afterFirst.attempts === 0 &&
        firstCount === LIMIT,
      `run=${first.status} output=${JSON.stringify(first.output)} row=${JSON.stringify(afterFirst)} tasks=${firstCount}`,
    );

    // ---- occurrence 2: the source fails — nothing is saved --------------
    await setSource('fail');
    const failed = await fire();
    const afterFailed = await cursorRow();
    const failedCount = await imported();
    const failedReceipts = await receipts();
    record(
      'import cursor: an occurrence whose source fails saves nothing — the position and the tasks stay, no receipt claims the batch, and the run itself completes',
      failed.status === 'success' &&
        part(failed, 'cursor').batch === 2 &&
        part(failed, 'cursor').resumed === true &&
        failed.output?.source === null &&
        failed.output.saved === null &&
        afterFailed?.cursor === JSON.stringify({ offset: LIMIT }) &&
        afterFailed.batch === 1 &&
        afterFailed.attempts === 1 &&
        failedCount === LIMIT &&
        failedReceipts.length === 1,
      `run=${failed.status} output=${JSON.stringify(failed.output)} row=${JSON.stringify(afterFailed)} tasks=${failedCount} receipts=${failedReceipts.length}`,
    );

    // ---- occurrence 3: the next occurrence resumes the failed batch -----
    await setSource('ok');
    const resumed = await fire();
    const afterResumed = await cursorRow();
    const resumedCount = await imported();
    record(
      'import cursor: the next occurrence resumes the failed batch from the saved position instead of skipping or restarting it',
      resumed.status === 'success' &&
        part(resumed, 'cursor').cursor === JSON.stringify({ offset: LIMIT }) &&
        part(resumed, 'cursor').batch === 2 &&
        part(resumed, 'source').created === LIMIT &&
        part(resumed, 'saved').batch === 2 &&
        afterResumed?.cursor === JSON.stringify({ offset: 2 * LIMIT }) &&
        afterResumed.attempts === 0 &&
        resumedCount === 2 * LIMIT,
      `run=${resumed.status} output=${JSON.stringify(resumed.output)} row=${JSON.stringify(afterResumed)} tasks=${resumedCount}`,
    );

    // ---- occurrence 4: page 3 drains the pass ----------------------------
    const third = await fire();
    const afterThird = await cursorRow();
    const thirdCount = await imported();
    const thirdReceipts = await receipts();
    record(
      'import cursor: the third batch (page 3) imports the rest of the listing and completes the pass — every open issue is a task',
      third.status === 'success' &&
        part(third, 'cursor').batch === 3 &&
        part(third, 'source').imported === TOTAL - 2 * LIMIT &&
        part(third, 'saved').drained === true &&
        part(third, 'saved').batch === 3 &&
        afterThird?.cursor === null &&
        afterThird.batch === 0 &&
        typeof afterThird.lastDrainedAt === 'number' &&
        thirdCount === TOTAL &&
        thirdReceipts.length === 3 &&
        /batch 3 \(resumed\): 20 imported, 20 new; pass complete\./.test(
          thirdReceipts[2] ?? '',
        ),
      `run=${third.status} output=${JSON.stringify(third.output)} row=${JSON.stringify(afterThird)} tasks=${thirdCount} receipt=${JSON.stringify(thirdReceipts.at(-1))}`,
    );

    // ---- occurrence 5: after a drain, a fresh pass ------------------------
    const fresh = await fire();
    const afterFresh = await cursorRow();
    const freshCount = await imported();
    record(
      'import cursor: the occurrence after a drained pass starts a fresh one from the first batch, refreshing tasks without duplicating them',
      fresh.status === 'success' &&
        part(fresh, 'cursor').cursor === '' &&
        part(fresh, 'cursor').batch === 1 &&
        part(fresh, 'cursor').resumed === false &&
        part(fresh, 'source').imported === LIMIT &&
        part(fresh, 'source').created === 0 &&
        afterFresh?.cursor === JSON.stringify({ offset: LIMIT }) &&
        freshCount === TOTAL,
      `run=${fresh.status} output=${JSON.stringify(fresh.output)} row=${JSON.stringify(afterFresh)} tasks=${freshCount}`,
    );

    // ---- a position that keeps failing is restarted, not retried forever -
    await setSource('fail');
    const failures = [];
    for (let attempt = 0; attempt < IMPORT_CURSOR_MAX_ATTEMPTS; attempt++) {
      failures.push(await fire());
    }
    const afterFailures = await cursorRow();
    await setSource('ok');
    const restarted = await fire();
    const afterRestart = await cursorRow();
    record(
      `import cursor: after ${IMPORT_CURSOR_MAX_ATTEMPTS} failed reads of one position the next read starts the pass over, and says so`,
      failures.every(
        (occurrence) =>
          occurrence.status === 'success' && occurrence.output?.saved === null,
      ) &&
        afterFailures?.attempts === IMPORT_CURSOR_MAX_ATTEMPTS &&
        afterFailures.cursor === JSON.stringify({ offset: LIMIT }) &&
        part(restarted, 'cursor').restarted === true &&
        part(restarted, 'cursor').cursor === '' &&
        part(restarted, 'cursor').batch === 1 &&
        part(restarted, 'saved').batch === 1 &&
        afterRestart?.cursor === JSON.stringify({ offset: LIMIT }) &&
        afterRestart.attempts === 0,
      `failures=${JSON.stringify(failures.map((occurrence) => occurrence.output?.saved))} row=${JSON.stringify(afterFailures)} restart=${JSON.stringify(restarted.output?.cursor)} after=${JSON.stringify(afterRestart)}`,
    );

    // ---- an overlapping save cannot move the pass backwards --------------
    const caller = {
      kind: 'workflow' as const,
      runId: restarted.runId,
      nodeId: 'saved',
    };
    const firstRevision = String(part(first, 'cursor').revision);
    const stale = await store.saveImportCursor({
      organizationId: orgId,
      caller,
      projectId: projectA,
      externalSystem: 'github',
      source,
      revision: firstRevision,
      next: JSON.stringify({ offset: 7 }),
    });
    const afterStale = await cursorRow();
    record(
      'import cursor: a save from a position the pass has already left is refused as a conflict and writes nothing',
      !stale.saved &&
        stale.conflict &&
        stale.revision !== firstRevision &&
        afterStale?.cursor === JSON.stringify({ offset: LIMIT }) &&
        afterStale.batch === 1,
      `save=${JSON.stringify(stale)} row=${JSON.stringify(afterStale)}`,
    );

    // ---- the revision, not the cursor text, admits a save ----------------
    // Store calls on a source of its own, as runs racing across passes
    // would make them.
    const aba = `${source}/aba`;
    const at = {
      organizationId: orgId,
      caller,
      projectId: projectA,
      externalSystem: 'github' as const,
      source: aba,
    };
    const offset = (n: number) => JSON.stringify({ offset: n });
    const abaRow = async () => {
      const rows = await sql<
        { cursor: string | null; revision: string; batch: number }[]
      >`
        SELECT next_cursor AS "cursor", revision::text AS "revision", batch
        FROM app.task_import_cursors
        WHERE org_id = ${orgId} AND project_id = ${projectA}
          AND external_system = 'github' AND source = ${aba}
      `;
      return rows[0];
    };
    // A and B read the empty position; B saves a batch, then drains the
    // pass; C reads the fresh pass; A's delayed save must not move it.
    const readA = await store.getImportCursor(at);
    const readB = await store.getImportCursor(at);
    const savedB = await store.saveImportCursor({
      ...at,
      revision: readB.revision,
      next: offset(50),
    });
    const readB2 = await store.getImportCursor(at);
    const drainedB = await store.saveImportCursor({
      ...at,
      revision: readB2.revision,
      next: '',
    });
    const readC = await store.getImportCursor(at);
    const lateA = await store.saveImportCursor({
      ...at,
      revision: readA.revision,
      next: offset(50),
    });
    const afterLateA = await abaRow();
    record(
      'import cursor: a delayed save from a completed pass is refused although the fresh pass is back at the same empty cursor, so the fresh pass keeps its first batch',
      readA.cursor === '' &&
        readB.cursor === '' &&
        readA.revision === readB.revision &&
        savedB.saved &&
        readB2.cursor === offset(50) &&
        drainedB.saved &&
        drainedB.drained &&
        readC.cursor === '' &&
        readC.revision === drainedB.revision &&
        readC.revision !== readA.revision &&
        !lateA.saved &&
        lateA.conflict &&
        !lateA.drained &&
        afterLateA?.cursor === null &&
        afterLateA.revision === readC.revision &&
        afterLateA.batch === 0,
      `A=${JSON.stringify(readA)} B=${JSON.stringify(savedB)} drain=${JSON.stringify(drainedB)} C=${JSON.stringify(readC)} late A=${JSON.stringify(lateA)} row=${JSON.stringify(afterLateA)}`,
    );
    const savedC = await store.saveImportCursor({
      ...at,
      revision: readC.revision,
      next: offset(50),
    });
    const afterC = await abaRow();
    record(
      'import cursor: the fresh pass’s own reader still saves its first batch',
      savedC.saved &&
        !savedC.conflict &&
        savedC.batch === 1 &&
        afterC?.cursor === offset(50) &&
        afterC.revision === savedC.revision,
      `save=${JSON.stringify(savedC)} row=${JSON.stringify(afterC)}`,
    );
    // A holder of offset 50 stalls; three failed reads restart the pass; the
    // new pass saves offset 50 again; the holder's save must be refused.
    const holder = await store.getImportCursor(at);
    for (let read = 1; read < IMPORT_CURSOR_MAX_ATTEMPTS; read++) {
      await store.getImportCursor(at);
    }
    const restartRead = await store.getImportCursor(at);
    const beforeAgain = await store.saveImportCursor({
      ...at,
      revision: holder.revision,
      next: offset(100),
    });
    const again = await store.saveImportCursor({
      ...at,
      revision: restartRead.revision,
      next: offset(50),
    });
    const staleHolder = await store.saveImportCursor({
      ...at,
      revision: holder.revision,
      next: offset(100),
    });
    const afterHolder = await abaRow();
    record(
      'import cursor: a save still holding a position from before a restart is refused although the new pass reached the same cursor again',
      holder.cursor === offset(50) &&
        holder.revision === savedC.revision &&
        restartRead.restarted &&
        restartRead.cursor === '' &&
        restartRead.revision !== holder.revision &&
        !beforeAgain.saved &&
        beforeAgain.conflict &&
        again.saved &&
        again.batch === 1 &&
        !staleHolder.saved &&
        staleHolder.conflict &&
        afterHolder?.cursor === offset(50) &&
        afterHolder.revision === again.revision,
      `holder=${JSON.stringify(holder)} restart=${JSON.stringify(restartRead)} stale before=${JSON.stringify(beforeAgain)} again=${JSON.stringify(again)} stale after=${JSON.stringify(staleHolder)} row=${JSON.stringify(afterHolder)}`,
    );
    // A stale end-of-list: a drain from a spent revision cannot complete the
    // pass that is still running.
    const staleDrain = await store.saveImportCursor({
      ...at,
      revision: restartRead.revision,
      next: '',
    });
    const afterStaleDrain = await abaRow();
    const revisions = [
      readA.revision,
      savedB.revision,
      drainedB.revision,
      savedC.revision,
      restartRead.revision,
      again.revision,
    ];
    record(
      'import cursor: a stale end-of-list save cannot complete a running pass, and no revision repeats across saves, drains and restarts',
      !staleDrain.saved &&
        staleDrain.conflict &&
        !staleDrain.drained &&
        afterStaleDrain?.cursor === offset(50) &&
        afterStaleDrain.revision === again.revision &&
        new Set(revisions).size === revisions.length,
      `drain=${JSON.stringify(staleDrain)} row=${JSON.stringify(afterStaleDrain)} revisions=${JSON.stringify(revisions)}`,
    );

    // Two runs that read one position import the same batch: only the first
    // save counts. And a reader of the last batch, delayed past the drain
    // its twin made, cannot move the fresh pass.
    const twinA = await store.getImportCursor(at);
    const twinB = await store.getImportCursor(at);
    const twinSaveA = await store.saveImportCursor({
      ...at,
      revision: twinA.revision,
      next: offset(100),
    });
    const twinSaveB = await store.saveImportCursor({
      ...at,
      revision: twinB.revision,
      next: offset(100),
    });
    const lastA = await store.getImportCursor(at);
    const lastB = await store.getImportCursor(at);
    const drainA = await store.saveImportCursor({
      ...at,
      revision: lastA.revision,
      next: '',
    });
    const lateLastB = await store.saveImportCursor({
      ...at,
      revision: lastB.revision,
      next: offset(150),
    });
    const afterTwins = await abaRow();
    record(
      'import cursor: of two runs that read one position only the first save counts, and a reader of the last batch delayed past the drain cannot move the fresh pass',
      twinA.revision === twinB.revision &&
        twinSaveA.saved &&
        !twinSaveB.saved &&
        twinSaveB.conflict &&
        lastA.cursor === offset(100) &&
        lastA.revision === lastB.revision &&
        drainA.saved &&
        drainA.drained &&
        !lateLastB.saved &&
        lateLastB.conflict &&
        afterTwins?.cursor === null &&
        afterTwins.batch === 0 &&
        afterTwins.revision === drainA.revision,
      `twins=${JSON.stringify([twinSaveA, twinSaveB])} last=${JSON.stringify([drainA, lateLastB])} row=${JSON.stringify(afterTwins)}`,
    );

    // ---- another project's position is out of reach ----------------------
    let foreign = 'no refusal';
    try {
      await store.getImportCursor({
        organizationId: orgId,
        caller,
        projectId: projectB,
        externalSystem: 'github',
        source,
      });
    } catch (error) {
      foreign = error instanceof Error ? error.message : String(error);
    }
    const foreignRows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.task_import_cursors
      WHERE org_id = ${orgId} AND project_id = ${projectB}
    `;
    record(
      'import cursor: an automation reaches only the positions of the project it is bound to',
      // Refused by the run's own project, or by the automation's bindings.
      (foreign === 'Project not found' ||
        foreign === 'The automation is not bound to that project.') &&
        foreignRows[0]?.count === 0,
      `refusal=${foreign} rows=${foreignRows[0]?.count}`,
    );
  } finally {
    await sql`
      DELETE FROM app.automation_triggers
      WHERE org_id = ${orgId} AND name IN (${name}, ${importer})
    `;
    await sql`
      DELETE FROM app.automation_runs
      WHERE org_id = ${orgId} AND name IN (${name}, ${importer})
    `;
    await sql`
      DELETE FROM app.automation_deployments
      WHERE org_id = ${orgId} AND name IN (${name}, ${importer})
    `;
    await sql`
      DELETE FROM app.automation_project_bindings
      WHERE org_id = ${orgId} AND automation_name IN (${name}, ${importer})
    `;
    await sql`
      DELETE FROM app.automations
      WHERE org_id = ${orgId} AND name IN (${name}, ${importer})
    `;
    // Cascades to the tasks and the cursor rows.
    await sql`DELETE FROM app.projects WHERE id IN (${projectA}, ${projectB})`;
  }
}
