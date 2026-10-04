import { isSerializationFailure } from '@tale/shared/db/serializable';
import { isEpochMs } from '@tale/shared/schemas/epoch-ms';
import { formatTaskIdentifier } from '@tale/shared/utils/project-key';
import type { TransactionSql } from 'postgres';

import {
  type CalendarDate,
  calendarDateIn,
  nextTaskRepeatDates,
  normalizeTaskRepeat,
  parseTaskRepeat,
  startOfCalendarDate,
  type TaskRepeat,
  taskDateIn,
  taskRepeatCreateOn,
  taskRepeatSchema,
} from '../../../lib/shared/task-repeat.ts';
import {
  TASK_AUDIT_ACTIONS,
  TASK_RESOURCE_TYPE,
} from '../../core/tasks/audit_actions.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { autoSubscribe } from '../collab/service.ts';
import { emitEvent } from '../events/emit.ts';
import {
  loadProjectOrThrow,
  type ProjectAuthContext,
  type ProjectRow,
} from '../projects/service.ts';
import { TaskError } from './errors.ts';
import { retireTasksInTx } from './retire.ts';
import { agentReviewerEligibility, reviewerEligibility } from './reviews.ts';
import {
  applyTaskCountTransition,
  type AssigneeRef,
  assertAssigneeValid,
  assertTaskNotArchived,
  assertTaskWorkable,
  computeEndRank,
  loadTaskOrThrow,
  mayWorkTask,
  nextTaskNumber,
  parseTaskAttachments,
  recordActivity,
  TASK_COLUMNS,
  taskAudit,
  taskCountBucket,
  TERMINAL_STATUSES,
  type TaskAssigneeType,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from './service.ts';

/**
 * Repeating tasks — the series continues on its own cards. A task carries a
 * repeat rule (`lib/shared/task-repeat.ts`), and ONE next copy continues it:
 * in To do, dated to the rule's next occurrence, carrying the same rule. The
 * task records that it continued (`repeat_continued_at_ms`, stamped in the
 * write that names its copy in `repeat_next_task_id`) so nothing ever
 * creates a second one — a reopen and re-close, a retried job, a close
 * racing the scan: every lane decides on the task's row under its lock,
 * through the one writer below. There is no template row; the rule on the
 * newest copy is the series, and "does not repeat" on it ends it.
 *
 * Deleting a copy clears the pointer that names it but never the stamp, so
 * the task before it stays continued: deleting the newest task of a series
 * ends the series, and deleting a copy in the middle never forks it into
 * two. The edit door refuses a new rule on a continued task for the same
 * reason (`repeatContinued` on its row), and the board reads that flag to
 * stop offering one.
 * Durable series identity and ordered positions outlive those pointers,
 * so deletion cannot hide open work from the cap or later copies from Stop.
 *
 * Two lanes continue a series, as the rule's `createOn` says:
 *
 * - a close (Done or Cancelled, through any status door) always does, as
 *   the status settle's last step. A series nobody works never piles up.
 * - with `createOn: 'dueDate'`, the due-date scan (`repeat-on-due.ts`, every
 *   five minutes) also continues a task that is still open when its due day
 *   begins in the rule's zone. The task stays open and records its copy, so
 *   closing it later creates nothing. The timeline credits the system. The
 *   scan never lets more than {@link REPEAT_OPEN_COPIES_MAX} open copies of
 *   one series pile up.
 *
 * Only an open top-level task a person or an agent works repeats. A subtask
 * is a step of its parent's work, not a series of its own, and a task an
 * automation owns follows that automation's lifecycle — the doors refuse a
 * rule on either, handing a task to an automation ends its series, and
 * neither lane ever continues one.
 *
 * The copy is the WORK again, not its history: title, description,
 * priority, labels, attachments, the people — the assignee and the reviewer
 * while each still holds — and the watchers who can still see the project.
 * Its subtasks come back with it: each fresh in To do, dated by the same
 * step as its parent, with the dependencies between them, and never with a
 * rule of its own. Outputs, comments, dependencies on other work, the
 * external reference and every run, SLA and lifecycle stamp start fresh.
 * The series author stays its author (`created_by`), while the timeline
 * credits the person, agent or system whose act created the copy.
 *
 * "Stop repeating" ({@link stopTaskRepeat}) ends a series from the task a
 * copy continued: it takes back a copy nobody has touched yet, or else
 * leaves it and clears its rule.
 */

/** The next copy a close created — what the status doors answer, so the
 * board can say where the series went. */
export interface TaskRepeatCopy {
  id: string;
  number: number;
  dueDate: number | null;
}

/** The most open copies of one series the due-date lane lets pile up — the
 * task it would continue counted. A close always continues its series: it
 * takes one open task away as it adds one. */
export const REPEAT_OPEN_COPIES_MAX = 10;

const DAY_MS = 86_400_000;

/** A submitted rule, validated and normalized as it will be stored. The
 * app door's schema refuses a malformed rule first (naming the field); this
 * is the domain's own check for every other caller. */
export function validateTaskRepeat(rule: TaskRepeat): TaskRepeat {
  const parsed = taskRepeatSchema.safeParse(rule);
  if (!parsed.success) {
    throw new TaskError('TASK_REPEAT_INVALID', 'The repeat rule is not valid');
  }
  return normalizeTaskRepeat(parsed.data);
}

/** The fields that decide who owns a task. */
type TaskOwnerFields = Pick<
  TaskRow,
  'assigneeType' | 'assigneeId' | 'createdByType'
>;

/**
 * Whether an automation owns the task — the backend's reading of the app's
 * ownership rule (`resolveTaskOwnership`): the task is assigned to an
 * automation, or it is unassigned and an automation filed it. The app also
 * needs the automation's deployed contract to resolve; the backend holds
 * the stricter line, so no rule rides on a task that might be one.
 */
export function automationOwnsTask(task: TaskOwnerFields): boolean {
  if (task.assigneeType === 'app') return true;
  const unassigned = task.assigneeType === null || task.assigneeId === null;
  return unassigned && task.createdByType === 'app';
}

/**
 * Refuse a rule the task cannot carry: only an open top-level task that no
 * automation owns repeats. The create and edit doors ask this before they
 * store a rule; clearing one ("does not repeat") never asks.
 */
export function assertTaskCanRepeat(
  task: TaskOwnerFields & Pick<TaskRow, 'parentTaskId' | 'status'>,
): void {
  if (task.parentTaskId !== null) {
    throw new TaskError('TASK_REPEAT_INVALID', 'Subtasks do not repeat');
  }
  if (automationOwnsTask(task)) {
    throw new TaskError(
      'TASK_REPEAT_INVALID',
      'Tasks an automation owns do not repeat',
    );
  }
  if (TERMINAL_STATUSES.has(task.status)) {
    throw new TaskError('TASK_REPEAT_INVALID', 'Only an open task can repeat');
  }
}

/**
 * End the series of a task an automation now owns, after an assignment
 * wrote `next` onto it: the rule is cleared in the same transaction and the
 * timeline says so, as if someone had chosen "does not repeat". A task that
 * carries no rule, or that no automation owns afterwards, is left alone.
 */
export async function endRepeatForAutomationOwner(
  tx: TransactionSql,
  args: {
    /** The task as it stood BEFORE the assignment. */
    task: Pick<
      TaskRow,
      'id' | 'organizationId' | 'projectId' | 'repeat' | 'createdByType'
    >;
    next: Pick<TaskRow, 'assigneeType' | 'assigneeId'>;
    actorType: 'user' | 'agent';
    actorId: string;
  },
): Promise<void> {
  const { task } = args;
  if (task.repeat === null) return;
  if (
    !automationOwnsTask({ ...args.next, createdByType: task.createdByType })
  ) {
    return;
  }
  await endSeries(tx, task, {
    actorType: args.actorType,
    actorId: args.actorId,
  });
}

/** End a task's series where no one chose to: its rule cleared, and the
 * timeline's "does not repeat" line credited to `actor`. */
async function endSeries(
  tx: TransactionSql,
  task: Pick<TaskRow, 'id' | 'organizationId' | 'projectId' | 'repeat'>,
  actor: { actorType: 'user' | 'agent'; actorId: string },
): Promise<void> {
  await tx`UPDATE app.tasks SET repeat_rule = NULL WHERE id = ${task.id}`;
  // A stored rule that no longer validates read as none already, so there
  // is no series on the timeline to end.
  const rule = parseTaskRepeat(task.repeat);
  if (rule === null) return;
  await recordActivity(tx, {
    task,
    ...actor,
    action: 'repeat.changed',
    fromValue: JSON.stringify(rule),
  });
}

/** What decides whether a task could carry its series on. */
type RepeatableState = TaskOwnerFields &
  Pick<TaskRow, 'repeat' | 'archivedAt' | 'parentTaskId'>;

/** What decides whether a task continues its series: that, and whether it
 * already did. */
type SeriesState = RepeatableState & {
  /** When the task continued its series (`repeat_continued_at_ms`), or null
   * while it has not. A deleted copy never clears it. */
  repeatContinuedAt: number | null;
};

/** The rule a task would continue on, or null when it could continue none:
 * it is archived, it is a subtask, an automation owns it, or it carries no
 * rule (or one that no longer validates). */
function repeatableRule(state: RepeatableState): TaskRepeat | null {
  if (
    state.archivedAt !== null ||
    state.parentTaskId !== null ||
    automationOwnsTask(state)
  ) {
    return null;
  }
  return parseTaskRepeat(state.repeat);
}

/** The rule a task continues on, or null when it continues none: it already
 * continued its series — even if that copy was deleted since — or it could
 * continue none (see {@link repeatableRule}). */
function seriesRule(state: SeriesState): TaskRepeat | null {
  if (state.repeatContinuedAt !== null) return null;
  return repeatableRule(state);
}

/**
 * When the due-date lane continues a task: the start of its due day in the
 * rule's zone. Null when the rule creates its copy on a close only, or the
 * task has no due date to wait for.
 */
export function repeatCopyDueAt(
  rule: TaskRepeat,
  dueDate: number | null,
): number | null {
  if (taskRepeatCreateOn(rule) !== 'dueDate' || !isEpochMs(dueDate)) {
    return null;
  }
  return startOfCalendarDate(taskDateIn(dueDate, rule.timezone), rule.timezone);
}

/** Who continues a series, and on what grounds. */
type RepeatLane =
  | {
      /** A status door just closed the task (Done or Cancelled). */
      kind: 'close';
      actorType: 'user' | 'agent';
      actorId: string;
      /** The human doors' auth context — the copy's audit row. */
      audit?: ProjectAuthContext;
    }
  | {
      /** The due-date scan: the task is still open and its due day began. */
      kind: 'dueDate';
      /** The scan's clock — the moment the task was judged due. */
      now: number;
    };

/** The system as the timeline credits it: an agent-typed actor with the
 * `system` id, which the app names "System". */
const SYSTEM_ACTOR = { actorType: 'agent', actorId: 'system' } as const;

function laneActor(lane: RepeatLane): {
  actorType: 'user' | 'agent';
  actorId: string;
} {
  return lane.kind === 'close'
    ? { actorType: lane.actorType, actorId: lane.actorId }
    : SYSTEM_ACTOR;
}

/**
 * Whether a copy announces itself as `task.created`. A person's close does,
 * and so does the due-date scan: it runs on the clock, not on anyone's
 * write, so no automation reacting to the event can feed it. An agent's or
 * an automation's close does not — as the settle's own
 * `task.status_changed` is the human lane's: dispatch cannot yet tell an
 * automation's writes from a person's, so an automation that cancels new
 * tasks would cancel each copy its own cancel created, without end.
 */
function laneAnnounces(lane: RepeatLane): boolean {
  return lane.kind === 'dueDate' || lane.actorType === 'user';
}

/** What one pass of the writer did. */
export type RepeatWrite =
  | { kind: 'created'; copy: TaskRepeatCopy }
  /** The series is not continued here: no rule, a copy already exists, the
   * task no longer qualifies, or the lane's own condition does not hold. */
  | { kind: 'skipped' }
  /** The due-date lane found this many open copies of the series already. */
  | { kind: 'capped'; openCopies: number };

const SKIPPED: RepeatWrite = { kind: 'skipped' };

/**
 * Create the next copy of a repeating task its status change just closed —
 * the last step of the status settle, so every door that closes a card
 * repeats it alike. `task` is the row as it stood BEFORE the write.
 *
 * Answers null when the move does not continue a series: it is not an open
 * → closed move, or the task continues none (see {@link seriesRule}). The
 * row this transaction read only rules a series out — its stamp says the
 * task continued, whether or not that copy still exists — and the decision
 * to write a copy is taken again on the row under its lock.
 *
 * Closing a task never fails because of its repeat: the copy is written in
 * a savepoint, and a fault rolls back the copy alone — logged, the close
 * commits, the task keeps its rule, and reopening and closing it again
 * tries once more. A serialization failure is the exception: it means the
 * whole transaction reruns, close and copy together.
 */
export async function createNextRepeatCopy(
  tx: TransactionSql,
  args: {
    task: TaskRow;
    toStatus: TaskStatus;
    actorType: 'user' | 'agent';
    actorId: string;
    /** The human doors' auth context — the copy's audit row. */
    audit?: ProjectAuthContext;
  },
): Promise<TaskRepeatCopy | null> {
  const { task, toStatus } = args;
  if (
    TERMINAL_STATUSES.has(task.status) ||
    !TERMINAL_STATUSES.has(toStatus) ||
    task.repeatContinued ||
    repeatableRule(task) === null
  ) {
    return null;
  }
  const lane: RepeatLane = {
    kind: 'close',
    actorType: args.actorType,
    actorId: args.actorId,
    ...(args.audit !== undefined ? { audit: args.audit } : {}),
  };
  try {
    const written = await tx.savepoint((sp) => writeNextCopy(sp, task, lane));
    return written.kind === 'created' ? written.copy : null;
  } catch (error) {
    if (isSerializationFailure(error)) throw error;
    console.error(
      `[tasks] task ${task.id}: closed without its next repeating copy`,
      error,
    );
    return null;
  }
}

/**
 * Continue a still-open task whose due day has begun — the due-date scan's
 * write, one task per transaction. The scan's row only put the task on its
 * list; the writer decides again on the row under its lock, so a close, an
 * edit or a second scan that got there first leaves nothing to do. A fault
 * throws, rolling back this task's transaction alone.
 */
export async function createDueRepeatCopy(
  tx: TransactionSql,
  args: { organizationId: string; taskId: string; now: number },
): Promise<RepeatWrite> {
  const rows = await tx<TaskRow[]>`
    SELECT ${tx.unsafe(TASK_COLUMNS)} FROM app.tasks
    WHERE id = ${args.taskId} AND org_id = ${args.organizationId}
  `;
  const task = rows[0];
  if (task === undefined) return SKIPPED;
  return await writeNextCopy(tx, task, { kind: 'dueDate', now: args.now });
}

/** A task's series state and dates as its row lock reads them. */
type LockedSeries = SeriesState &
  Pick<TaskRow, 'status' | 'startDate' | 'dueDate'> & {
    seriesId: string | null;
    seriesPosition: number | null;
  };

/** The fields a copy is made of — the task itself, or one of its subtasks. */
interface CopySource {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  description: string | null;
  attachments: unknown;
  priority: TaskPriority | null;
  labelIds: string[];
  assigneeType: TaskAssigneeType | null;
  assigneeId: string | null;
  reviewerUserId: string | null;
  reviewerAgentId: string | null;
  createdBy: string;
  createdByType: string;
}

/** A subtask the copy brings back, as its subtree read loads it. */
interface SubtaskSource extends CopySource {
  parentTaskId: string;
  startDate: number | null;
  dueDate: number | null;
}

/**
 * THE writer every lane continues a series through: the lock, the decision,
 * the copy with its subtasks, dependencies and watchers, and the pointer —
 * one transaction, so a copy never exists without the pointer naming it.
 */
async function writeNextCopy(
  tx: TransactionSql,
  task: TaskRow,
  lane: RepeatLane,
): Promise<RepeatWrite> {
  // The row's own record, under its lock: a lane that reads at READ
  // COMMITTED may have loaded the task before an edit that removed the
  // rule, archived it, moved its due date or handed it to an automation
  // committed — what the row says now decides, and a task stamped as
  // continued has continued its series, whether its copy still exists or
  // not.
  const lockedRows = await tx<LockedSeries[]>`
    SELECT repeat_rule AS "repeat",
           repeat_continued_at_ms::float8 AS "repeatContinuedAt",
           repeat_series_id AS "seriesId",
           repeat_series_position AS "seriesPosition",
           archived_at_ms::float8 AS "archivedAt",
           parent_task_id AS "parentTaskId", assignee_type AS "assigneeType",
           assignee_id AS "assigneeId", created_by_type AS "createdByType",
           status, start_date_ms::float8 AS "startDate",
           due_date_ms::float8 AS "dueDate"
    FROM app.tasks
    WHERE id = ${task.id} FOR UPDATE
  `;
  const locked = lockedRows[0];
  if (locked === undefined) return SKIPPED;
  const rule = seriesRule(locked);
  if (rule === null) return SKIPPED;
  const series = {
    id: locked.seriesId ?? task.id,
    position: locked.seriesPosition ?? 0,
  };
  if (lane.kind === 'dueDate') {
    // Still open, still continuing on its due date, and that day has begun
    // — a task closed, re-dated or switched back to "when done" since the
    // scan listed it is not the scan's any more.
    const dueAt = repeatCopyDueAt(rule, locked.dueDate);
    if (
      TERMINAL_STATUSES.has(locked.status) ||
      dueAt === null ||
      dueAt > lane.now
    ) {
      return SKIPPED;
    }
  }
  const project = await loadProjectOrThrow(tx, task.projectId);
  // An archived project is read-only for its tasks; the rule stays, and a
  // close (or the scan) after the project is restored continues the series.
  if (project.archivedAt !== null) return SKIPPED;
  if (lane.kind === 'dueDate') {
    const openCopies = await openCopiesInSeries(tx, task, series.id);
    if (openCopies >= REPEAT_OPEN_COPIES_MAX) {
      return { kind: 'capped', openCopies };
    }
  }

  // One instant for every row this write creates: the stamp that later
  // tells "Stop repeating" a copy and its subtasks are still exactly as
  // this write left them.
  const now = Date.now();
  const before = {
    startDate: isEpochMs(locked.startDate) ? locked.startDate : null,
    dueDate: isEpochMs(locked.dueDate) ? locked.dueDate : null,
  };
  const dates = nextTaskRepeatDates(rule, before, now);
  // Who can still be carried over is asked once per person or agent.
  const standing = new Map<string, boolean>();
  const carried = await carriedAssignee(
    tx,
    project,
    {
      ...task,
      assigneeType: locked.assigneeType,
      assigneeId: locked.assigneeId,
    },
    standing,
  );
  const assignee = carried.assignee;
  // A task an automation filed repeats only while a person holds it. When
  // that person can no longer be carried over, the copy would be the
  // automation's again — and an automation's task does not repeat, so the
  // series ends here, as handing the task to the automation would have
  // ended it: the rule is cleared, and neither lane meets it again.
  if (
    automationOwnsTask({
      assigneeType: assignee?.assigneeType ?? null,
      assigneeId: assignee?.assigneeId ?? null,
      createdByType: task.createdByType,
    })
  ) {
    await endSeries(tx, { ...task, repeat: locked.repeat }, laneActor(lane));
    console.warn(
      `[tasks] task ${task.id}: its series ends — its assignee cannot be carried over (${carried.refusal ?? 'unassigned'}) and an automation filed it`,
    );
    return SKIPPED;
  }
  if (carried.refusal !== null) warnUnassigned(task.id, carried.refusal);
  const reviewerUserId = await carriedReviewer(tx, project, task);
  const copy = await insertTaskCopy(tx, {
    source: task,
    parentTaskId: null,
    repeat: rule,
    assignee,
    reviewerUserId,
    startDate: dates.startDate,
    dueDate: dates.dueDate,
    now,
    series: { id: series.id, position: series.position + 1 },
  });
  await recordCopyCreated(tx, lane, task, copy, null, assignee);

  // The work comes back whole: its subtasks under the copy, the
  // dependencies among them, and the people who watched it.
  const copies = new Map<string, string>([[task.id, copy.id]]);
  const shift = calendarShift(rule.timezone, before, dates, now);
  await copySubtree(tx, {
    lane,
    task,
    project,
    copies,
    shift,
    timeZone: rule.timezone,
    now,
    standing,
  });
  await copyDependencies(tx, task, copies, now);
  // The series author is among them while they watch: the create door
  // subscribed them to the first task, and their unsubscribe carries over
  // like anyone's.
  await carryWatchers(tx, project, task.organizationId, copies, standing);

  await tx`
    UPDATE app.tasks
    SET repeat_next_task_id = ${copy.id}, repeat_continued_at_ms = ${now},
        repeat_series_id = ${series.id}, repeat_series_position = ${series.position}
    WHERE id = ${task.id}
  `;
  await recordActivity(tx, {
    task,
    ...laneActor(lane),
    action: 'repeat.next',
    toValue:
      formatTaskIdentifier(project.key, copy.number) ?? String(copy.number),
  });
  return {
    kind: 'created',
    copy: { id: copy.id, number: copy.number, dueDate: dates.dueDate },
  };
}

/** Insert one copy in To do, at the end of the column, under the next task
 * number, and count it as a new open card. */
async function insertTaskCopy(
  tx: TransactionSql,
  args: {
    source: CopySource;
    parentTaskId: string | null;
    repeat: TaskRepeat | null;
    assignee: AssigneeRef | null;
    reviewerUserId: string | null;
    startDate: number | null;
    dueDate: number | null;
    now: number;
    series?: { id: string; position: number };
  },
): Promise<{ id: string; number: number }> {
  const { source, now } = args;
  // Unlike a lost human designation, an agent choice must not disappear into
  // a different project default. Retain it for explicit repair; the reviewer
  // field and the next native review read its current eligibility again.
  if (source.reviewerAgentId != null) {
    const eligibility = await agentReviewerEligibility(tx, {
      organizationId: source.organizationId,
      projectId: source.projectId,
      agentId: source.reviewerAgentId,
    });
    if (eligibility !== 'eligible') {
      console.warn(
        `[tasks] task ${source.id}: next repeating copy retains an agent reviewer requiring repair (${eligibility})`,
      );
    }
  }
  const attachments = parseTaskAttachments(source.attachments);
  const rank = await computeEndRank(tx, source.projectId, 'todo');
  const number = await nextTaskNumber(tx, source.projectId);
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.tasks (
      org_id, project_id, title, description, attachments, status, priority,
      label_ids, assignee_type, assignee_id, reviewer_user_id, parent_task_id,
      start_date_ms, due_date_ms, repeat_rule, rank, number, created_by,
      created_by_type, created_at_ms, updated_at_ms, status_changed_at_ms,
      repeat_series_id, repeat_series_position, reviewer_agent_id
    ) VALUES (
      ${source.organizationId}, ${source.projectId}, ${source.title},
      ${source.description},
      ${attachments.length > 0 ? tx.json(toJson(attachments)) : null},
      'todo', ${source.priority}, ${source.labelIds},
      ${args.assignee?.assigneeType ?? null},
      ${args.assignee?.assigneeId ?? null}, ${args.reviewerUserId},
      ${args.parentTaskId}, ${args.startDate}, ${args.dueDate},
      ${args.repeat !== null ? tx.json(toJson(args.repeat)) : null}, ${rank},
      ${number}, ${source.createdBy}, ${source.createdByType}, ${now}, ${now},
      ${now}, ${args.series?.id ?? null}, ${args.series?.position ?? null},
      ${source.reviewerAgentId ?? null}
    )
    RETURNING id
  `;
  const id = inserted[0]?.id;
  if (!id) {
    throw new Error('TASK_CREATE_FAILED: the insert answered no row');
  }
  await applyTaskCountTransition(tx, source.projectId, 'none', 'open');
  return { id, number };
}

/**
 * A new copy's creation, as every new task has it: the timeline's
 * "created" line (credited to the lane's actor), the audit chain's row and,
 * on the lanes that announce, the `task.created` event.
 */
async function recordCopyCreated(
  tx: TransactionSql,
  lane: RepeatLane,
  source: CopySource,
  copy: { id: string },
  parentTaskId: string | null,
  assignee: AssigneeRef | null,
): Promise<void> {
  await recordActivity(tx, {
    task: {
      id: copy.id,
      organizationId: source.organizationId,
      projectId: source.projectId,
    },
    ...laneActor(lane),
    action: 'created',
    toValue: 'todo',
  });
  // A person's close is audited as theirs; an agent's or an automation's
  // close is the api actor's, as the agent's own task creation is; the
  // scan's is the system's.
  if (lane.kind === 'close' && lane.audit !== undefined) {
    await createAuditLog(
      tx,
      taskAudit(
        lane.audit,
        { id: copy.id, title: source.title },
        TASK_AUDIT_ACTIONS.created,
        {
          newState: { status: 'todo', priority: source.priority },
          metadata: {
            projectId: source.projectId,
            parentTaskId,
            assigneeType: assignee?.assigneeType ?? null,
            repeatOf: source.id,
          },
        },
      ),
    );
  } else {
    const system = lane.kind === 'dueDate';
    await createAuditLog(tx, {
      organizationId: source.organizationId,
      actorId: system ? SYSTEM_ACTOR.actorId : lane.actorId,
      actorType: system ? 'system' : 'api',
      action: TASK_AUDIT_ACTIONS.created,
      category: 'data',
      resourceType: TASK_RESOURCE_TYPE,
      resourceId: copy.id,
      resourceName: source.title,
      metadata: system
        ? {
            projectId: source.projectId,
            parentTaskId,
            repeatOf: source.id,
            createOn: 'dueDate',
          }
        : {
            viaAgent: true,
            projectId: source.projectId,
            parentTaskId,
            repeatOf: source.id,
          },
      status: 'success',
    });
  }
  if (laneAnnounces(lane)) {
    const actor =
      lane.kind === 'close'
        ? { actorType: 'user', actorId: lane.actorId }
        : { actorType: 'system', actorId: SYSTEM_ACTOR.actorId };
    await emitEvent(tx, {
      organizationId: source.organizationId,
      eventType: 'task.created',
      eventData: { taskId: copy.id, projectId: source.projectId, ...actor },
    });
  }
}

/**
 * Bring the task's subtasks back under its copy — every one not archived
 * (an archived subtask leaves its own subtree behind too), each fresh in To
 * do under its parent's copy, with no rule, dated by the same calendar step
 * as the parent. The read deduplicates ids so malformed cycles are finite;
 * the queue copies parents before children. `copies` maps each original
 * to its copy and grows as they land. The complete tree lands in the
 * writer's transaction, never a silently truncated subset.
 */
async function copySubtree(
  tx: TransactionSql,
  args: {
    lane: RepeatLane;
    task: TaskRow;
    project: ProjectRow;
    copies: Map<string, string>;
    /** Calendar days the parent's dates moved by. */
    shift: number;
    timeZone: string;
    now: number;
    standing: Map<string, boolean>;
  },
): Promise<void> {
  const { task, copies } = args;
  const rows = await tx<SubtaskSource[]>`
    WITH RECURSIVE tree AS (
      SELECT id FROM app.tasks WHERE id = ${task.id}
      UNION
      SELECT t.id
      FROM app.tasks t JOIN tree ON t.parent_task_id = tree.id
      WHERE t.archived_at_ms IS NULL AND t.org_id = ${task.organizationId}
        AND t.project_id = ${task.projectId}
    )
    SELECT t.id, t.org_id AS "organizationId", t.project_id AS "projectId",
           t.parent_task_id AS "parentTaskId", t.title, t.description,
           t.attachments, t.priority, t.label_ids AS "labelIds",
           t.assignee_type AS "assigneeType", t.assignee_id AS "assigneeId",
           t.reviewer_user_id AS "reviewerUserId",
           t.reviewer_agent_id AS "reviewerAgentId",
           t.start_date_ms::float8 AS "startDate",
           t.due_date_ms::float8 AS "dueDate", t.created_by AS "createdBy",
           t.created_by_type AS "createdByType"
    FROM tree JOIN app.tasks t ON t.id = tree.id
    WHERE t.id <> ${task.id} AND t.org_id = ${task.organizationId}
      AND t.project_id = ${task.projectId}
    ORDER BY t.number NULLS LAST, t.id
  `;
  const children = new Map<string, SubtaskSource[]>();
  for (const row of rows) {
    const siblings = children.get(row.parentTaskId) ?? [];
    siblings.push(row);
    children.set(row.parentTaskId, siblings);
  }
  const queue = [...(children.get(task.id) ?? [])];
  for (const node of queue) {
    if (copies.has(node.id)) continue;
    const parentTaskId = copies.get(node.parentTaskId);
    if (parentTaskId === undefined) continue;
    const { assignee, refusal } = await carriedAssignee(
      tx,
      args.project,
      node,
      args.standing,
    );
    if (refusal !== null) warnUnassigned(node.id, refusal);
    const reviewerUserId = await carriedReviewer(tx, args.project, node);
    const copy = await insertTaskCopy(tx, {
      source: node,
      parentTaskId,
      repeat: null,
      assignee,
      reviewerUserId,
      startDate: shiftTaskDate(node.startDate, args.shift, args.timeZone),
      dueDate: shiftTaskDate(node.dueDate, args.shift, args.timeZone),
      now: args.now,
    });
    copies.set(node.id, copy.id);
    queue.push(...(children.get(node.id) ?? []));
    await recordCopyCreated(tx, args.lane, node, copy, parentTaskId, assignee);
  }
}

/** The dependencies among the copied tasks — both ends inside the task and
 * its copied subtasks — drawn again between their copies. A dependency on
 * other work stays with the original. */
async function copyDependencies(
  tx: TransactionSql,
  task: TaskRow,
  copies: ReadonlyMap<string, string>,
  now: number,
): Promise<void> {
  if (copies.size < 2) return;
  const ids = [...copies.keys()];
  const edges = await tx<
    {
      blockerTaskId: string;
      blockedTaskId: string;
      createdBy: string;
      createdByType: string;
    }[]
  >`
    SELECT blocker_task_id AS "blockerTaskId",
           blocked_task_id AS "blockedTaskId", created_by AS "createdBy",
           created_by_type AS "createdByType"
    FROM app.task_dependencies
    WHERE blocker_task_id = ANY(${ids}) AND blocked_task_id = ANY(${ids})
  `;
  for (const edge of edges) {
    const blocker = copies.get(edge.blockerTaskId);
    const blocked = copies.get(edge.blockedTaskId);
    if (blocker === undefined || blocked === undefined) continue;
    await tx`
      INSERT INTO app.task_dependencies (
        org_id, project_id, blocker_task_id, blocked_task_id, created_by,
        created_by_type, created_at_ms
      ) VALUES (
        ${task.organizationId}, ${task.projectId}, ${blocker}, ${blocked},
        ${edge.createdBy}, ${edge.createdByType}, ${now}
      )
      ON CONFLICT (blocker_task_id, blocked_task_id) DO NOTHING
    `;
  }
}

/** Everyone who watched a copied task watches its copy — mute included —
 * while they can still see the project: a person with access to it, an
 * agent still in it. */
async function carryWatchers(
  tx: TransactionSql,
  project: ProjectRow,
  organizationId: string,
  copies: ReadonlyMap<string, string>,
  standing: Map<string, boolean>,
): Promise<void> {
  const watchers = await tx<
    {
      taskId: string;
      subscriberType: string;
      subscriberId: string;
      muted: boolean | null;
    }[]
  >`
    SELECT task_id AS "taskId", subscriber_type AS "subscriberType",
           subscriber_id AS "subscriberId", muted
    FROM app.task_subscriptions
    WHERE task_id = ANY(${[...copies.keys()]})
    ORDER BY created_at_ms, id
  `;
  for (const watcher of watchers) {
    const taskId = copies.get(watcher.taskId);
    const subscriberType = watcher.subscriberType;
    if (
      taskId === undefined ||
      (subscriberType !== 'user' && subscriberType !== 'agent')
    ) {
      continue;
    }
    const holds = await stillHolds(tx, project, organizationId, standing, {
      assigneeType: subscriberType,
      assigneeId: watcher.subscriberId,
    });
    if (!holds) continue;
    await autoSubscribe(tx, {
      organizationId,
      taskId,
      subscriberType,
      subscriberId: watcher.subscriberId,
      reason: 'repeat',
      ...(watcher.muted !== null ? { muted: watcher.muted } : {}),
    });
  }
}

/** Count durable membership, not next-task links: a root or middle task
 * can be deleted without making the older open work disappear. A first
 * task not yet stamped with its identity counts by its own id. */
async function openCopiesInSeries(
  tx: TransactionSql,
  task: Pick<TaskRow, 'id' | 'organizationId' | 'projectId'>,
  seriesId: string,
): Promise<number> {
  const rows = await tx<{ open: number }[]>`
    SELECT count(*)::int AS open FROM app.tasks
    WHERE org_id = ${task.organizationId} AND project_id = ${task.projectId}
      AND (id = ${task.id} OR repeat_series_id = ${seriesId})
      AND status NOT IN ('done', 'cancelled') AND archived_at_ms IS NULL
  `;
  return rows[0]?.open ?? 0;
}

// ---------------------------------------------------------------------------
// Dates — a copied subtask moves by its parent's step
// ---------------------------------------------------------------------------

function dayNumber(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / DAY_MS;
}

/**
 * The calendar days the parent's dates moved by, in the rule's zone: due
 * date to due date, else start to start, else — a parent with no dates is
 * dated from today — today to the copy's due date.
 */
function calendarShift(
  timeZone: string,
  before: { startDate: number | null; dueDate: number | null },
  after: { startDate: number | null; dueDate: number | null },
  now: number,
): number {
  const days = (from: CalendarDate, to: number): number =>
    Math.round(dayNumber(taskDateIn(to, timeZone)) - dayNumber(from));
  if (before.dueDate !== null && after.dueDate !== null) {
    return days(taskDateIn(before.dueDate, timeZone), after.dueDate);
  }
  if (before.startDate !== null && after.startDate !== null) {
    return days(taskDateIn(before.startDate, timeZone), after.startDate);
  }
  const anchor = after.dueDate ?? after.startDate;
  return anchor === null ? 0 : days(calendarDateIn(now, timeZone), anchor);
}

/** A task date moved by `days` calendar days, landing on midnight in the
 * rule's zone as the parent copy's dates do. */
function shiftTaskDate(
  ms: number | null,
  days: number,
  timeZone: string,
): number | null {
  if (!isEpochMs(ms)) return null;
  const moved = new Date((dayNumber(taskDateIn(ms, timeZone)) + days) * DAY_MS);
  return startOfCalendarDate(
    {
      year: moved.getUTCFullYear(),
      month: moved.getUTCMonth() + 1,
      day: moved.getUTCDate(),
    },
    timeZone,
  );
}

// ---------------------------------------------------------------------------
// Stop repeating
// ---------------------------------------------------------------------------

/** A copy "Stop repeating" may take back, as its lock reads it. */
interface ChainTask {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  repeat: unknown;
  repeatNextTaskId: string | null;
  seriesPosition: number;
  createdAt: number;
  updatedAt: number;
  commentCount: number;
  agentRunCount: number;
  archivedAt: number | null;
  createdBy: string;
  createdByType: string;
  assigneeType: string | null;
  assigneeId: string | null;
  parentTaskId: string | null;
}

/** One task of a copy's subtree (the copy itself included). */
interface ChainTreeRow {
  id: string;
  root: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  commentCount: number;
  agentRunCount: number;
  archivedAt: number | null;
}

/**
 * "Stop repeating", from the task a copy continued — the toast's action
 * after a close created the next task. The series ends: nothing continues
 * from this task again, reopened and closed or not.
 *
 * When the copy — and every copy the series has made since, each with its
 * subtasks — is still exactly as the platform wrote it (To do, never
 * edited, no comment, no run), it is taken back: retired the way a delete
 * retires a task, and the answer says so. Otherwise it stays, and only its
 * rule is cleared, so it continues nothing either. Either way the task's
 * own rule is cleared.
 *
 * Taking the copy back undoes the platform's own automatic write, not
 * anyone's work — it is untouched by definition — so whoever may work the
 * task may do it (an editor, or the task's own creator or assignee), where
 * deleting a task takes an owner or an admin.
 *
 * It reaches only what the caller may work: the task they named and the
 * copies after it that are theirs to work too. The copies before it are the
 * series' history and keep what they say, and a later copy someone else
 * owns now is left as it is — its rule included — and keeps the copies
 * from being taken back.
 */
export async function stopTaskRepeat(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  taskId: string,
): Promise<{ removedNextTask: boolean }> {
  const task = await loadTaskOrThrow(tx, taskId, auth.organizationId);
  const project = await loadProjectOrThrow(tx, task.projectId);
  await assertTaskWorkable(tx, project, task, auth);
  assertTaskNotArchived(task);
  const lockedRows = await tx<
    {
      repeat: unknown;
      seriesId: string | null;
      seriesPosition: number | null;
    }[]
  >`
    SELECT repeat_rule AS "repeat", repeat_series_id AS "seriesId",
           repeat_series_position AS "seriesPosition" FROM app.tasks
    WHERE id = ${task.id} FOR UPDATE
  `;
  const locked = lockedRows[0];
  const members =
    locked?.seriesId == null
      ? []
      : await loadSeriesMembers(tx, task, locked.seriesId);
  const chain = members.filter(
    (member) => member.seriesPosition > (locked?.seriesPosition ?? 0),
  );
  // The later copies the caller may work; the others stay as they are.
  const workable: ChainTask[] = [];
  for (const copy of chain) {
    if (await mayWorkTask(tx, project, copy, auth)) workable.push(copy);
  }
  let removedNextTask = false;
  if (chain.length > 0 && workable.length === chain.length) {
    const tree = await loadChainTrees(tx, task, chain);
    if (await chainUntouched(tx, task, chain, tree)) {
      await takeBackCopies(tx, auth, task, chain, tree);
      removedNextTask = true;
    }
  }
  if (!removedNextTask) {
    for (const copy of workable) {
      await clearSeriesRule(tx, auth, copy);
    }
  }
  await clearSeriesRule(tx, auth, {
    ...task,
    repeat: lockedRows[0]?.repeat ?? null,
  });
  return { removedNextTask };
}

/** Every surviving member, including those disconnected by deletion. The
 * source row is already locked; lock the rest in id order, then return
 * immutable series order so only later copies can be taken back. */
async function loadSeriesMembers(
  tx: TransactionSql,
  task: TaskRow,
  seriesId: string,
): Promise<ChainTask[]> {
  const rows = await tx<ChainTask[]>`
    SELECT id, org_id AS "organizationId", project_id AS "projectId", title,
           status, repeat_rule AS "repeat",
           repeat_next_task_id AS "repeatNextTaskId",
           repeat_series_position AS "seriesPosition",
           created_at_ms::float8 AS "createdAt",
           updated_at_ms::float8 AS "updatedAt",
           comment_count AS "commentCount",
           agent_run_count AS "agentRunCount",
           archived_at_ms::float8 AS "archivedAt",
           created_by AS "createdBy", created_by_type AS "createdByType",
           assignee_type AS "assigneeType", assignee_id AS "assigneeId",
           parent_task_id AS "parentTaskId"
    FROM app.tasks
    WHERE org_id = ${task.organizationId} AND project_id = ${task.projectId}
      AND repeat_series_id = ${seriesId} AND id <> ${task.id}
    ORDER BY id
    FOR UPDATE
  `;
  return rows.toSorted((a, b) => a.seriesPosition - b.seriesPosition);
}

/** Every task under each copy of the chain, the copies themselves included,
 * each row naming the copy it hangs under. */
async function loadChainTrees(
  tx: TransactionSql,
  task: TaskRow,
  chain: readonly ChainTask[],
): Promise<ChainTreeRow[]> {
  return await tx<ChainTreeRow[]>`
    WITH RECURSIVE tree AS (
      SELECT id, id AS root
      FROM app.tasks WHERE id = ANY(${chain.map((copy) => copy.id)})
      UNION
      SELECT t.id, tree.root
      FROM app.tasks t JOIN tree ON t.parent_task_id = tree.id
      WHERE t.org_id = ${task.organizationId}
        AND t.project_id = ${task.projectId}
    )
    SELECT t.id, tree.root, t.status,
           t.created_at_ms::float8 AS "createdAt",
           t.updated_at_ms::float8 AS "updatedAt",
           t.comment_count AS "commentCount",
           t.agent_run_count AS "agentRunCount",
           t.archived_at_ms::float8 AS "archivedAt"
    FROM tree JOIN app.tasks t ON t.id = tree.id
    WHERE t.org_id = ${task.organizationId}
    ORDER BY t.id
    FOR UPDATE OF t
  `;
}

/**
 * Whether the chain is still exactly as the platform wrote it: every copy
 * and every task under it in To do, never edited since (a copy's rows all
 * carry the one instant its write stamped, so a subtask someone added
 * later does not pass), never commented on, never run, not archived — and
 * the newest member has no unresolved continuation pointer.
 */
async function chainUntouched(
  tx: TransactionSql,
  task: TaskRow,
  chain: readonly ChainTask[],
  tree: readonly ChainTreeRow[],
): Promise<boolean> {
  const last = chain.at(-1);
  if (last === undefined || last.repeatNextTaskId !== null) return false;
  const createdAtByCopy = new Map(
    chain.map((copy) => [copy.id, copy.createdAt]),
  );
  const pristine = tree.every(
    (row) =>
      row.status === 'todo' &&
      row.archivedAt === null &&
      row.updatedAt === row.createdAt &&
      row.createdAt === createdAtByCopy.get(row.root) &&
      row.commentCount === 0 &&
      row.agentRunCount === 0,
  );
  if (!pristine) return false;
  const ids = tree.map((row) => row.id);
  // Dependencies do not move updated_at_ms. A user's change anywhere in
  // the copied tree makes it their work even if every task is still To do;
  // outgoing edges record their activity on the OTHER task, so also keep
  // any copy now connected to work outside this tree. Automatic copies
  // create only internal dependencies and created/repeat.next activity.
  const touched = await tx<{ id: string }[]>`
    SELECT id FROM app.task_activity
    WHERE task_id = ANY(${ids}) AND action NOT IN ('created', 'repeat.next')
    LIMIT 1
  `;
  if (touched.length > 0) return false;
  const externalDependencies = await tx<{ id: string }[]>`
    SELECT id FROM app.task_dependencies
    WHERE (blocker_task_id = ANY(${ids}) OR blocked_task_id = ANY(${ids}))
      AND NOT (blocker_task_id = ANY(${ids}) AND blocked_task_id = ANY(${ids}))
    LIMIT 1
  `;
  if (externalDependencies.length > 0) return false;
  const liveAgentRuns = await tx<{ id: string }[]>`
    SELECT id FROM app.project_agent_runs
    WHERE org_id = ${task.organizationId} AND task_id = ANY(${ids})
      AND status IN ('queued', 'running')
    LIMIT 1
  `;
  if (liveAgentRuns.length > 0) return false;
  const liveAutomationRuns = await tx<{ id: string }[]>`
    SELECT id FROM app.automation_runs
    WHERE org_id = ${task.organizationId}
      AND (project_id = ${task.projectId} OR project_id IS NULL)
      AND status IN ('queued', 'running', 'waiting')
      AND input -> 'task' ->> 'id' = ANY(${ids})
    LIMIT 1
  `;
  return liveAutomationRuns.length === 0;
}

/** Retire the untouched copies with everything under them — the delete's
 * own walk and rollup transitions — each on the audit chain. Deleting a
 * copy clears the pointer that named it (ON DELETE SET NULL). */
async function takeBackCopies(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  task: TaskRow,
  chain: readonly ChainTask[],
  tree: readonly ChainTreeRow[],
): Promise<void> {
  for (const row of tree) {
    await applyTaskCountTransition(
      tx,
      task.projectId,
      taskCountBucket(row),
      'none',
    );
  }
  const retired = await retireTasksInTx(tx, {
    organizationId: task.organizationId,
    projectId: task.projectId,
    taskIds: tree.map((row) => row.id),
    closedReason: 'task_deleted',
  });
  let previous: Pick<ChainTask, 'id' | 'repeatNextTaskId'> = task;
  for (const copy of chain) {
    await createAuditLog(
      tx,
      taskAudit(auth, copy, TASK_AUDIT_ACTIONS.deleted, {
        previousState: { status: copy.status, title: copy.title },
        metadata: {
          reason: 'repeat_stopped',
          ...(previous.repeatNextTaskId === copy.id
            ? { repeatOf: previous.id }
            : { stoppedFromTaskId: task.id }),
          deletedChildCount:
            tree.filter((row) => row.root === copy.id).length - 1,
          releasedBlobRefCount: retired.releasedRefs.length,
        },
      }),
    );
    // Deletes leave no activity row (the task is gone) — hint explicitly.
    await emitHintInTx(tx, {
      orgId: task.organizationId,
      entity: 'task',
      entityId: copy.id,
    });
    previous = copy;
  }
}

/** Clear the rule a task carries — "does not repeat", as the person asking
 * to stop — on the row, the timeline and the audit chain. */
async function clearSeriesRule(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  task: Pick<TaskRow, 'id' | 'organizationId' | 'projectId' | 'title'> & {
    repeat: unknown;
  },
): Promise<void> {
  if (task.repeat === null || task.repeat === undefined) return;
  await tx`
    UPDATE app.tasks SET repeat_rule = NULL, updated_at_ms = ${Date.now()}
    WHERE id = ${task.id}
  `;
  // A stored rule that no longer validates read as none already, so there
  // is no series on the timeline to end.
  const rule = parseTaskRepeat(task.repeat);
  if (rule === null) return;
  await recordActivity(tx, {
    task,
    actorType: 'user',
    actorId: auth.userId,
    action: 'repeat.changed',
    fromValue: JSON.stringify(rule),
  });
  await createAuditLog(
    tx,
    taskAudit(auth, task, TASK_AUDIT_ACTIONS.updated, {
      previousState: { repeat: rule },
      newState: { repeat: null },
      metadata: { reason: 'repeat_stopped' },
    }),
  );
}

// ---------------------------------------------------------------------------
// Who carries over
// ---------------------------------------------------------------------------

/** Why `assignee` could not be given a task in the project today — the
 * assign door's own check, with nobody "self": each one's own standing
 * decides. Null when they could. */
async function assigneeRefusal(
  tx: TransactionSql,
  project: ProjectRow,
  organizationId: string,
  assignee: AssigneeRef,
): Promise<string | null> {
  try {
    await assertAssigneeValid(tx, {
      project,
      auth: { organizationId, userId: '' },
      assignee,
    });
    return null;
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    return error.code;
  }
}

/** Whether a person or an agent could still be given work in the project,
 * asked once per write: `standing` remembers each answer. */
async function stillHolds(
  tx: TransactionSql,
  project: ProjectRow,
  organizationId: string,
  standing: Map<string, boolean>,
  ref: AssigneeRef,
): Promise<boolean> {
  const key = `${ref.assigneeType}:${ref.assigneeId}`;
  const known = standing.get(key);
  if (known !== undefined) return known;
  const holds =
    (await assigneeRefusal(tx, project, organizationId, ref)) === null;
  standing.set(key, holds);
  return holds;
}

/** The assignee a copy carries over, and — when the task had one who no
 * longer holds — why not. */
interface CarriedAssignee {
  assignee: AssigneeRef | null;
  refusal: string | null;
}

/** The assignee, while they still hold: a person with access to the
 * project, an agent still in it. Otherwise the copy starts unassigned, and
 * the answer says why. */
async function carriedAssignee(
  tx: TransactionSql,
  project: ProjectRow,
  task: Pick<CopySource, 'organizationId' | 'assigneeType' | 'assigneeId'>,
  standing: Map<string, boolean>,
): Promise<CarriedAssignee> {
  if (task.assigneeType === null || task.assigneeId === null) {
    return { assignee: null, refusal: null };
  }
  const assignee: AssigneeRef = {
    assigneeType: task.assigneeType,
    assigneeId: task.assigneeId,
  };
  const key = `${assignee.assigneeType}:${assignee.assigneeId}`;
  if (standing.get(key) === true) return { assignee, refusal: null };
  const refusal = await assigneeRefusal(
    tx,
    project,
    task.organizationId,
    assignee,
  );
  standing.set(key, refusal === null);
  return refusal === null
    ? { assignee, refusal: null }
    : { assignee: null, refusal };
}

function warnUnassigned(taskId: string, refusal: string): void {
  console.warn(
    `[tasks] task ${taskId}: next repeating copy unassigned (${refusal})`,
  );
}

/** The designated reviewer, while they could still review here — an active
 * member who can edit the project, the bar the review gate holds every
 * candidate to. */
async function carriedReviewer(
  tx: TransactionSql,
  project: ProjectRow,
  task: Pick<CopySource, 'id' | 'organizationId' | 'reviewerUserId'>,
): Promise<string | null> {
  if (task.reviewerUserId === null) return null;
  const eligibility = await reviewerEligibility(tx, {
    organizationId: task.organizationId,
    projectTeamIds: project.teamIds,
    userId: task.reviewerUserId,
  });
  if (eligibility !== 'eligible') {
    console.warn(
      `[tasks] task ${task.id}: next repeating copy has no designated reviewer (they can no longer review in this project)`,
    );
    return null;
  }
  return task.reviewerUserId;
}
