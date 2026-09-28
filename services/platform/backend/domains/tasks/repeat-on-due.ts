import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';

import { parseTaskRepeat } from '../../../lib/shared/task-repeat.ts';
import { organizationTableExists } from '../automations/triggers.ts';
import {
  automationOwnsTask,
  createDueRepeatCopy,
  REPEAT_OPEN_COPIES_MAX,
  repeatCopyDueAt,
} from './repeat.ts';
import type { TaskAssigneeType } from './service.ts';

/**
 * The due-date lane of repeating tasks (`tasks.repeat_on_due`, every five
 * minutes): a task whose rule says `createOn: 'dueDate'` is continued at the
 * start of its due day — midnight in the rule's zone — when it is still
 * open and has not continued its series yet. The task itself stays open;
 * closing it later creates nothing, because the copy already continues the
 * series — and deleting that copy does not make the task a candidate again.
 *
 * The query only narrows: open, top level, not archived, not continued yet,
 * the rule creating on the due date (the partial index `tasks_repeat_on_due`,
 * whose predicate the query repeats), in a live project, due no later than
 * {@link DUE_LOOKAHEAD_MS} from now. The rule's own zone decides whether the
 * day has begun, here and again by the writer under the task's lock — the
 * same writer a close uses (`createDueRepeatCopy` in `repeat.ts`), so a
 * close racing the scan, an overlapping scan or a retry still creates one
 * copy. Each task is its own transaction: one that fails is logged and
 * tried again on the next scan, and never holds up the rest.
 *
 * Nothing is created in the name of an organization that no longer exists;
 * a series that already has {@link REPEAT_OPEN_COPIES_MAX} open tasks waits
 * until someone closes one.
 */

/** A task date is a midnight in the zone of whoever picked it, up to twelve
 * hours from the rule's (`taskDateIn` reads the nearest midnight), and a DST
 * change can move it an hour or two more — so a due date this far ahead can
 * already have begun in the rule's zone. */
const DUE_LOOKAHEAD_MS = 14 * 60 * 60 * 1000;

const SCAN_PAGE_SIZE = 200;

/** A series held at the cap, or an organization's leftovers, are named at
 * most this often — the scan meets them every five minutes. */
const WARN_INTERVAL_MS = 60 * 60 * 1000;

/** When each capped task was last named, per process. */
const cappedWarnedAt = new Map<string, number>();
let orphanWarnedAt: number | null = null;

export interface RepeatOnDueResult {
  /** Candidates the query listed, across all pages. */
  examined: number;
  /** Tasks this scan continued. */
  created: number;
  /** Candidates whose due day has not begun in their rule's zone, or that
   * cannot repeat (a rule that no longer validates, an automation's task). */
  notDue: number;
  /** Due tasks the writer left alone under its lock — a close, an edit or
   * another scan got there first — or whose series it ended: an
   * automation's task whose person can no longer be carried over. */
  skipped: number;
  /** Due tasks whose series already has the most open tasks it may. */
  capped: number;
  /** Candidates of an organization that no longer exists — never
   * continued. */
  orphaned: number;
  /** Due tasks whose transaction failed; the next scan tries them again. */
  failed: number;
  /** Keyset pages the walk took. */
  pages: number;
}

interface Candidate {
  id: string;
  organizationId: string;
  dueDate: number;
  repeat: unknown;
  assigneeType: TaskAssigneeType | null;
  assigneeId: string | null;
  createdByType: string;
  orgMissing: boolean;
}

/** Name a capped task at most once an hour; forget the ones named long ago
 * so the memory stays bounded. */
function warnCapped(taskId: string, openCopies: number, now: number): void {
  const last = cappedWarnedAt.get(taskId);
  if (last !== undefined && now - last < WARN_INTERVAL_MS) return;
  if (cappedWarnedAt.size >= 1000) {
    for (const [id, at] of cappedWarnedAt) {
      if (now - at >= WARN_INTERVAL_MS) cappedWarnedAt.delete(id);
    }
  }
  cappedWarnedAt.set(taskId, now);
  console.warn(
    `[tasks] repeat on due: task ${taskId} is due, but its series already has ${openCopies} open tasks (at most ${REPEAT_OPEN_COPIES_MAX}); the next one is created once one of them is closed`,
  );
}

