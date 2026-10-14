import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import type { Sql, TransactionSql } from 'postgres';

import { scheduleOfTrigger } from '../../../lib/automations/schedule/occurrences.ts';
import { assertExpectedHash } from '../../core/lib/config_store/precondition.ts';
import { managedConfigurationHash } from '../../core/lib/config_store/value_hash.ts';
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
  readStoredDispatch,
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
 * hash, both null when the project has none. */
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
  const stored = await readStoredDispatch(sql, auth.organizationId, projectId);
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
  'The dispatch names an agent, a task or a schedule this project cannot use; the issues say which.';

/** One refusal of a dispatch document, by the field it concerns. */
export interface DispatchIssue {
  path: string;
  message: string;
}

/**
 * What a dispatch names that the database must confirm: every agent of the
 * pool and of a standing role is an agent of this project, every standing
 * role's task is an open task of this project, and every cron expression
 * reads in its zone. Empty when the document is sound.
 */
export async function checkProjectDispatch(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    projectId: string;
    dispatch: ProjectDispatch;
  },
): Promise<DispatchIssue[]> {
  const issues: DispatchIssue[] = [];
  const agents = await sql<{ id: string }[]>`
    SELECT id FROM app.project_agents
    WHERE project_id = ${args.projectId} AND org_id = ${args.organizationId}
  `;
  const known = new Set(agents.map((agent) => agent.id));
  for (const [index, agentId] of args.dispatch.agents.entries()) {
    if (!known.has(agentId)) {
      issues.push({
        path: `agents.${index}`,
        message: `No agent with the id "${agentId}" works in this project.`,
      });
    }
  }
  const roles = args.dispatch.standingRoles ?? [];
  const taskIds = [...new Set(roles.map((role) => role.taskId))];
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
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  for (const [index, role] of roles.entries()) {
    if (!known.has(role.agentId)) {
      issues.push({
        path: `standingRoles.${index}.agentId`,
        message: `No agent with the id "${role.agentId}" works in this project.`,
      });
    }
    const task = taskById.get(role.taskId);
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
  const labelRefs = [
    ...(args.dispatch.labels?.include ?? []).map((name, index) => ({
      name,
      path: `labels.include.${index}`,
    })),
    ...(args.dispatch.labels?.exclude ?? []).map((name, index) => ({
      name,
      path: `labels.exclude.${index}`,
    })),
    ...(args.dispatch.gates ?? []).flatMap((gate, gateIndex) =>
      (gate.labels ?? []).map((name, index) => ({
        name,
        path: `gates.${gateIndex}.labels.${index}`,
      })),
    ),
  ];
  if (labelRefs.length > 0) {
    const labels = await sql<{ name: string }[]>`
      SELECT lower(name) AS name FROM app.task_labels
      WHERE org_id = ${args.organizationId} AND project_id = ${args.projectId}
        AND lower(name) = ANY(${labelRefs.map((ref) => ref.name.toLowerCase())})
    `;
    const knownLabels = new Set(labels.map((label) => label.name));
    for (const ref of labelRefs) {
      if (!knownLabels.has(ref.name.toLowerCase())) {
        issues.push({
          path: ref.path,
          message: `No label named "${ref.name}" is in this project.`,
        });
      }
    }
  }
  return issues;
}

/**
 * Write a project's dispatch, in the caller's serializable transaction:
 * the caller may administer the project, the project is active, the
 * document the caller reviewed is still the stored one (`expectedHash`,
 * null for none), and everything it names checks out. Writing the stored
 * document again changes nothing. A change is audited and asks for a pass
 * at once, so switching dispatch on or widening its pool takes effect
 * without waiting for the next minute.
 */
export async function saveProjectDispatch(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    dispatch: ProjectDispatch;
    /** The hash of the document the caller reviewed; undefined skips the
     * comparison (the app's own form, which always saves what it read). */
    expectedHash?: string | null;
  },
): Promise<{ changed: boolean; hash: string }> {
  const project = await loadProjectOrThrow(tx, args.projectId);
  assertProjectAdministrable(project, auth);
  assertProjectActive(project);
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended('project-dispatch:' || ${args.projectId}, 0))
  `;
  const stored = await readStoredDispatch(
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
  });
  if (issues.length > 0) {
    throw new TaskError('DISPATCH_INVALID', DISPATCH_INVALID_SENTENCE, 400, {
      issues,
    });
  }
  const next = dispatchConfigurationValue(args.projectId, args.dispatch);
  const hash = managedConfigurationHash(next) ?? '';
  if (current !== null && managedConfigurationHash(current) === hash) {
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
