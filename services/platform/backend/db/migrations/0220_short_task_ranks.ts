/**
 * 0.5 app migration 0220: short ranks for the boards whose task ranks grew long.
 *
 * Until #4594 an append to a column — every created task, every status
 * change, every drop at the bottom — took the midpoint between the column's
 * last rank and the alphabet's end, which grows a key a digit every six
 * appends: a load run's board held a rank of 7,319 characters after 44k
 * appends. #4594 counts appends within a key's length instead, so a column
 * whose last rank is that long keeps handing out keys that long. Every sort
 * and every index entry of the board pays for them, every board read carries
 * them, and every drop between two of its cards starts from them.
 *
 * Every board (project) that holds a rank longer than `LONG_RANK_LENGTH`
 * gets a new rank for each of its tasks — every column, archived tasks and
 * subtasks alike — in the order they stand. That is one order across the
 * board: by rank in code-unit order, as the board sorts (`compareRank`), so
 * each column, each parent's subtasks and a dispatch's queue keep theirs;
 * two tasks tied on a rank part in id order, the tie-break of the agents'
 * task reads. The new ranks are the rank module's own (`spacedRanks`), a few
 * characters each and valid for every drop and append after them. A board
 * whose ranks are all shorter keeps them, byte for byte.
 *
 * A TypeScript data migration because the new ranks are the rank module's
 * rule, which a SQL copy would freeze here. Every statement is written here,
 * against the schema as it stood at 0220: a database that jumps past several
 * releases runs this with the newest image's code, so only that pure rule is
 * imported.
 *
 * Idempotent: the new ranks are far below the threshold, so a second run
 * finds no board. Bounded: only the boards that hold a long rank are read; of
 * those, only the task ids come back, in the order Postgres sorts them; the
 * ranks are written 5,000 rows at a time. `updated_at_ms` stays as it was
 * (nobody changed a task) and no activity or audit row is written; the open
 * views of each rewritten board refetch once, through one org-wide `task`
 * hint naming the board, the one a label write sends.
 *
 * Rolling-deploy safe: the previous image reads and writes ranks as before,
 * and every rank written here is one it can drop between and append after. A
 * board's task rows are locked before its order is read, so a drop or a
 * status change the previous image makes meanwhile is either in the order
 * read or waits until this commits. A write that read the ranks before this
 * commits and writes after it (a task created on such a board in that
 * moment, say) keeps a rank among the old ones and can stand out of place
 * until it is moved. A `task_find` walk in board order across the upgrade
 * can list a task twice or skip one, as it can when any task moves.
 */

import type { TransactionSql } from 'postgres';

import { LONG_RANK_LENGTH, spacedRanks } from '../../core/tasks/rank.ts';

/** Rows one rank write sets. */
const RANKS_PER_WRITE = 5_000;

interface Board {
  projectId: string;
  orgId: string;
}

export async function migrate(tx: TransactionSql): Promise<void> {
  const boards = await tx<Board[]>`
    SELECT p.id AS "projectId", p.org_id AS "orgId"
    FROM app.projects p
    WHERE EXISTS (
      SELECT 1 FROM app.tasks t
      WHERE t.project_id = p.id AND length(t.rank) > ${LONG_RANK_LENGTH}
    )
    ORDER BY p.id COLLATE "C"
  `;
  const rewritten: Board[] = [];
  for (const board of boards) {
    // Locked first and read after, so the order read is the locked rows'.
    await tx`
      SELECT id FROM app.tasks WHERE project_id = ${board.projectId}
      FOR UPDATE
    `;
    const tasks = await tx<{ id: string; long: boolean }[]>`
      SELECT id, length(rank) > ${LONG_RANK_LENGTH} AS "long"
      FROM app.tasks
      WHERE project_id = ${board.projectId}
      ORDER BY rank COLLATE "C", id COLLATE "C"
    `;
    if (!tasks.some((task) => task.long)) continue;
    const ranks = spacedRanks(tasks.length);
    for (let from = 0; from < tasks.length; from += RANKS_PER_WRITE) {
      const to = from + RANKS_PER_WRITE;
      await tx`
        UPDATE app.tasks t SET rank = v.rank
        FROM unnest(
          ${tasks.slice(from, to).map((task) => task.id)}::text[],
          ${ranks.slice(from, to)}::text[]
        ) AS v(id, rank)
        WHERE t.id = v.id AND t.project_id = ${board.projectId}
      `;
    }
    rewritten.push(board);
  }
  if (rewritten.length === 0) return;
  // One org-wide `task` hint per board, the realtime outbox's row.
  await tx`
    INSERT INTO app_realtime.outbox (org_id, user_id, entity, entity_id)
    SELECT org_id, NULL, 'task', project_id
    FROM unnest(
      ${rewritten.map((board) => board.orgId)}::text[],
      ${rewritten.map((board) => board.projectId)}::text[]
    ) AS b(org_id, project_id)
  `;
}
