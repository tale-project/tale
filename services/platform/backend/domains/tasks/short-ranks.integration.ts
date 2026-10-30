/**
 * Migration 0220 on real Postgres (#4713): a board whose ranks the appends
 * before #4594 grew gets short ones in the order its tasks stand, once, and
 * its open views are told; a board whose ranks are all at most
 * `LONG_RANK_LENGTH` keeps its own; and the board's own writers drop between,
 * drop at the top and append on the ranks it wrote.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { compareRank } from '../../../lib/shared/task-rank-order.ts';
import { LONG_RANK_LENGTH, spacedRanks } from '../../core/tasks/rank.ts';
import { migrate as shortenTaskRanks } from '../../db/migrations/0220_short_task_ranks.ts';
import { createTask, moveTask } from './service.ts';

/** The append #4594 replaced: past the key's leading z's, the midpoint
 * between its first other digit and the alphabet's end. */
function walkedAppend(key: string): string {
  const at = key.search(/[^z]/);
  if (at === -1) return `${key}i`;
  const digit = parseInt(key.charAt(at), 36);
  return `${key.slice(0, at)}${Math.floor((digit + 36) / 2).toString(36)}`;
}

interface Seed {
  status: string;
  rank: string;
  parentId?: string;
}

interface TaskRankRow {
  id: string;
  status: string;
  rank: string;
  updatedAt: number;
}

