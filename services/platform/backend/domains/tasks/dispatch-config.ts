import type { ManagedDispatchPlan } from '@tale/shared/schemas/managed-configuration';
import type {
  ProjectDispatch,
  ProjectDispatchSource,
} from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';

import { scheduleOfTrigger } from '../../../lib/automations/schedule/occurrences.ts';
import { PREDEFINED_TASK_LABELS } from '../../../lib/shared/task-label-colors.ts';
import { PROJECT_TEAM_IDS_SQL } from '../../core/lib/audience.ts';
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
 * spend is the automation subject's, like a schedule's. A dispatch that
 * serves other boards (`sources`) also needs the writer's right to edit each
 * of them: its agents work those boards on that right, which every pass and
 * every use checks again (`dispatch-reach.ts`).
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
  'The dispatch names an agent, a task, a label, a schedule or another project this project cannot use; the issues say which.';

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
 * (archived or not) and its labels by their case-folded name; the tools each
 * of its stored agents is granted (an agent a declaration is about to create
 * has none listed: its grant is checked when the dispatch is saved); and
 * the other boards the dispatch names, as their check found them. */
interface DispatchFacts {
  agents: ReadonlySet<string>;
  tools: ReadonlyMap<string, readonly string[]>;
  tasks: ReadonlyMap<string, { archived: boolean }>;
  labels: ReadonlySet<string>;
  /** What is wrong with the sources it names (`checkSources`). */
  sourceIssues: readonly DispatchIssue[];
  /** The labels of each source that passed, by case-folded name. */
  sourceLabels: ReadonlyMap<string, ReadonlySet<string>>;
}

/** A label a dispatch names, the field it sits in, and where it is
 * looked up: the project's own board (`own`), one source's board, or — for
 * a gate, which governs by label across every board the dispatch serves —
 * any of them (`anywhere`). */
interface LabelRef {
  name: string;
  path: string;
  scope: 'own' | 'anywhere' | { sourceProjectId: string };
}

