/** Real Postgres proof of the issue sync (`task.sync_issues`): the position
 * store (migrations 0140, 0211), the per-issue writes and the receipts, over
 * a synthetic tracker that stands in for GitHub behind the connector door.
 *
 * Proven: each run reads a source's next batch from its saved position and a
 * drain starts the next pass without twin tasks; one issue the task domain
 * refuses rolls back alone while the rest of its batch is written; a rate
 * limit keeps its wait on the position and the runs before it is over leave
 * the tracker alone; three refused batches restart the pass, a stale cursor
 * restarts it at once; two overlapping runs of one source save once and the
 * other's receipt says conflict; an issue closed upstream leaves its task's
 * status alone; the store takes any adapter slug and refuses a malformed
 * one; and an archived project stops the step before any tracker is read. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import type {
  ConnectorCaller,
  ConnectorDispatchResult,
} from '../../../lib/connectors/dispatcher.ts';
import {
  IssueCursorError,
  IssueSourceHttpError,
} from '../../../lib/connectors/natives/issue-import.ts';
import {
  IssueSyncProjectRefusal,
  type IssueSourceReceipt,
} from '../../../lib/connectors/natives/issue-sync.ts';
import { pgTaskStore } from '../connectors/task-store.ts';
import {
  readSyncPosition,
  saveImportCursor,
  waitSyncPosition,
} from './import-cursors.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

/** What the sync hands the stand-in tracker: a listing's or a refresh's
 * input. */
const callInput = z
  .object({
    repo: z.string().optional(),
    labels: z.string().optional(),
    limit: z.number().optional(),
    cursor: z.string().optional(),
    issues: z
      .array(z.object({ externalId: z.string() }).passthrough())
      .optional(),
  })
  .passthrough();

/** The stand-in tracker's own cursor. */
const cursorOffset = z.object({
  offset: z.number().int().nonnegative(),
  labels: z.string().optional(),
});

interface LaneCtx {
  orgId: string;
  userId: string;
}

/** One synthetic repository: its open issues `1..total`, and what it does
 * to the next calls. */
interface FakeRepository {
  total: number;
  repositoryId: number;
  closed: Set<number>;
  /** Refuse the next listings with a 500. */
  failNext: number;
  /** Answer every listing with a rate limit until then. */
  limitedUntil: number | null;
  /** Hold a listing until `release` resolves (an overlapping run). */
  hold?: Promise<void>;
  /** Issues whose refresh the tracker refuses (403). */
  refuseRefresh: Set<number>;
  /** Issues whose title carries a NUL character, which Postgres refuses. */
  nulTitles: Set<number>;
}

const ok = (output: unknown): ConnectorDispatchResult => ({
  status: 'ok',
  connector: 'github',
  action: 'list_import_issues',
  nodeType: 'github.list_import_issues',
  mode: 'live',
  backend: 'native',
  effects: 'read',
  output,
});