/** The order a board sorts its tasks in, ties parted by id. */
function boardOrder(a: TaskRankRow, b: TaskRankRow): number {
  return (
    compareRank(a.rank, b.rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export async function checkTaskShortRanks(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const { orgId, userId } = ctx;
  const auth = {
    organizationId: orgId,
    userId,
    role: 'owner',
    teamIds: [] as string[],
  };
  const now = Date.now();
  const grown = randomUUID();
  const kept = randomUUID();
  for (const [id, name] of [
    [grown, 'Ranks grown long'],
    [kept, 'Ranks kept short'],
  ] as const) {
    await sql`
      INSERT INTO app.projects (id, org_id, name, created_by, created_at_ms, updated_at_ms)
      VALUES (${id}, ${orgId}, ${name}, ${userId}, ${now}, ${now})
    `;
  }
  // Each task updated a millisecond apart, so a rewrite that moved the clock
  // shows.
  const seed = async (projectId: string, tasks: Seed[]): Promise<string[]> => {
    const ids = tasks.map(() => randomUUID());
    await sql`
      INSERT INTO app.tasks (
        id, org_id, project_id, title, status, rank, parent_task_id,
        created_by, created_by_type, created_at_ms, updated_at_ms
      )
      SELECT t.id, ${orgId}, ${projectId}, 'Rank ' || t.n, t.status, t.rank,
        NULLIF(t.parent, ''), ${userId}, 'user', ${now}, ${now} - t.n
      FROM unnest(
        ${ids}::text[],
        ${tasks.map((task) => task.status)}::text[],
        ${tasks.map((task) => task.rank)}::text[],
        ${tasks.map((task) => task.parentId ?? '')}::text[]
      ) WITH ORDINALITY AS t(id, status, rank, parent, n)
    `;
    return ids;
  };
  const rowsOf = (projectId: string) =>
    sql<TaskRankRow[]>`
      SELECT id, status, rank, updated_at_ms::float8 AS "updatedAt"
      FROM app.tasks WHERE project_id = ${projectId}
      ORDER BY rank COLLATE "C", id COLLATE "C"
    `;
  // Run as the boot does: alone in its transaction. Its hints are counted
  // by the rows that transaction inserted itself.
  const runMigration = async (): Promise<string[]> => {
    let hinted: string[] = [];
    await sql.begin(async (tx) => {
      await shortenTaskRanks(tx);
      const own = await tx<{ entityId: string }[]>`
        SELECT entity_id AS "entityId" FROM app_realtime.outbox
        WHERE xmin = pg_current_xact_id()::xid AND entity = 'task'
          AND org_id = ${orgId} AND entity_id IN (${grown}, ${kept})
      `;
      hinted = own.map((row) => row.entityId);
    });
    return hinted;
  };

  // The grown board: 600 appends to Done under the old walk, three as long
  // as the load run's longest after them, To do with a tie on `r`, a parent
  // In progress with its subtask in To do, and an archived Done task.
  const walked = ['i'];
  while (walked.length < 600) {
    walked.push(walkedAppend(walked.at(-1) ?? 'i'));
  }
  const doneIds = await seed(grown, [
    ...walked.map((rank) => ({ status: 'done', rank })),
    ...['i', 'r', 'v'].map((last) => ({
      status: 'done',
      rank: `${'z'.repeat(7_318)}${last}`,
    })),
  ]);
  const [untouchedId = '', tieId = '', twinId = '', , pickedId = ''] =
    await seed(
      grown,
      ['i', 'r', 'r', 'v', 'x'].map((rank) => ({ status: 'todo', rank })),
    );
  const [parentId = ''] = await seed(grown, [
    { status: 'in_progress', rank: 'i' },
  ]);
  await seed(grown, [{ status: 'todo', rank: 'y', parentId }]);
  await sql`
    UPDATE app.tasks SET archived_at_ms = ${now} WHERE id = ${doneIds[300] ?? ''}
  `;
  // The kept board: one rank exactly at the threshold, none over it.
  await seed(kept, [
    { status: 'todo', rank: 'i' },
    { status: 'todo', rank: 'r' },
    { status: 'done', rank: `${'z'.repeat(LONG_RANK_LENGTH - 1)}i` },
    { status: 'done', rank: 'v' },
  ]);

  const grownBefore = [...(await rowsOf(grown))].sort(boardOrder);
  const keptBefore = await rowsOf(kept);
  const firstHints = await runMigration();
  const grownAfter = await rowsOf(grown);
  const keptAfter = await rowsOf(kept);
  const secondHints = await runMigration();
  const grownAgain = await rowsOf(grown);

  const before = new Map(grownBefore.map((row) => [row.id, row]));
  const ids = (rows: readonly TaskRankRow[]) =>
    JSON.stringify(rows.map((row) => row.id));
  const ranks = (rows: readonly TaskRankRow[]) =>
    JSON.stringify(rows.map((row) => [row.id, row.rank]));
  const longest = (rows: readonly TaskRankRow[]) =>
    Math.max(...rows.map((row) => row.rank.length));
  const orderKept = ids(grownAfter) === ids(grownBefore);
  const spaced =
    JSON.stringify(grownAfter.map((row) => row.rank)) ===
    JSON.stringify(spacedRanks(grownBefore.length));
  const clocksKept = grownAfter.every(
    (row) =>
      before.get(row.id)?.updatedAt === row.updatedAt &&
      before.get(row.id)?.status === row.status,
  );
  record(
    'migration 0220 gives a board whose ranks grew long short ones in the order its tasks stand, once, and tells its views',
    grownBefore.length === 610 &&
      longest(grownBefore) === 7_319 &&
      orderKept &&
      spaced &&
      longest(grownAfter) <= 3 &&
      clocksKept &&
      JSON.stringify(firstHints) === JSON.stringify([grown]) &&
      secondHints.length === 0 &&
      ranks(grownAgain) === ranks(grownAfter),
    `tasks=${grownBefore.length} (want 610), longest before=${longest(grownBefore)} (want 7319) after=${longest(grownAfter)} (want ≤ 3), order kept=${orderKept}, spaced=${spaced}, clocks and statuses kept=${clocksKept}, hints=${JSON.stringify(firstHints)} (want the grown board once), second run hints=${secondHints.length} (want 0) unchanged=${ranks(grownAgain) === ranks(grownAfter)}`,
  );
  record(
    `migration 0220 leaves a board whose ranks are all at most ${LONG_RANK_LENGTH} characters as it is`,
    keptBefore.length === 4 &&
      longest(keptBefore) === LONG_RANK_LENGTH &&
      ranks(keptAfter) === ranks(keptBefore) &&
      !firstHints.includes(kept),
    `ranks unchanged=${ranks(keptAfter) === ranks(keptBefore)}, longest=${longest(keptBefore)} (want ${LONG_RANK_LENGTH}), hinted=${firstHints.includes(kept)} (want false)`,
  );

  // On the new ranks: a drop between the two To do tasks tied on `r` (which
  // `rankBetween` refused before, so a drop there landed at the column's
  // end), a drop at the top of Done, and a task created into Done.
  const column = (rows: readonly TaskRankRow[], status: string) =>
    rows.filter((row) => row.status === status);
  const rankOf = (rows: readonly TaskRankRow[], id: string) =>
    rows.find((row) => row.id === id)?.rank ?? '';
  const [upper = '', lower = ''] = column(grownAgain, 'todo')
    .map((row) => row.id)
    .filter((id) => id === tieId || id === twinId);
  await sql.begin((tx) =>
    moveTask(tx, auth, {
      taskId: pickedId,
      status: 'todo',
      beforeTaskId: upper,
      afterTaskId: lower,
    }),
  );
  const firstDone = column(grownAgain, 'done')[0]?.id ?? '';
  const lastDone = column(grownAgain, 'done').at(-1)?.id ?? '';
  await sql.begin((tx) =>
    moveTask(tx, auth, {
      taskId: lastDone,
      status: 'done',
      afterTaskId: firstDone,
    }),
  );
  const appendedId = await sql.begin((tx) =>
    createTask(tx, auth, {
      projectId: grown,
      title: 'Created after the ranks were rewritten',
      status: 'done',
    }),
  );
  const moved = await rowsOf(grown);
  const picked = rankOf(moved, pickedId);
  const top = rankOf(moved, lastDone);
  const appended = rankOf(moved, appendedId);
  const done = column(moved, 'done');
  const between =
    rankOf(moved, upper) < picked && picked < rankOf(moved, lower);
  record(
    'a drop between two tasks once tied, a drop at the top and an append work on the ranks migration 0220 wrote',
    upper !== '' &&
      lower !== '' &&
      between &&
      picked.length <= 4 &&
      done[0]?.id === lastDone &&
      top < rankOf(moved, firstDone) &&
      top.length <= 4 &&
      done.at(-1)?.id === appendedId &&
      appended.length <= 3 &&
      rankOf(moved, untouchedId) === rankOf(grownAgain, untouchedId),
    `between=${between} (${rankOf(moved, upper)} < ${picked} < ${rankOf(moved, lower)}), top=${done[0]?.id === lastDone} (${top} < ${rankOf(moved, firstDone)}), appended last=${done.at(-1)?.id === appendedId} (${appended}), untouched neighbour kept=${rankOf(moved, untouchedId) === rankOf(grownAgain, untouchedId)}`,
  );
}
