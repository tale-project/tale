import { createHash } from 'node:crypto';

import {
  markRetryQueueKey,
  RETRY_QUEUE_LOCK_CLASS,
  transactSerializable,
} from '@tale/shared/db/serializable';
import { taskExternalIssueSchema } from '@tale/shared/schemas/task-external-issue';
import type { Sql, TransactionSql } from 'postgres';

import type { ConnectorCaller } from '../../../lib/connectors/dispatcher.ts';
import type {
  WorkflowAgentStart,
  WorkflowTaskCreated,
  WorkflowTaskStore,
} from '../../../lib/connectors/natives/index.ts';
import type { WorkflowIssueInput } from '../../../lib/connectors/natives/platform-tasks.ts';
import { parseRunStarter } from '../../../lib/shared/run-starter.ts';
import {
  truncateImportedDescription,
  truncateImportedTitle,
} from '../../core/tasks/helpers.ts';
import { taskMentionPlainText } from '../../core/tasks/mentions.ts';
import { authorizeActorRun } from '../automations/dispatch-store.ts';
import {
  AutomationError,
  bindingProjectIds,
  getRun,
  resolveRunProject,
} from '../automations/store.ts';
import { currentMentionNames } from '../collab/mention-directory.ts';
import {
  getProjectAuthContext,
  loadProjectOrThrow,
  type ProjectAuthContext,
  type ProjectRow,
} from '../projects/service.ts';
import {
  addTaskComment,
  listTaskComments,
  TASK_COMMENT_PAGE_MAX,
} from '../tasks/comments.ts';
import {
  type DelegatedAgentStart,
  startDelegatedAgentRun,
  withStartWait,
} from '../tasks/delegated-start.ts';
import {
  automationOwnerOfWorkflowSlug,
  upsertTaskByExternalRef,
} from '../tasks/external-ref.ts';
import { readImportCursor, saveImportCursor } from '../tasks/import-cursors.ts';
import {
  agentUpdateTaskStatusTrusted,
  assertTaskCreatable,
  assertTaskWorkable,
  boardTaskAccess,
  createTask,
  loadTaskOrThrow,
  TaskError,
  type TaskRow,
} from '../tasks/service.ts';
import { wakeGenerationForStart } from '../tasks/slot-wakes.ts';

function issueImportQueueKey(
  organizationId: string,
  projectId: string,
): string {
  return `task-issue-import:${organizationId}:${projectId}`;
}

