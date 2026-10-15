import type { ManagedDispatchPlan } from '@tale/shared/schemas/managed-configuration';
import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';

import { scheduleOfTrigger } from '../../../lib/automations/schedule/occurrences.ts';
import { PREDEFINED_TASK_LABELS } from '../../../lib/shared/task-label-colors.ts';
import { assertExpectedHash } from '../../core/lib/config_store/precondition.ts';
import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import { PROJECT_AUDIT_ACTIONS } from '../../core/projects/audit_actions.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import {
  assertProjectActive,
  assertProjectAdministrable,
  assertReadable,
  loadProjectOrThrow,
  projectAudit,
  type ProjectAuthContext,
} from '../projects/service.ts';
import { requestDispatchPassInTx } from './dispatch-requests.ts';
import {
  dispatchConfigurationValue,
  readDispatchPreimage,
  type ProjectDispatchConfigurationValue,
} from './dispatch-store.ts';
import { TaskError } from './errors.ts';

/**
 * A project's dispatch document (migration 0206,
 * `@tale/shared/schemas/project-dispatch`): who reads it, who writes it, and
 * what a write is checked against. The pass that acts on it is
 * `dispatch-pass.ts`.
 *
 * Anyone who can read the project reads its dispatch. Only who may
 * administer the project — an organization's Owner or Admin, or one of the
 * project's own administrators — writes it, on an active project: dispatch
 * starts the project's agents for nobody in particular, and what those runs
 * spend is the automation subject's, like a schedule's.
 */

/** The dispatch as managed configuration reads it: the value and its
 * hash, both null when the project has none. A stored document this image
 * cannot read is refused, never read as none (`readDispatchPreimage`). */
export async function readProjectDispatchConfiguration(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<{
  config: ProjectDispatchConfigurationValue | null;
  hash: string | null;
}> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertReadable(project, auth);
  const stored = await readDispatchPreimage(
    sql,
    auth.organizationId,
    projectId,
  );
  const config =
    stored === null
      ? null
      : dispatchConfigurationValue(projectId, stored.config);
  return { config, hash: managedConfigurationHash(config) };
}

/** The refusal of a dispatch that names what the project does not have:
 * static, so it reaches every door as it is; the issues, field by field,
 * ride in its data. */
export const DISPATCH_INVALID_SENTENCE =
  'The dispatch names an agent, a task, a label or a schedule this project cannot use; the issues say which.';

/** One refusal of a dispatch document, by the field it concerns. */
export interface DispatchIssue {
  path: string;
  message: string;
}

/** What a declaration about to be applied will have created in a project
 * beside what it holds now (`ManagedDispatchPlan`): read only by a check,
 * never by a save. */
export type DispatchPlannedState = ManagedDispatchPlan;

/** What a project has that a dispatch may name: its agents, its tasks
 * (archived or not) and its labels by their case-folded name. */
interface DispatchFacts {
  agents: ReadonlySet<string>;
  tasks: ReadonlyMap<string, { archived: boolean }>;
  labels: ReadonlySet<string>;
}

/** The label references a dispatch makes, each with the field it sits in. */
function dispatchLabelRefs(dispatch: ProjectDispatch) {
  return [
    ...(dispatch.labels?.include ?? []).map((name, index) => ({
      name,
      path: `labels.include.${index}`,
    })),
    ...(dispatch.labels?.exclude ?? []).map((name, index) => ({
      name,
      path: `labels.exclude.${index}`,
    })),
    ...(dispatch.gates ?? []).flatMap((gate, gateIndex) =>
      (gate.labels ?? []).map((name, index) => ({
        name,
        path: `gates.${gateIndex}.labels.${index}`,
      })),
    ),
  ];
}

/** Every issue of a dispatch against what its project has. */
function judgeDispatch(
  dispatch: ProjectDispatch,
  facts: DispatchFacts,
): DispatchIssue[] {
  const issues: DispatchIssue[] = [];
  for (const [index, agentId] of dispatch.agents.entries()) {
    if (!facts.agents.has(agentId)) {
      issues.push({
        path: `agents.${index}`,
        message: `No agent with the id "${agentId}" works in this project.`,
      });
    }
  }
  for (const [index, role] of (dispatch.standingRoles ?? []).entries()) {
    if (!facts.agents.has(role.agentId)) {
      issues.push({
        path: `standingRoles.${index}.agentId`,
        message: `No agent with the id "${role.agentId}" works in this project.`,
      });
    }
    const task = facts.tasks.get(role.taskId);
    if (task === undefined) {
      issues.push({
        path: `standingRoles.${index}.taskId`,
        message: `No task with the id "${role.taskId}" is in this project.`,
      });
    } else if (task.archived) {
      issues.push({
        path: `standingRoles.${index}.taskId`,
        message: 'The standing role’s task is archived; restore it first.',
      });
    }
    const schedule = scheduleOfTrigger({
      cron: role.cron,
      timezone: role.timezone,
      scheduleRule: null,
    });
    if ('issue' in schedule) {
      issues.push({
        path: `standingRoles.${index}.cron`,
        message: `The schedule does not read: ${schedule.issue}.`,
      });
    }
  }
  // A label filter or a gate naming a label the project lacks would match
  // nothing, silently: name it instead.
  for (const ref of dispatchLabelRefs(dispatch)) {
    if (!facts.labels.has(ref.name.toLowerCase())) {
      issues.push({
        path: ref.path,
        message: `No label named "${ref.name}" is in this project.`,
      });
    }
  }
  return issues;
}