export async function checkIssueSync(
  sql: Sql,
  ctx: LaneCtx,
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const owner = `itest-${suffix}`;
  const now = Date.now();
  const projectId = randomUUID();
  const archivedId = randomUUID();
  const repositories = new Map<string, FakeRepository>();
  const calls: Array<{
    action: string;
    repo: string;
    cursor?: string;
    ids?: string[];
  }> = [];
  const caller: ConnectorCaller = {
    kind: 'system',
    reason: 'issue sync integration proof',
  };

  const repository = (repo: string, total: number): FakeRepository => {
    const created: FakeRepository = {
      total,
      repositoryId: 7_000_000 + repositories.size,
      closed: new Set(),
      failNext: 0,
      limitedUntil: null,
      refuseRefresh: new Set(),
      nulTitles: new Set(),
    };
    repositories.set(repo, created);
    return created;
  };
  const issue = (repo: string, at: FakeRepository, n: number) => {
    const url = `https://github.com/${owner}/${repo}/issues/${n}`;
    const title = at.nulTitles.has(n)
      ? `Broken\u0000 issue ${n}`
      : `Source issue ${n}`;
    return {
      externalSystem: 'github',
      externalId: `${owner}/${repo}#${n}`.toLowerCase(),
      externalUrl: url,
      title,
      description: 'Synthetic',
      externalIssue: {
        id: `${suffix}-${repo}-${n}`,
        title,
        description: 'Synthetic',
        url,
        state: at.closed.has(n) ? 'closed' : 'open',
        syncedAt: Date.now(),
        repositoryId: at.repositoryId,
        number: n,
      },
    };
  };
  // The stand-in tracker, behind the same door the sync reads GitHub
  // through: the listing pages by an offset cursor, the refresh answers its
  // report.
  const runConnector = async (args: {
    action: string;
    input: unknown;
  }): Promise<ConnectorDispatchResult> => {
    const input = callInput.parse(args.input);
    if (args.action === 'list_import_issues') {
      const repo = input.repo ?? '';
      const at = repositories.get(repo);
      if (at === undefined) throw new Error(`no synthetic repository ${repo}`);
      calls.push({
        action: args.action,
        repo,
        ...(input.cursor !== undefined && { cursor: input.cursor }),
      });
      if (at.hold !== undefined) await at.hold;
      if (at.limitedUntil !== null) {
        throw new IssueSourceHttpError(
          'GitHub rate-limited the issue sync (HTTP 429).',
          {
            status: 429,
            retryAfter: at.limitedUntil,
            action: 'github.list_import_issues',
          },
        );
      }
      if (at.failNext > 0) {
        at.failNext--;
        throw new IssueSourceHttpError('GitHub issue sync failed (HTTP 500).', {
          status: 500,
          retryAfter: null,
          action: 'github.list_import_issues',
        });
      }
      if (input.cursor === 'stale') {
        throw new IssueCursorError(
          'The issue cursor belongs to another source or filter. Start a new import.',
        );
      }
      // The cursor remembers the label filter it was read under, as the
      // importers' cursors do: read under another filter, it is stale.
      const labels = input.labels ?? '';
      const at0 =
        input.cursor === undefined
          ? { offset: 0, labels }
          : cursorOffset.parse(JSON.parse(input.cursor));
      if ((at0.labels ?? '') !== labels) {
        throw new IssueCursorError(
          'The issue cursor belongs to another source or filter. Start a new import.',
        );
      }
      const offset = at0.offset;
      const end = Math.min(offset + (input.limit ?? 100), at.total);
      const issues = [];
      for (let n = offset + 1; n <= end; n++) issues.push(issue(repo, at, n));
      return ok({
        issues,
        truncated: end < at.total,
        nextCursor:
          end < at.total ? JSON.stringify({ offset: end, labels }) : null,
        repositoryId: at.repositoryId,
        legacyPrefixes: [`${owner}/${repo}#`.toLowerCase()],
      });
    }
    const refreshed = [];
    const failed = [];
    for (const linked of input.issues ?? []) {
      const [, repo = '', number = '0'] =
        /\/([^/#]+)#(\d+)$/.exec(linked.externalId) ?? [];
      const at = [...repositories.entries()].find(
        ([name]) => name.toLowerCase() === repo,
      );
      if (at === undefined) throw new Error(`no synthetic ${repo}`);
      if (at[1].refuseRefresh.has(Number(number))) {
        failed.push({
          externalId: linked.externalId,
          error: 'unauthorized',
          status: 403,
        });
      } else {
        refreshed.push(issue(at[0], at[1], Number(number)));
      }
    }
    calls.push({
      action: args.action,
      repo: 'refresh',
      ids: (input.issues ?? []).map((linked) => linked.externalId),
    });
    return ok({ issues: refreshed, failed, notRead: 0, retryAfter: null });
  };
  const store = pgTaskStore(sql, { runConnector });
  const sync = async (
    repos: Array<string | { repo: string; labels: string }>,
    options: { project?: string; limit?: number; refreshLimit?: number } = {},
  ): Promise<IssueSourceReceipt[]> => {
    const result = await store.syncIssues({
      organizationId: orgId,
      caller,
      projectId: options.project ?? projectId,
      sources: repos.map((entry) =>
        typeof entry === 'string'
          ? { kind: 'github' as const, owner, repo: entry }
          : {
              kind: 'github' as const,
              owner,
              repo: entry.repo,
              labels: entry.labels,
            },
      ),
      limit: options.limit ?? 2,
      refreshLimit: options.refreshLimit ?? 0,
    });
    return result.sources;
  };
  const position = async (repo: string) => {
    const rows = await sql<
      {
        cursor: string | null;
        batch: number;
        attempts: number;
        retryAfter: number | null;
        lastDrainedAt: number | null;
      }[]
    >`
      SELECT next_cursor AS "cursor", batch, attempts,
             retry_after_ms::float8 AS "retryAfter",
             last_drained_at_ms::float8 AS "lastDrainedAt"
      FROM app.task_import_cursors
      WHERE org_id = ${orgId} AND project_id = ${projectId}
        AND external_system = 'github' AND source = ${`${owner}/${repo}`}
    `;
    return rows[0];
  };
  const tasksOf = async (repo: string): Promise<number> => {
    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.tasks
      WHERE org_id = ${orgId} AND project_id = ${projectId}
        AND external_system = 'github'
        AND external_id LIKE ${`${owner}/${repo}#%`.toLowerCase()}
    `;
    return rows[0]?.count ?? -1;
  };
  const listedSince = (from: number, repo: string) =>
    calls
      .slice(from)
      .filter(
        (call) => call.action === 'list_import_issues' && call.repo === repo,
      );

  for (const [id, archived] of [
    [projectId, false],
    [archivedId, true],
  ] as const) {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms,
                                updated_at_ms, archived_at_ms)
      VALUES (${id}, ${orgId}, 'Issue sync proof', ${userId}, ${now}, ${now},
              ${archived ? now : null})
    `;
  }

  // 1. Each run continues from the saved position; a drain starts over.
  repository('web', 5);
  const runs: IssueSourceReceipt[] = [];
  for (let run = 0; run < 4; run++) {
    const [receipt] = await sync(['web']);
    if (receipt !== undefined) runs.push(receipt);
  }
  const drained = await position('web');
  record(
    'issue sync: each run reads the next batch from the saved position, and a drain starts the next pass',
    runs.map((receipt) => receipt.created).join(',') === '2,2,1,0' &&
      runs.map((receipt) => receipt.batch).join(',') === '1,2,3,1' &&
      runs[2]?.drained &&
      !runs[3]?.resumed &&
      (await tasksOf('web')) === 5 &&
      drained?.lastDrainedAt != null,
    `created=${runs.map((receipt) => receipt.created).join(',')}, batches=${runs.map((receipt) => receipt.batch).join(',')}, tasks=${await tasksOf('web')}`,
  );

  // 1b. The refresh rotates through the linked tasks, the longest-unchecked
  // first, and moves on past an issue the tracker refuses.
  const webRepository = repositories.get('web');
  webRepository?.refuseRefresh.add(3);
  const refreshes = () =>
    calls.filter((call) => call.action === 'refresh_import_issues');
  const before1b = refreshes().length;
  const [rotationA] = await sync(['web'], { refreshLimit: 2 });
  const [rotationB] = await sync(['web'], { refreshLimit: 2 });
  webRepository?.refuseRefresh.clear();
  const [firstIds = [], secondIds = []] = refreshes()
    .slice(before1b)
    .map((call) => call.ids ?? []);
  record(
    'issue sync: the refresh rotates through the linked tasks and moves on past an issue the tracker refuses',
    firstIds.length === 2 &&
      secondIds.length === 2 &&
      firstIds.every((id) => !secondIds.includes(id)) &&
      firstIds.includes(`${owner}/web#3`.toLowerCase()) &&
      rotationA?.skipped === 1 &&
      rotationA.skippedIssues?.[0]?.reason === 'unauthorized' &&
      rotationA.saved &&
      rotationB?.skipped === 0,
    `first=${firstIds.join(',')}, second=${secondIds.join(',')}, skipped=${rotationA?.skipped}/${rotationB?.skipped}`,
  );

  // 2. One refused issue rolls back alone.
  repository('refuse', 3);
  await sql`
    INSERT INTO app.tasks (id, org_id, project_id, title, status, rank,
      external_system, external_id, external_source_id,
      created_by, created_by_type, created_at_ms, updated_at_ms)
    VALUES (${randomUUID()}, ${orgId}, ${projectId}, 'Held by another source',
      'todo', ${`r${suffix}`}, 'github', ${`${owner}/refuse#2`.toLowerCase()},
      ${`foreign-${suffix}`}, ${userId}, 'user', ${now}, ${now})
  `;
  const [refused] = await sync(['refuse'], { limit: 3 });
  record(
    'issue sync: one issue the task domain refuses rolls back alone, and the rest of its batch is written',
    refused?.ok &&
      refused.created === 2 &&
      refused.skipped === 1 &&
      refused.skippedIssues?.[0]?.reason === 'TASK_EXTERNAL_REF_INVALID' &&
      refused.saved &&
      (await tasksOf('refuse')) === 3,
    JSON.stringify(refused),
  );

  // 3. A rate limit keeps its wait, and the runs before it is over leave
  // the tracker alone.
  const busy = repository('busy', 2);
  const until = Date.now() + 10 * 60_000;
  busy.limitedUntil = until;
  const [limited] = await sync(['busy']);
  const waiting = await position('busy');
  const before = calls.length;
  const [held] = await sync(['busy']);
  const untouched = listedSince(before, 'busy').length === 0;
  busy.limitedUntil = null;
  await sql`
    UPDATE app.task_import_cursors SET retry_after_ms = ${Date.now() - 1}
    WHERE org_id = ${orgId} AND project_id = ${projectId}
      AND source = ${`${owner}/busy`}
  `;
  const [resumed] = await sync(['busy']);
  record(
    'issue sync: a rate limit keeps its wait on the position, and the runs before it is over leave the tracker alone',
    limited?.error === 'rate_limited' &&
      waiting?.retryAfter === until &&
      waiting.attempts === 0 &&
      held?.error === 'rate_limited' &&
      untouched &&
      resumed?.ok &&
      resumed.created === 2 &&
      // The passed wait stays on the row, and is not honoured any more.
      ((await position('busy'))?.retryAfter ?? Number.POSITIVE_INFINITY) <=
        Date.now(),
    `first=${limited?.error}, kept=${waiting?.retryAfter}, attempts=${waiting?.attempts}, untouched=${untouched}, after=${resumed?.created}`,
  );

  // 4. Three refused batches restart the pass.
  const flaky = repository('flaky', 3);
  await sync(['flaky'], { limit: 1 });
  flaky.failNext = 3;
  const failures: IssueSourceReceipt[] = [];
  for (let run = 0; run < 3; run++) {
    const [receipt] = await sync(['flaky'], { limit: 1 });
    if (receipt !== undefined) failures.push(receipt);
  }
  const counted = await position('flaky');
  const restartFrom = calls.length;
  const [restarted] = await sync(['flaky'], { limit: 1 });
  record(
    'issue sync: three refused batches in a row start the pass over',
    failures.every((receipt) => receipt.error === 'unavailable') &&
      counted?.attempts === 3 &&
      restarted?.restarted &&
      restarted.batch === 1 &&
      listedSince(restartFrom, 'flaky')[0]?.cursor === undefined,
    `errors=${failures.map((receipt) => receipt.error).join(',')}, attempts=${counted?.attempts}, restarted=${restarted?.restarted}`,
  );

  // 5. A position from another filter restarts at once.
  repository('stale', 2);
  await sql.begin((tx) =>
    readSyncPosition(tx, {
      organizationId: orgId,
      projectId,
      externalSystem: 'github',
      source: `${owner}/stale`,
    }),
  );
  await sql`
    UPDATE app.task_import_cursors SET next_cursor = 'stale', batch = 4
    WHERE org_id = ${orgId} AND project_id = ${projectId}
      AND source = ${`${owner}/stale`}
  `;
  const staleFrom = calls.length;
  const [fresh] = await sync(['stale']);
  record(
    'issue sync: a position saved under another filter starts the pass over at once',
    fresh?.ok &&
      fresh.restarted &&
      fresh.created === 2 &&
      listedSince(staleFrom, 'stale')
        .map((call) => call.cursor ?? '')
        .join(',') === 'stale,',
    JSON.stringify(listedSince(staleFrom, 'stale')),
  );

  // 6. Two overlapping runs of one source save once.
  const race = repository('race', 4);
  let release: () => void = () => undefined;
  race.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const racing = Promise.all([sync(['race']), sync(['race'])]);
  // Both runs read the position before either lists: release them together.
  while (listedSince(0, 'race').length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  delete race.hold;
  release();
  const raced = (await racing).flat();
  record(
    'issue sync: two overlapping runs of one source save once, and the other run says conflict',
    raced.filter((receipt) => receipt.saved).length === 1 &&
      raced.filter((receipt) => receipt.conflict).length === 1 &&
      (await tasksOf('race')) === 2 &&
      (await position('race'))?.batch === 1,
    JSON.stringify(
      raced.map(({ saved, conflict, created }) => ({
        saved,
        conflict,
        created,
      })),
    ),
  );

  // 7. An issue closed upstream leaves its task where it is.
  const web = repositories.get('web');
  web?.closed.add(1);
  await sql`
    UPDATE app.tasks SET status = 'in_progress'
    WHERE org_id = ${orgId} AND project_id = ${projectId}
      AND external_id = ${`${owner}/web#1`.toLowerCase()}
  `;
  const [refresh] = await sync(['web'], { refreshLimit: 50 });
  const closedRows = await sql<{ status: string; state: string | null }[]>`
    SELECT status, external_issue->>'state' AS state FROM app.tasks
    WHERE org_id = ${orgId} AND project_id = ${projectId}
      AND external_id = ${`${owner}/web#1`.toLowerCase()}
  `;
  record(
    'issue sync: an issue closed upstream records its state and leaves its task where it is',
    refresh?.closedUpstream === 1 &&
      closedRows[0]?.status === 'in_progress' &&
      closedRows[0].state === 'closed',
    `receipt=${refresh?.closedUpstream}, task=${closedRows[0]?.status}, source=${closedRows[0]?.state}`,
  );

  // 8. The position store takes any adapter slug and refuses a malformed one.
  await sql.begin((tx) =>
    readSyncPosition(tx, {
      organizationId: orgId,
      projectId,
      externalSystem: 'gitlab',
      source: `${owner}/web`,
    }),
  );
  let refusedSlug = '';
  try {
    await sql.begin((tx) =>
      readSyncPosition(tx, {
        organizationId: orgId,
        projectId,
        externalSystem: 'Git Lab',
        source: `${owner}/web`,
      }),
    );
  } catch (error) {
    refusedSlug =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : String(error);
  }
  const slugs = await sql<{ system: string }[]>`
    SELECT external_system AS system FROM app.task_import_cursors
    WHERE org_id = ${orgId} AND project_id = ${projectId}
      AND source = ${`${owner}/web`}
    ORDER BY external_system
  `;
  record(
    'issue sync: the position store takes any adapter slug and refuses a malformed one',
    slugs.map((row) => row.system).join(',') === 'github,gitlab' &&
      refusedSlug === '23514',
    `slugs=${slugs.map((row) => row.system).join(',')}, refused=${refusedSlug}`,
  );

  // 10. Two syncs of one repository under two label filters each continue
  // their own pass, instead of restarting each other's.
  repository('filters', 3);
  const filtered: IssueSourceReceipt[] = [];
  for (let run = 0; run < 2; run++) {
    for (const labels of ['bug', 'ui']) {
      filtered.push(
        ...(await sync([{ repo: 'filters', labels }], { limit: 1 })),
      );
    }
  }
  const filterRows = await sql<{ source: string }[]>`
    SELECT source FROM app.task_import_cursors
    WHERE org_id = ${orgId} AND project_id = ${projectId}
      AND source LIKE ${`${owner}/filters%`}
  `;
  record(
    'issue sync: two syncs of one repository under two label filters each continue their own pass',
    filtered.map((receipt) => receipt.batch).join(',') === '1,1,2,2' &&
      filtered.map((receipt) => receipt.resumed).join(',') ===
        'false,false,true,true' &&
      filtered.every((receipt) => !receipt.restarted && receipt.saved) &&
      filterRows.length === 2,
    JSON.stringify(
      filtered.map((receipt) => ({
        filter: receipt.filter,
        batch: receipt.batch,
        resumed: receipt.resumed,
        restarted: receipt.restarted,
      })),
    ),
  );

  // 11. An issue the database refuses as data is skipped, and the rest of
  // its batch is written and saved.
  const nul = repository('nul', 3);
  nul.nulTitles.add(2);
  const [withNul] = await sync(['nul'], { limit: 3 });
  record(
    'issue sync: an issue the database refuses as data is skipped, and the rest of its batch is written and saved',
    withNul?.ok &&
      withNul.created === 2 &&
      withNul.skipped === 1 &&
      (withNul.skippedIssues?.[0]?.reason.startsWith('SQLSTATE_22') ?? false) &&
      withNul.saved &&
      (await tasksOf('nul')) === 2,
    JSON.stringify(withNul),
  );

  // 12. A save that carries no wait keeps the wait a rate limit stored.
  const keepKey = {
    organizationId: orgId,
    projectId,
    externalSystem: 'github',
    source: `${owner}/waitkeep`,
  };
  const kept = Date.now() + 15 * 60_000;
  const keptRead = await sql.begin((tx) => readSyncPosition(tx, keepKey));
  await sql.begin((tx) => waitSyncPosition(tx, keepKey, { retryAfter: kept }));
  const keptSave = await sql.begin((tx) =>
    saveImportCursor(tx, keepKey, {
      revision: keptRead.revision,
      next: 'page-2',
    }),
  );
  const keptRows = await sql<{ retryAfter: number | null }[]>`
    SELECT retry_after_ms::float8 AS "retryAfter" FROM app.task_import_cursors
    WHERE org_id = ${orgId} AND project_id = ${projectId}
      AND external_system = 'github' AND source = ${keepKey.source}
  `;
  record(
    'issue sync: a save that carries no wait keeps the wait a rate limit stored',
    keptSave.saved && keptRows[0]?.retryAfter === kept,
    `saved=${keptSave.saved}, kept=${keptRows[0]?.retryAfter}, expected=${kept}`,
  );

  // 9. An archived project stops the step before any tracker is read.
  const archivedFrom = calls.length;
  let stopped = false;
  try {
    await sync(['web'], { project: archivedId });
  } catch (error) {
    stopped = error instanceof IssueSyncProjectRefusal;
  }
  record(
    'issue sync: an archived project stops the step before any tracker is read',
    stopped && calls.length === archivedFrom,
    `refused=${stopped}, calls=${calls.length - archivedFrom}`,
  );
}