async function lockIssueImportQueue(
  tx: TransactionSql,
  key: string,
): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(${RETRY_QUEUE_LOCK_CLASS}, hashtext(${key}))`;
}

/**
 * The door a project agent an automation step starts answers to: the person
 * who started the automation run (a bare id, as project-agent runs carry
 * it), or the schedule that fired it (`trigger:<id>`). A webhook or event
 * run answers to nobody who may put an agent to work: a URL holder or a
 * platform event is not a grant to spend an agent's equipment.
 */
async function automationRunStarter(
  tx: TransactionSql,
  args: { organizationId: string; startedBy: string },
): Promise<string> {
  const starter = parseRunStarter(args.startedBy);
  if (starter.kind === 'user' || starter.kind === 'api-key') {
    return starter.userId;
  }
  if (starter.kind === 'trigger') {
    const triggers = await tx<{ kind: string }[]>`
      SELECT kind FROM app.automation_triggers
      WHERE id = ${starter.triggerId} AND org_id = ${args.organizationId}
      LIMIT 1
    `;
    if (triggers[0]?.kind === 'schedule') return args.startedBy;
    throw new TaskError(
      'AGENT_START_FORBIDDEN',
      'Only a schedule or a person can start a project agent; a webhook or platform-event run cannot',
      403,
    );
  }
  throw new TaskError(
    'AGENT_START_FORBIDDEN',
    'This automation run answers to nobody who may start agents',
    403,
  );
}

/** The native's answer: the run it started or found, or why none. */
function workflowAgentStartOf(
  outcome: DelegatedAgentStart,
): WorkflowAgentStart {
  switch (outcome.outcome) {
    case 'started':
      return {
        started: true,
        runId: outcome.runId,
        taskId: outcome.taskId,
        agentId: outcome.agentId,
        ...(outcome.replayed === true ? { replayed: true } : {}),
        ...(outcome.waiting !== undefined
          ? { waitingReason: outcome.waiting.reason }
          : {}),
      };
    case 'already_running':
      return {
        started: false,
        reason: 'already_running',
        runId: outcome.runId,
        taskId: outcome.taskId,
        agentId: outcome.agentId,
      };
    case 'stale_question':
      // A step never resumes a question (it passes no `resumeFrom`).
      throw new Error('an automation step does not resume a question');
    case 'stale_repair':
      // A step never admits a review repair (it passes no `resumeFrom`).
      throw new Error('an automation step does not resume a review repair');
    case 'review_batch':
      throw new Error('an automation step does not admit a review batch');
    case 'in_review':
      return {
        started: false,
        reason: 'in_review',
        runId: null,
        taskId: outcome.taskId,
        agentId: outcome.agentId,
      };
    case 'closed':
      return {
        started: false,
        reason: 'closed',
        runId: null,
        taskStatus: outcome.taskStatus,
        taskId: outcome.taskId,
        agentId: outcome.agentId,
      };
    case 'self_start':
      // Only an agent starts itself; a step names another agent.
      throw new Error('an automation step does not start itself');
    case 'blocked':
      return {
        started: false,
        reason: 'blocked',
        runId: null,
        blockedBy: outcome.blockedBy,
        taskId: outcome.taskId,
        agentId: outcome.agentId,
      };
    case 'paused':
      return {
        started: false,
        reason: 'paused',
        runId: null,
        retryAfter: outcome.retryAfter,
        taskId: outcome.taskId,
        agentId: outcome.agentId,
      };
    default: {
      // Exhaustiveness: a new outcome must say what the native answers.
      const unknown: never = outcome;
      throw new Error(`unknown start outcome ${JSON.stringify(unknown)}`);
    }
  }
}

/** The task natives over the 0.5 tasks domain — trusted writes (the
 * connector door's callers own authorization), the 0.4 platform-store
 * semantics. */
/**
 * The id a step's task takes: the same for every attempt of one execution
 * (the run ledger's key for it), so a retry after the insert finds the task
 * it made instead of making a second. A name-based UUID, version 5 shape.
 */
function stepTaskId(organizationId: string, idempotencyKey: string): string {
  const hex = createHash('sha256')
    .update(`task.create\u0000${organizationId}\u0000${idempotencyKey}`)
    .digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, '0');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Who a step names as a task's assignee: a member by email or user id, or
 * an agent of the project by id, handle or name (case-insensitive). Whether
 * that one may work in the project is the task domain's own check.
 */
async function resolveStepAssignee(
  tx: TransactionSql,
  organizationId: string,
  projectId: string,
  assignee: string,
): Promise<{ assigneeType: 'user' | 'agent'; assigneeId: string }> {
  const ref = assignee.trim();
  const folded = ref.toLowerCase();
  if (ref.includes('@') && !ref.startsWith('@')) {
    const members = await tx<{ id: string }[]>`
      SELECT u.id FROM "user" u
      JOIN "member" m ON m."userId" = u.id
      WHERE m."organizationId" = ${organizationId}
        AND lower(u.email) = ${folded}
      LIMIT 1
    `;
    const member = members[0];
    if (member !== undefined) {
      return { assigneeType: 'user', assigneeId: member.id };
    }
  } else {
    const members = await tx<{ userId: string }[]>`
      SELECT "userId" FROM "member"
      WHERE "organizationId" = ${organizationId} AND "userId" = ${ref}
      LIMIT 1
    `;
    const member = members[0];
    if (member !== undefined) {
      return { assigneeType: 'user', assigneeId: member.userId };
    }
    const handle = folded.replace(/^@/, '');
    const agents = await tx<{ id: string }[]>`
      SELECT id FROM app.project_agents
      WHERE org_id = ${organizationId} AND project_id = ${projectId}
        AND (id = ${ref} OR lower(handle) = ${handle}
          OR lower(name) = ${folded})
      ORDER BY (id = ${ref}) DESC, (lower(handle) = ${handle}) DESC, id
      LIMIT 1
    `;
    const agent = agents[0];
    if (agent !== undefined) {
      return { assigneeType: 'agent', assigneeId: agent.id };
    }
  }
  throw new TaskError(
    'TASK_ASSIGNEE_UNKNOWN',
    'No member of the organization and no agent of the project answers to that name',
    404,
    { assignee: ref },
  );
}

export function pgTaskStore(sql: Sql): WorkflowTaskStore {
  const systemAuth = async (organizationId: string) =>
    getProjectAuthContext(sql, {
      organizationId,
      userId: 'system',
      role: 'owner',
    });
  /**
   * The project a native writes in, and the PERSON the write answers to:
   * a person's own connector call, or the person who started the workflow
   * run. A run a schedule or a webhook fired answers to nobody (null) and
   * keeps the automation's own reach.
   *
   * An org-wide run's input is not a grant to every private project: the
   * person's current rights on the project hold at the write boundary, the
   * same rights they have on the board — a reader of the active project
   * creates tasks there, and changes only the tasks they may work (an
   * editor, every task). So a run a member may start (one built for their
   * task) works within the member's reach instead of dying on an editor
   * check halfway.
   */
  const authorizeProject = async (
    tx: TransactionSql,
    organizationId: string,
    projectId: string,
    caller: ConnectorCaller,
  ): Promise<{ project: ProjectRow; person: ProjectAuthContext | null }> => {
    const project = await loadProjectOrThrow(tx, projectId);
    if (
      project.organizationId !== organizationId ||
      project.archivedAt !== null
    ) {
      throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
    }
    let personId: string | null = null;
    if (caller.kind === 'workflow') {
      const run = await getRun(tx, organizationId, caller.runId);
      if (!run || (run.projectId !== null && run.projectId !== projectId)) {
        throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
      }
      await resolveRunProject(tx, {
        organizationId,
        name: run.name,
        projectId: projectId,
      });
      const starter = parseRunStarter(run.startedBy);
      if (starter.kind === 'user' || starter.kind === 'api-key') {
        personId = starter.userId;
      } else if (starter.kind !== 'trigger') {
        throw new TaskError('PROJECT_NOT_FOUND', 'Project not found', 404);
      }
    } else if (caller.kind === 'user') {
      personId = caller.userId;
    }
    if (personId === null) return { project, person: null };
    const person = await authorizeActorRun(
      tx,
      organizationId,
      personId,
      'membership',
    );
    assertTaskCreatable(project, person);
    return { project, person };
  };
  const persistIssue = async (
    tx: TransactionSql,
    organizationId: string,
    caller: ConnectorCaller,
    scope: { project: ProjectRow; person: ProjectAuthContext | null },
    issue: WorkflowIssueInput,
  ) => {
    const { project, person } = scope;
    // A person who is not the project's editor changes only the tasks they
    // may work and names only labels the catalog already has.
    const restricted =
      person !== null && !boardTaskAccess(project, person).canEdit;
    return upsertTaskByExternalRef(tx, {
      ...issue,
      organizationId,
      projectId: project.id,
      actorId: caller.kind === 'user' ? caller.userId : 'workflow',
      ...(caller.kind === 'user' ? { creatorType: 'user' as const } : {}),
      dedupeScope: 'project',
      descriptionMode: 'preserve',
      ...(restricted
        ? {
            mintLabels: false,
            authorizeReconcile: (task: TaskRow) =>
              assertTaskWorkable(tx, project, task, person),
          }
        : {}),
    });
  };
  return {
    async upsertIssues({ organizationId, caller, projectId, issues }) {
      const queueKey = issueImportQueueKey(organizationId, projectId);
      return transactSerializable(sql, async (tx) => {
        try {
          // Overlapping imports touch the same source and project rows. A
          // transaction lock alone cannot refresh a serializable snapshot;
          // mark conflicts so the shared retry queue takes this lock before
          // opening the retry's snapshot, ahead of any inner audit locks.
          await lockIssueImportQueue(tx, queueKey);
          const scope = await authorizeProject(
            tx,
            organizationId,
            projectId,
            caller,
          );
          const ordered = issues
            .map((issue, index) => ({ issue, index }))
            .sort((left, right) =>
              `${left.issue.externalSystem}:${left.issue.externalIssue?.id ?? left.issue.externalId}`.localeCompare(
                `${right.issue.externalSystem}:${right.issue.externalIssue?.id ?? right.issue.externalId}`,
              ),
            );
          const results = [];
          for (const { issue, index } of ordered) {
            const result = await persistIssue(
              tx,
              organizationId,
              caller,
              scope,
              issue,
            );
            // The domain answers the title the task carries after the write
            // (cut, or kept by a source reconcile), not the one sent.
            results.push({ index, value: result });
          }
          return results
            .sort((left, right) => left.index - right.index)
            .map((result) => result.value);
        } catch (error) {
          throw markRetryQueueKey(error, queueKey);
        }
      });
    },

    async listExternalIssues({
      organizationId,
      caller,
      projectId,
      externalSystem,
      repositoryId,
      sourceOrigin,
      sourceProjectId,
      limit,
      legacyPrefixes,
    }) {
      const sourceScope =
        externalSystem === 'github'
          ? repositoryId?.toString()
          : sourceProjectId;
      return sql.begin(async (tx) => {
        // Selection now writes its own attempt clock. Share the batch queue
        // so refresh bookkeeping and source upserts never lock a project's
        // task rows in opposite orders.
        await lockIssueImportQueue(
          tx,
          issueImportQueueKey(organizationId, projectId),
        );
        await authorizeProject(tx, organizationId, projectId, caller);
        const rows = await tx<
          { taskId: string; externalId: string; externalIssue: unknown }[]
        >`
          SELECT id AS "taskId", external_id AS "externalId", external_issue AS "externalIssue"
          FROM app.tasks
          WHERE org_id = ${organizationId} AND project_id = ${projectId}
            AND external_system = ${externalSystem} AND ( (external_issue IS NOT NULL
            AND ${repositoryId === undefined ? tx`TRUE` : tx`(external_issue->>'repositoryId' = ${String(repositoryId)} OR ${String(repositoryId)} = ANY(external_issue_source_scopes))`}
            AND ${sourceProjectId === undefined ? tx`TRUE` : tx`(external_issue->>'sourceProjectId' = ${sourceProjectId} OR ${sourceProjectId} = ANY(external_issue_source_scopes))`}
            AND ${sourceOrigin === undefined ? tx`TRUE` : tx`split_part(external_source_id, '#', 1) = ${sourceOrigin}`})
              OR (external_issue IS NULL AND EXISTS (
                SELECT 1 FROM unnest(${legacyPrefixes ?? []}::text[]) AS prefix
                WHERE CASE WHEN ${externalSystem} = 'github'
                  THEN starts_with(lower(external_id), lower(prefix))
                  ELSE starts_with(external_id, prefix) END
              )) )
          ORDER BY GREATEST(
            COALESCE(external_issue_refresh_attempted_at_ms, 0),
            COALESCE((external_issue->>'syncedAt')::bigint, 0)
          ) ASC, id ASC
          LIMIT ${limit + 1}
        `;
        const selected = rows.slice(0, limit);
        if (selected.length > 0) {
          // This records a scheduling attempt, not a successful source read.
          // Missing legacy rows and failed reads must rotate behind unchecked
          // rows without inventing a snapshot or changing local task activity.
          // Remember the authorized query scope before the remote read: even
          // a legacy row may hydrate into a different repository or project.
          // Move behind the project's entire effective queue, including
          // clocks ahead of this replica after a wall-clock rollback. A
          // per-row increment alone can leave a legacy row ahead forever.
          await tx`
            UPDATE app.tasks SET external_issue_source_scopes = CASE
              WHEN ${sourceScope === undefined} OR ${sourceScope ?? ''} = ANY(COALESCE(external_issue_source_scopes, ARRAY[]::text[]))
                THEN external_issue_source_scopes
              ELSE array_append(COALESCE(external_issue_source_scopes, ARRAY[]::text[]), ${sourceScope ?? ''}) END,
            external_issue_refresh_attempted_at_ms = GREATEST(
              COALESCE(external_issue_refresh_attempted_at_ms, 0) + 1,
              ${Date.now()}, queue.next_clock
            )
            FROM (
              SELECT COALESCE(MAX(GREATEST(
                COALESCE(external_issue_refresh_attempted_at_ms, 0),
                COALESCE((external_issue->>'syncedAt')::bigint, 0)
              )), 0) + 1 AS next_clock
              FROM app.tasks WHERE org_id = ${organizationId} AND project_id = ${projectId}
            ) AS queue
            WHERE app.tasks.org_id = ${organizationId} AND app.tasks.project_id = ${projectId}
              AND app.tasks.id IN ${tx(selected.map((row) => row.taskId))}
          `;
        }
        return {
          issues: selected.map((row) => ({
            taskId: row.taskId,
            externalId: row.externalId,
            externalIssue:
              row.externalIssue === null
                ? null
                : taskExternalIssueSchema.parse(row.externalIssue),
          })),
          hasMore: rows.length > limit,
        };
      });
    },
    async upsert({ organizationId, caller, ...input }) {
      return sql.begin(async (tx) => {
        const scope = await authorizeProject(
          tx,
          organizationId,
          input.projectId,
          caller,
        );
        return persistIssue(tx, organizationId, caller, scope, input);
      });
    },
    async create({ organizationId, caller, idempotencyKey, ...input }) {
      if (caller.kind !== 'workflow') {
        throw new TaskError(
          'TASK_CREATE_FORBIDDEN',
          'Only an automation step creates a task through this action',
          403,
        );
      }
      const taskId = stepTaskId(organizationId, idempotencyKey);
      const made = async (tx: TransactionSql) => {
        const rows = await tx<
          { number: number; title: string; projectId: string }[]
        >`
          SELECT number, title, project_id AS "projectId" FROM app.tasks
          WHERE id = ${taskId} AND org_id = ${organizationId}
          LIMIT 1
        `;
        const row = rows[0];
        if (row === undefined) return null;
        const task: WorkflowTaskCreated = {
          taskId,
          number: row.number,
          title: row.title,
          url: `/dashboard/${organizationId}/projects/${row.projectId}/tasks?task=${taskId}`,
        };
        return task;
      };
      try {
        const task = await sql.begin(async (tx) => {
          // A retry of an execution whose task was already made answers it.
          const earlier = await made(tx);
          if (earlier !== null) return earlier;
          const scope = await authorizeProject(
            tx,
            organizationId,
            input.projectId,
            caller,
          );
          const run = await getRun(tx, organizationId, caller.runId);
          const owner =
            run === null
              ? null
              : await automationOwnerOfWorkflowSlug(
                  tx,
                  organizationId,
                  run.name,
                );
          const assignee =
            input.assignee === undefined
              ? undefined
              : await resolveStepAssignee(
                  tx,
                  organizationId,
                  input.projectId,
                  input.assignee,
                );
          await createTask(
            tx,
            scope.person ?? (await systemAuth(organizationId)),
            {
              projectId: input.projectId,
              title: truncateImportedTitle(input.title),
              ...(input.description !== undefined && {
                description: truncateImportedDescription(input.description),
              }),
              ...(input.status !== undefined && { status: input.status }),
              ...(input.dueDate !== undefined && { dueDate: input.dueDate }),
              ...(input.labels !== undefined && { labels: input.labels }),
              ...(assignee !== undefined && assignee),
            },
            {
              taskId,
              // Labels the catalog lacks are added for a writer who may edit
              // the project — or for the automation alone, on a trigger's
              // run — as an import adds them.
              mintLabels:
                scope.person === null ||
                boardTaskAccess(scope.project, scope.person).canEdit,
              // The automation that made it, as an import names it.
              creator:
                owner !== null
                  ? { id: owner, type: 'app' }
                  : { id: 'workflow', type: 'agent' },
            },
          );
          const stored = await made(tx);
          if (stored === null) {
            throw new Error('task.create stored no task under its id');
          }
          return stored;
        });
        return { ok: true, task };
      } catch (error) {
        // Refused before anything stayed written (the transaction rolled
        // back): said in the run record's words, not as a crash.
        // The run's binding: a project it is not installed in, or one it may
        // not reach.
        if (
          error instanceof AutomationError &&
          (error.code === 'PROJECT_NOT_FOUND' ||
            error.code === 'AUTOMATION_PROJECT_FORBIDDEN')
        ) {
          return {
            ok: false,
            refusal: { kind: 'project', detail: error.message },
          };
        }
        if (error instanceof TaskError) {
          if (error.code === 'PROJECT_NOT_FOUND') {
            return {
              ok: false,
              refusal: { kind: 'project', detail: error.message },
            };
          }
          if (
            error.code === 'TASK_ASSIGNEE_UNKNOWN' ||
            error.code.startsWith('ASSIGNEE_')
          ) {
            return {
              ok: false,
              refusal: { kind: 'assignee', detail: error.message },
            };
          }
        }
        throw error;
      }
    },
    async list({
      organizationId,
      caller,
      projectId,
      statuses,
      createdSince,
      limit,
    }) {
      try {
        return await sql.begin(async (tx) => {
          await authorizeProject(tx, organizationId, projectId, caller);
          const rows = await tx<
            {
              taskId: string;
              number: number | null;
              title: string;
              status: string;
              priority: string | null;
              assigneeType: string | null;
              assigneeId: string | null;
              assigneeName: string | null;
              dueDateMs: number | null;
              createdAtMs: number;
            }[]
          >`
            SELECT t.id AS "taskId", t.number, t.title, t.status, t.priority,
                   t.assignee_type AS "assigneeType", t.assignee_id AS "assigneeId",
                   CASE t.assignee_type
                     WHEN 'user' THEN COALESCE(u.name, u.email)
                     WHEN 'agent' THEN a.name
                   END AS "assigneeName",
                   t.due_date_ms::float8 AS "dueDateMs",
                   t.created_at_ms::float8 AS "createdAtMs"
            FROM app.tasks t
            LEFT JOIN "user" u
              ON t.assignee_type = 'user' AND u.id = t.assignee_id
            LEFT JOIN app.project_agents a
              ON t.assignee_type = 'agent' AND a.id = t.assignee_id
                 AND a.project_id = t.project_id
            WHERE t.org_id = ${organizationId} AND t.project_id = ${projectId}
              AND t.archived_at_ms IS NULL
              AND ${statuses === undefined ? tx`TRUE` : tx`t.status = ANY(${[...statuses]})`}
              AND ${createdSince === undefined ? tx`TRUE` : tx`t.created_at_ms >= ${createdSince}`}
            ORDER BY t.created_at_ms DESC, t.id DESC
            LIMIT ${limit + 1}
          `;
          return {
            ok: true as const,
            tasks: rows.slice(0, limit).map((row) => ({
              taskId: row.taskId,
              number: row.number,
              title: row.title,
              status: row.status,
              priority: row.priority,
              assignee:
                row.assigneeType === null || row.assigneeId === null
                  ? null
                  : {
                      type: row.assigneeType,
                      id: row.assigneeId,
                      name: row.assigneeName,
                    },
              dueDate:
                row.dueDateMs === null
                  ? null
                  : new Date(row.dueDateMs).toISOString().slice(0, 10),
              createdAt: new Date(row.createdAtMs).toISOString(),
              url: `/dashboard/${organizationId}/projects/${projectId}/tasks?task=${row.taskId}`,
            })),
            hasMore: rows.length > limit,
          };
        });
      } catch (error) {
        // A project the run may not read answers in the run record's words,
        // as a create there does.
        if (
          (error instanceof AutomationError &&
            (error.code === 'PROJECT_NOT_FOUND' ||
              error.code === 'AUTOMATION_PROJECT_FORBIDDEN')) ||
          (error instanceof TaskError && error.code === 'PROJECT_NOT_FOUND')
        ) {
          return {
            ok: false as const,
            refusal: { kind: 'project' as const, detail: error.message },
          };
        }
        throw error;
      }
    },
    async get({ organizationId, taskId }) {
      let task: Awaited<ReturnType<typeof loadTaskOrThrow>>;
      try {
        task = await loadTaskOrThrow(sql, taskId, organizationId);
      } catch (error) {
        // `null` is the contract for ONE outcome — no such task in this org.
        // Everything else (a dropped connection, an exhausted pool, a bug)
        // must surface as the failure it is: a workflow handed a swallowed
        // error would skip real work or tell the user a task is gone when
        // the database merely blinked.
        if (error instanceof TaskError && error.code === 'TASK_NOT_FOUND') {
          return null;
        }
        throw error;
      }
      return {
        taskId: task.id,
        title: task.title,
        status: task.status,
        // The description as stored (each mention a mention link), and read
        // as text, each mention as `@` and the current name.
        ...(task.description !== null
          ? {
              description: task.description,
              descriptionText: taskMentionPlainText(
                task.description,
                await currentMentionNames(sql, organizationId, [
                  task.description,
                ]),
              ),
            }
          : {}),
        projectId: task.projectId,
        ...(task.externalSystem != null
          ? { externalSystem: task.externalSystem }
          : {}),
        ...(task.externalId != null ? { externalId: task.externalId } : {}),
        ...(task.externalUrl != null ? { externalUrl: task.externalUrl } : {}),
      };
    },
    async updateStatus({ organizationId, taskId, status }) {
      const result = await transactSerializable(sql, (tx) =>
        agentUpdateTaskStatusTrusted(tx, {
          organizationId,
          actorId: 'workflow',
          taskId,
          status,
        }),
      );
      return result;
    },
    async comment({ organizationId, taskId, body, bodyByLocale }) {
      const auth = await systemAuth(organizationId);
      const result = await sql.begin((tx) =>
        addTaskComment(tx, auth, {
          taskId,
          body,
          ...(bodyByLocale !== undefined ? { bodyByLocale } : {}),
          author: { actorType: 'agent', actorId: 'workflow' },
        }),
      );
      return { messageId: result.messageId };
    },
    async startAgent({
      organizationId,
      caller,
      taskId,
      agentId,
      feedback,
      moveToInProgress,
    }) {
      if (caller.kind !== 'workflow') {
        throw new TaskError(
          'AGENT_START_FORBIDDEN',
          'Only an automation step starts a project agent through this action',
          403,
        );
      }
      const outcome = await transactSerializable(sql, async (tx) => {
        const run = await getRun(tx, organizationId, caller.runId);
        if (run === null) {
          throw new TaskError(
            'AGENT_START_FORBIDDEN',
            'The automation run asking to start an agent no longer exists',
            403,
          );
        }
        const startedBy = await automationRunStarter(tx, {
          organizationId,
          startedBy: run.startedBy,
        });
        // The key a keyed door started the automation run with: the agent
        // it puts to work spends under it too.
        const keys = await tx<{ apiKeyId: string | null }[]>`
          SELECT api_key_id AS "apiKeyId" FROM app.automation_runs
          WHERE org_id = ${organizationId} AND id = ${run.id}
          LIMIT 1
        `;
        const apiKeyId = keys[0]?.apiKeyId ?? null;
        // Explicitly project-scoped: the run's own project, or the projects
        // its automation is bound to — an automation bound nowhere reaches no
        // project's agents.
        const scopeProjectIds =
          run.projectId !== null
            ? [run.projectId]
            : await bindingProjectIds(tx, organizationId, run.name);
        // A wake target's start captures the releases its snapshot sees: a
        // plain read, no lock and no write (`slot-wakes.ts`).
        const wakeAdmittedSeq = await wakeGenerationForStart(tx, {
          organizationId,
          taskId,
          startedBy: run.startedBy,
        });
        return startDelegatedAgentRun(tx, {
          organizationId,
          scopeProjectIds,
          taskId,
          startedBy,
          ...(apiKeyId !== null ? { apiKeyId } : {}),
          via: {
            kind: 'automation',
            runId: run.id,
            nodeId: caller.nodeId,
            automation: run.name,
          },
          ...(agentId !== undefined ? { agentId } : {}),
          ...(feedback !== undefined ? { feedback } : {}),
          ...(moveToInProgress !== undefined ? { moveToInProgress } : {}),
          ...(wakeAdmittedSeq !== undefined ? { wakeAdmittedSeq } : {}),
        });
      });
      // Whether the run it started waits for a worker, read once the start
      // has committed.
      return workflowAgentStartOf(
        await withStartWait(sql, organizationId, outcome),
      );
    },
    async getImportCursor({ organizationId, caller, ...key }) {
      if (caller.kind !== 'workflow') {
        throw new TaskError(
          'IMPORT_CURSOR_FORBIDDEN',
          'Only an automation step keeps an import position',
          403,
        );
      }
      return sql.begin(async (tx) => {
        // The run must still write in the project: the same reach its
        // import's own upserts are held to.
        await authorizeProject(tx, organizationId, key.projectId, caller);
        return readImportCursor(tx, { organizationId, ...key });
      });
    },
    async saveImportCursor({ organizationId, caller, revision, next, ...key }) {
      if (caller.kind !== 'workflow') {
        throw new TaskError(
          'IMPORT_CURSOR_FORBIDDEN',
          'Only an automation step keeps an import position',
          403,
        );
      }
      return sql.begin(async (tx) => {
        await authorizeProject(tx, organizationId, key.projectId, caller);
        return saveImportCursor(
          tx,
          { organizationId, ...key },
          { revision, next },
        );
      });
    },
    async listComments({ organizationId, taskId }) {
      const auth = await systemAuth(organizationId);
      // The newest page at the read ceiling: a workflow reads feedback from
      // the tail, and `truncated` tells it when the discussion outgrew one
      // read — never a quietly shortened list.
      const page = await listTaskComments(sql, auth, taskId, {
        limit: TASK_COMMENT_PAGE_MAX,
      });
      // `body` as stored, each mention a mention link; `bodyText` the same
      // text with each mention as `@` and the current name.
      const names = await currentMentionNames(
        sql,
        organizationId,
        page.comments.map((comment) => comment.body),
      );
      return {
        comments: page.comments.map((comment) => ({
          authorType:
            comment.authorType === 'user'
              ? ('user' as const)
              : ('agent' as const),
          authorId: comment.authorId,
          body: comment.body,
          bodyText: taskMentionPlainText(comment.body, names),
          ...(comment.bodyByLocale != null
            ? { bodyByLocale: comment.bodyByLocale }
            : {}),
          createdAt: comment.createdAt,
        })),
        truncated: page.hasMore,
      };
    },
  };
}