/**
 * What a dispatch names that the database must confirm: every agent of the
 * pool and of a standing role is an agent of this project, every standing
 * role's task is an open task of this project, every label it filters or
 * gates on is the project's, and every cron expression reads in its zone.
 * Empty when the document is sound. A check may add what a declaration
 * about to be applied creates (`planned`): agents, tasks — new, so never
 * archived — and labels counted as the project's.
 */
export async function checkProjectDispatch(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    dispatch: ProjectDispatch;
    planned?: DispatchPlannedState;
  },
): Promise<DispatchIssue[]> {
  const agents = await sql<{ id: string }[]>`
    SELECT id FROM app.project_agents
    WHERE project_id = ${args.projectId} AND org_id = ${args.organizationId}
  `;
  const taskIds = [
    ...new Set((args.dispatch.standingRoles ?? []).map((role) => role.taskId)),
  ];
  const tasks =
    taskIds.length === 0
      ? []
      : await sql<{ id: string; archived: boolean }[]>`
          SELECT id, archived_at_ms IS NOT NULL AS archived
          FROM app.tasks
          WHERE org_id = ${args.organizationId}
            AND project_id = ${args.projectId}
            AND id = ANY(${taskIds})
        `;
  const labelRefs = dispatchLabelRefs(args.dispatch);
  const labels =
    labelRefs.length === 0
      ? []
      : await sql<{ name: string }[]>`
          SELECT lower(name) AS name FROM app.task_labels
          WHERE org_id = ${args.organizationId} AND project_id = ${args.projectId}
            AND lower(name) = ANY(${labelRefs.map((ref) => ref.name.toLowerCase())})
        `;
  const planned = args.planned;
  return judgeDispatch(args.dispatch, {
    agents: new Set([
      ...agents.map((agent) => agent.id),
      ...(planned?.agents ?? []),
    ]),
    tasks: new Map([
      ...(planned?.tasks ?? []).map((id) => [id, { archived: false }] as const),
      ...tasks.map((task) => [task.id, { archived: task.archived }] as const),
    ]),
    labels: new Set([
      ...labels.map((label) => label.name),
      ...(planned?.labels ?? []).map((name) => name.toLowerCase()),
    ]),
  });
}

/**
 * A dispatch checked for a project a declaration is about to create, before
 * anything is written: it names only what the same declaration creates —
 * the project's agents, its tasks, its labels and the labels every new
 * project starts with — and only who may administer a new project, an
 * organization's Owner or Admin, may declare one. The save, once the
 * project exists, checks it again against what it then holds.
 */
export function checkPlannedProjectDispatch(
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    dispatch: ProjectDispatch;
    expectedHash?: string | null;
    planned: DispatchPlannedState;
  },
):
  | { ok: true; changed: boolean; hash: string }
  | { ok: false; issues: DispatchIssue[] } {
  if (
    !checkProjectAccess({ teamIds: [] }, auth.teamIds, auth.role).canAdminister
  )
    throw new TaskError(
      'PROJECT_FORBIDDEN',
      'Only who may administer the project changes its dispatch',
      403,
    );
  assertExpectedHash(null, args.expectedHash);
  const issues = judgeDispatch(args.dispatch, {
    agents: new Set(args.planned.agents),
    tasks: new Map(
      args.planned.tasks.map((id) => [id, { archived: false }] as const),
    ),
    labels: new Set([
      ...PREDEFINED_TASK_LABELS.map((label) => label.name.toLowerCase()),
      ...args.planned.labels.map((name) => name.toLowerCase()),
    ]),
  });
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    changed: true,
    hash:
      managedConfigurationHash(
        dispatchConfigurationValue(args.projectId, args.dispatch),
      ) ?? '',
  };
}