/** The label references a dispatch makes, each with the field it sits in. */
function dispatchLabelRefs(dispatch: ProjectDispatch): LabelRef[] {
  return [
    ...(dispatch.labels?.include ?? []).map((name, index) => ({
      name,
      path: `labels.include.${index}`,
      scope: 'own' as const,
    })),
    ...(dispatch.labels?.exclude ?? []).map((name, index) => ({
      name,
      path: `labels.exclude.${index}`,
      scope: 'own' as const,
    })),
    ...(dispatch.sources ?? []).flatMap((source, sourceIndex) =>
      (['include', 'exclude'] as const).flatMap((list) =>
        (source.labels?.[list] ?? []).map((name, index) => ({
          name,
          path: `sources.${sourceIndex}.labels.${list}.${index}`,
          scope: { sourceProjectId: source.projectId },
        })),
      ),
    ),
    ...(dispatch.gates ?? []).flatMap((gate, gateIndex) =>
      (gate.labels ?? []).map((name, index) => ({
        name,
        path: `gates.${gateIndex}.labels.${index}`,
        scope: 'anywhere' as const,
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
  for (const [index, agentId] of (dispatch.reviewers ?? []).entries()) {
    const tools = facts.tools.get(agentId);
    if (!facts.agents.has(agentId)) {
      issues.push({
        path: `reviewers.${index}`,
        message: `No agent with the id "${agentId}" works in this project.`,
      });
    } else if (tools !== undefined && !tools.includes('task_review')) {
      issues.push({
        path: `reviewers.${index}`,
        message: `The agent "${agentId}" may not review tasks; grant it task review first.`,
      });
    }
  }
  issues.push(...facts.sourceIssues);
  // A label filter or a gate naming a label the project lacks would match
  // nothing, silently: name it instead. A source's filter names its own
  // project's labels; a gate governs by label across every board the
  // dispatch serves, so its labels may be any of theirs. A source that did
  // not pass is named once, for itself.
  for (const ref of dispatchLabelRefs(dispatch)) {
    const name = ref.name.toLowerCase();
    if (ref.scope === 'own') {
      if (!facts.labels.has(name)) {
        issues.push({
          path: ref.path,
          message: `No label named "${ref.name}" is in this project.`,
        });
      }
    } else if (ref.scope === 'anywhere') {
      if (
        !facts.labels.has(name) &&
        ![...facts.sourceLabels.values()].some((labels) => labels.has(name))
      ) {
        issues.push({
          path: ref.path,
          message:
            facts.sourceLabels.size === 0
              ? `No label named "${ref.name}" is in this project.`
              : `No label named "${ref.name}" is in this project or any project it serves.`,
        });
      }
    } else {
      const labels = facts.sourceLabels.get(ref.scope.sourceProjectId);
      if (labels !== undefined && !labels.has(name)) {
        issues.push({
          path: ref.path,
          message: `No label named "${ref.name}" is in that project.`,
        });
      }
    }
  }
  return issues;
}

/**
 * What a dispatch names that the database must confirm: every agent of the
 * pool, of a standing role and among the reviewers is an agent of this
 * project (a reviewer one granted task review), every standing role's task
 * is an open task of this project, every label it filters or gates on is the
 * project's (a source's filter that source's, a gate's any board's it
 * serves), every cron expression reads in its zone, and every source is
 * another active project of the organization the writer may edit (`auth`).
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
    /** Who writes it: saving a source needs the right to edit it. */
    auth: ProjectAuthContext;
    planned?: DispatchPlannedState;
  },
): Promise<DispatchIssue[]> {
  const agents = await sql<{ id: string; tools: string[] | null }[]>`
    SELECT id, tools FROM app.project_agents
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
  const sources = await checkSourcesWithLabels(sql, args);
  const labels = await readNamedLabels(sql, {
    organizationId: args.organizationId,
    projectIds: [args.projectId],
    dispatch: args.dispatch,
  });
  const planned = args.planned;
  return judgeDispatch(args.dispatch, {
    agents: new Set([
      ...agents.map((agent) => agent.id),
      ...(planned?.agents ?? []),
    ]),
    tools: new Map(agents.map((agent) => [agent.id, agent.tools ?? []])),
    tasks: new Map([
      ...(planned?.tasks ?? []).map((id) => [id, { archived: false }] as const),
      ...tasks.map((task) => [task.id, { archived: task.archived }] as const),
    ]),
    labels: new Set([
      ...(labels.get(args.projectId) ?? []),
      ...(planned?.labels ?? []).map((name) => name.toLowerCase()),
    ]),
    ...sources,
  });
}

/** The sources a dispatch names, checked for its writer
 * ({@link checkSources}), with the labels of each that passed by their
 * case-folded name. */
async function checkSourcesWithLabels(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    dispatch: ProjectDispatch;
    auth: ProjectAuthContext;
  },
): Promise<Pick<DispatchFacts, 'sourceIssues' | 'sourceLabels'>> {
  const sourceIssues: DispatchIssue[] = [];
  const passed = await checkSources(
    sql,
    args,
    args.dispatch.sources ?? [],
    sourceIssues,
  );
  const labels = await readNamedLabels(sql, {
    organizationId: args.organizationId,
    projectIds: [...passed],
    dispatch: args.dispatch,
  });
  return {
    sourceIssues,
    sourceLabels: new Map(
      [...passed].map((projectId) => [
        projectId,
        labels.get(projectId) ?? new Set<string>(),
      ]),
    ),
  };
}

/** Of the labels a dispatch names, those each of the projects has, by
 * case-folded name. */
async function readNamedLabels(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectIds: readonly string[];
    dispatch: ProjectDispatch;
  },
): Promise<Map<string, Set<string>>> {
  const names = dispatchLabelRefs(args.dispatch).map((ref) =>
    ref.name.toLowerCase(),
  );
  const byProject = new Map<string, Set<string>>();
  if (names.length === 0 || args.projectIds.length === 0) return byProject;
  const rows = await sql<{ projectId: string; name: string }[]>`
    SELECT project_id AS "projectId", lower(name) AS name
    FROM app.task_labels
    WHERE org_id = ${args.organizationId}
      AND project_id = ANY(${[...args.projectIds]})
      AND lower(name) = ANY(${names})
  `;
  for (const row of rows) {
    const set = byProject.get(row.projectId) ?? new Set<string>();
    set.add(row.name);
    byProject.set(row.projectId, set);
  }
  return byProject;
}

/**
 * A dispatch checked for a project a declaration is about to create, before
 * anything is written: it names only what the same declaration creates —
 * the project's agents, its tasks, its labels and the labels every new
 * project starts with — besides the other boards it serves, which exist and
 * the caller may edit (`checkSources`), and only who may administer a new
 * project, an organization's Owner or Admin, may declare one. The save,
 * once the project exists, checks it again against what it then holds.
 */
export async function checkPlannedProjectDispatch(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    dispatch: ProjectDispatch;
    expectedHash?: string | null;
    planned: DispatchPlannedState;
  },
): Promise<
  | { ok: true; changed: boolean; hash: string }
  | { ok: false; issues: DispatchIssue[] }
> {
  if (
    !checkProjectAccess({ teamIds: [] }, auth.teamIds, auth.role).canAdminister
  )
    throw new TaskError(
      'PROJECT_FORBIDDEN',
      'Only who may administer the project changes its dispatch',
      403,
    );
  assertExpectedHash(null, args.expectedHash);
  const sources = await checkSourcesWithLabels(sql, {
    organizationId: auth.organizationId,
    projectId: args.projectId,
    dispatch: args.dispatch,
    auth,
  });
  const issues = judgeDispatch(args.dispatch, {
    agents: new Set(args.planned.agents),
    tools: new Map(),
    tasks: new Map(
      args.planned.tasks.map((id) => [id, { archived: false }] as const),
    ),
    labels: new Set([
      ...PREDEFINED_TASK_LABELS.map((label) => label.name.toLowerCase()),
      ...args.planned.labels.map((name) => name.toLowerCase()),
    ]),
    ...sources,
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

/**
 * The sources a dispatch names, checked for its writer: each is another
 * project of the organization, active, and one the writer may edit — the
 * right a dispatch needs to serve a board, so serving never widens what its
 * writer may do. Pushes an issue for each that fails, and answers the
 * sources that pass.
 */
async function checkSources(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string; auth: ProjectAuthContext },
  sources: readonly ProjectDispatchSource[],
  issues: DispatchIssue[],
): Promise<Set<string>> {
  const passed = new Set<string>();
  if (sources.length === 0) return passed;
  const projects = await sql<
    { id: string; archived: boolean; teamIds: string[] | null }[]
  >`
    SELECT id, archived_at_ms IS NOT NULL AS archived,
           ${sql.unsafe(PROJECT_TEAM_IDS_SQL)} AS "teamIds"
    FROM app.projects
    WHERE org_id = ${args.organizationId}
      AND id = ANY(${sources.map((source) => source.projectId)})
  `;
  const byId = new Map(projects.map((project) => [project.id, project]));
  for (const [index, source] of sources.entries()) {
    const path = `sources.${index}.projectId`;
    const project = byId.get(source.projectId);
    if (source.projectId === args.projectId) {
      issues.push({
        path,
        message:
          'A dispatch serves its own board already; a source names another project.',
      });
    } else if (
      project === undefined ||
      (args.auth.projectScope !== undefined &&
        project.id !== args.auth.projectScope)
    ) {
      issues.push({
        path,
        message: `No project with the id "${source.projectId}" is in this organization.`,
      });
    } else if (project.archived) {
      issues.push({
        path,
        message: 'That project is archived; restore it first.',
      });
    } else if (
      !checkProjectAccess(
        { teamIds: project.teamIds ?? [] },
        args.auth.teamIds,
        args.auth.role,
      ).canEdit
    ) {
      issues.push({
        path,
        message:
          'Serving that project’s board needs the right to edit it, which you do not have.',
      });
    } else {
      passed.add(source.projectId);
    }
  }
  return passed;
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
    auth,
    ...(args.planned !== undefined ? { planned: args.planned } : {}),
  });
  const next = dispatchConfigurationValue(args.projectId, args.dispatch);
  const hash = managedConfigurationHash(next) ?? '';
  // A dispatch serves its other boards on the right of whoever saved it
  // last (`dispatch-reach.ts`): saved again by someone else, it serves them
  // on that person's right from then on, even when the document is the same.
  const reanchored =
    stored !== null &&
    (args.dispatch.sources ?? []).length > 0 &&
    stored.updatedBy !== auth.userId;
  const changed =
    current === null ||
    managedConfigurationHash(current) !== hash ||
    reanchored;
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
        ...(args.dispatch.sources !== undefined
          ? {
              sources: args.dispatch.sources.map((source) => source.projectId),
            }
          : {}),
        ...(args.dispatch.reviewers !== undefined
          ? { reviewers: args.dispatch.reviewers.length }
          : {}),
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