export async function createDueRepeatCopies(
  sql: Sql,
  options: {
    now?: number;
    pageSize?: number;
    /** The job's: the scan stops between tasks once it aborts. */
    signal?: AbortSignal | undefined;
  } = {},
): Promise<RepeatOnDueResult> {
  const now = options.now ?? Date.now();
  const pageSize = options.pageSize ?? SCAN_PAGE_SIZE;
  const result: RepeatOnDueResult = {
    examined: 0,
    created: 0,
    notDue: 0,
    skipped: 0,
    capped: 0,
    orphaned: 0,
    failed: 0,
    pages: 0,
  };
  // A pure worker can scan before Better Auth has created `organization`;
  // with no organization there is no task to continue.
  if (!(await organizationTableExists(sql))) return result;
  const orphans: string[] = [];
  let cursor: { dueDate: number; id: string } | null = null;
  for (;;) {
    // Keyset on (due date, id): every due candidate is visited once per
    // scan, whether this scan continues it or leaves it waiting.
    const page: Candidate[] = await sql<Candidate[]>`
      SELECT t.id, t.org_id AS "organizationId",
             t.due_date_ms::float8 AS "dueDate", t.repeat_rule AS "repeat",
             t.assignee_type AS "assigneeType", t.assignee_id AS "assigneeId",
             t.created_by_type AS "createdByType",
             NOT EXISTS (
               SELECT 1 FROM "organization" o WHERE o."id" = t.org_id
             ) AS "orgMissing"
      FROM app.tasks t
      WHERE t.repeat_continued_at_ms IS NULL
        AND t.archived_at_ms IS NULL
        AND t.parent_task_id IS NULL
        AND t.status NOT IN ('done', 'cancelled')
        AND (t.repeat_rule ->> 'createOn') = 'dueDate'
        AND t.due_date_ms <= ${now + DUE_LOOKAHEAD_MS}
        AND EXISTS (
          SELECT 1 FROM app.projects p
          WHERE p.id = t.project_id AND p.archived_at_ms IS NULL
        )
        AND (${cursor?.id ?? null}::text IS NULL
             OR (t.due_date_ms, t.id)
                > (${cursor?.dueDate ?? null}::bigint, ${cursor?.id ?? null}::text))
      ORDER BY t.due_date_ms, t.id
      LIMIT ${pageSize}
    `;
    result.pages++;
    result.examined += page.length;
    for (const candidate of page) {
      if (options.signal?.aborted) return summarize(result, orphans, now);
      if (candidate.orgMissing) {
        result.orphaned++;
        if (orphans.length < 5) orphans.push(candidate.id);
        continue;
      }
      try {
        const rule = parseTaskRepeat(candidate.repeat);
        const dueAt =
          rule === null ? null : repeatCopyDueAt(rule, candidate.dueDate);
        if (dueAt === null || dueAt > now || automationOwnsTask(candidate)) {
          result.notDue++;
          continue;
        }
        const written = await transactSerializable(sql, (tx) =>
          createDueRepeatCopy(tx, {
            organizationId: candidate.organizationId,
            taskId: candidate.id,
            now,
          }),
        );
        if (written.kind === 'created') {
          result.created++;
        } else if (written.kind === 'capped') {
          result.capped++;
          warnCapped(candidate.id, written.openCopies, now);
        } else {
          result.skipped++;
        }
      } catch (error) {
        result.failed++;
        console.error(
          `[tasks] repeat on due: task ${candidate.id} not continued; the next scan tries again`,
          error,
        );
      }
    }
    const last = page.at(-1);
    if (last === undefined || page.length < pageSize) break;
    cursor = { dueDate: last.dueDate, id: last.id };
  }
  return summarize(result, orphans, now);
}

/** The scan's one line about organizations that are gone — their rows are
 * the teardown's to remove, not this scan's — at most once an hour. */
function summarize(
  result: RepeatOnDueResult,
  orphans: readonly string[],
  now: number,
): RepeatOnDueResult {
  if (
    result.orphaned > 0 &&
    (orphanWarnedAt === null || now - orphanWarnedAt >= WARN_INTERVAL_MS)
  ) {
    orphanWarnedAt = now;
    const more = result.orphaned - orphans.length;
    console.warn(
      `[tasks] repeat on due: ${result.orphaned} due task(s) belong to an organization that no longer exists and are never continued: ${orphans.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`,
    );
  }
  return result;
}