interface DispatchSaveArgs {
  projectId: string;
  dispatch: ProjectDispatch;
  /** A check's alone: what a declaration about to be applied creates. */
  planned?: DispatchPlannedState;
  /** The hash of the document the caller reviewed; undefined skips the
   * comparison (the app's own form, which always saves what it read). */
  expectedHash?: string | null;
}

/** Everything a save checks before it writes, in the caller's transaction:
 * the caller may administer the project, the project is active, the stored
 * document is the one the caller reviewed and this image can read, and what
 * the document names checks out (`issues`, empty when it does). */
async function prepareDispatchSave(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: DispatchSaveArgs,
) {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertProjectAdministrable(project, auth);
  assertProjectActive(project);
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended('project-dispatch:' || ${args.projectId}, 0))
  `;
  const stored = await readDispatchPreimage(
    tx,
    auth.organizationId,
    args.projectId,
  );
  const current =
    stored === null
      ? null
      : dispatchConfigurationValue(args.projectId, stored.config);
  assertExpectedHash(managedConfigurationHash(current), args.expectedHash);
  const issues = await checkProjectDispatch(tx, {
    organizationId: auth.organizationId,
    projectId: args.projectId,
    dispatch: args.dispatch,
    ...(args.planned !== undefined ? { planned: args.planned } : {}),
  });
  const next = dispatchConfigurationValue(args.projectId, args.dispatch);
  const hash = managedConfigurationHash(next) ?? '';
  const changed =
    current === null || managedConfigurationHash(current) !== hash;
  return { project, stored, issues, hash, changed };
}

/**
 * What saving a project's dispatch would do, checked exactly as the save
 * checks it and writing nothing: no document, audit, pass or hint. Managed
 * configuration asks it before it writes anything of a declaration, since a
 * dispatch is written last and a refusal there would leave the rest applied.
 * A refusal of the caller or of the stored document still throws, as the
 * save does; what the document itself names wrongly is answered as issues.
 */
export async function checkProjectDispatchSave(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: DispatchSaveArgs,
): Promise<
  | { ok: true; changed: boolean; hash: string }
  | { ok: false; issues: DispatchIssue[] }
> {
  const prepared = await prepareDispatchSave(tx, auth, args);
  if (prepared.issues.length > 0) {
    return { ok: false, issues: prepared.issues };
  }
  return { ok: true, changed: prepared.changed, hash: prepared.hash };
}

/**
 * Write a project's dispatch, in the caller's serializable transaction,
 * once `prepareDispatchSave` passes. A stored document this image cannot
 * read is never replaced (`CONFIG_UNREADABLE`). Writing the stored document
 * again changes nothing. A change is audited and asks for a pass at once,
 * so switching dispatch on or widening its pool takes effect without
 * waiting for the next minute.
 */
export async function saveProjectDispatch(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: DispatchSaveArgs,
): Promise<{ changed: boolean; hash: string }> {
  const { planned: _planned, ...saved } = args;
  const { project, stored, issues, hash, changed } = await prepareDispatchSave(
    tx,
    auth,
    saved,
  );
  if (issues.length > 0) {
    throw new TaskError('DISPATCH_INVALID', DISPATCH_INVALID_SENTENCE, 400, {
      issues,
    });
  }
  if (!changed) {
    return { changed: false, hash };
  }
  const now = Date.now();
  await tx`
    INSERT INTO app.project_dispatch (
      project_id, org_id, config, enabled, updated_by, created_at_ms,
      updated_at_ms
    ) VALUES (
      ${args.projectId}, ${auth.organizationId}, ${tx.json(args.dispatch)},
      ${args.dispatch.enabled}, ${auth.userId}, ${now}, ${now}
    )
    ON CONFLICT (project_id) DO UPDATE SET
      config = EXCLUDED.config, enabled = EXCLUDED.enabled,
      updated_by = EXCLUDED.updated_by, updated_at_ms = EXCLUDED.updated_at_ms
  `;
  await createAuditLog(
    tx,
    projectAudit(auth, project, PROJECT_AUDIT_ACTIONS.dispatchChanged, {
      metadata: {
        enabled: args.dispatch.enabled,
        agents: args.dispatch.agents.length,
        maxConcurrentRuns: args.dispatch.maxConcurrentRuns,
        standingRoles: args.dispatch.standingRoles?.length ?? 0,
        ...(stored === null ? { created: true } : {}),
      },
    }),
  );
  if (args.dispatch.enabled) {
    await requestDispatchPassInTx(tx, {
      organizationId: auth.organizationId,
      projectId: args.projectId,
      trigger: 'config',
    });
  }
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'project',
    entityId: args.projectId,
  });
  return { changed: true, hash };
}
