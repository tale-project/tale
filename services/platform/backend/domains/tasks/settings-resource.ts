import { transactSerializable } from '@tale/shared/db/serializable';
import {
  managedTaskInstructionsSchema,
  managedTaskReviewContextSchema,
} from '@tale/shared/schemas/managed-configuration';
import { configurationHash } from '@tale/shared/utils/configuration-hash';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { checkProjectAccess } from '../../core/projects/access.ts';
import {
  identityOf,
  parseSettingsConfig,
  SettingsRefusalError,
} from '../mcp/settings/kit.ts';
import type {
  SettingsChange,
  SettingsContext,
  SettingsKindHandler,
  SettingsResource,
} from '../mcp/settings/registry.ts';
import { loadProjectOrThrow } from '../projects/service.ts';
import {
  idParts,
  managedResource,
  projectAuthOf,
} from '../projects/settings-resource.ts';
import { TaskError } from './errors.ts';
import {
  readTaskReviewContextConfiguration,
  updateTaskReviewContextConfiguration,
} from './review-context.ts';
import {
  assertTaskNotArchived,
  assertTaskWorkable,
  loadTaskOrThrow,
  readTaskInstructionsConfiguration,
  updateTaskInstructionsConfiguration,
} from './service.ts';

/**
 * A task's description and its independent review context as settings
 * kinds over MCP (`task-instructions`, `task-review-context`): read and
 * changed through the writers a declaration applied by the CLI goes
 * through, behind the task's own rules. Changing a description takes
 * someone who may work on the task, which is not archived, and a person it
 * mentions must be someone who can be mentioned on it; changing a review
 * context takes the project's editor role. A project holds many tasks, so
 * a read names the tasks it wants.
 */

const ID_FORM = '<projectId>/<taskId>';

type TaskKind = 'task-instructions' | 'task-review-context';

function taskIdOf(kind: TaskKind, change: SettingsChange): string {
  const config =
    change.op === 'set' && isRecord(change.config) ? change.config : null;
  const carried =
    typeof config?.projectId === 'string' && typeof config.taskId === 'string'
      ? `${config.projectId}/${config.taskId}`
      : undefined;
  return identityOf(kind, change.id, carried, ID_FORM);
}

/** A read of the tasks a call names: there is no listing of every task. */
async function readNamed(
  kind: TaskKind,
  ids: readonly string[] | undefined,
  read: (id: string) => Promise<SettingsResource>,
): Promise<{ items: SettingsResource[]; nextCursor: null }> {
  if (ids === undefined) {
    throw new SettingsRefusalError(
      'SETTINGS_IDS_REQUIRED',
      `${kind} reads the tasks a call names, not every task`,
      {
        hint: `name each task in ids as ${ID_FORM}, from its link in Tale`,
      },
    );
  }
  const items: SettingsResource[] = [];
  for (const id of ids) items.push(await read(id));
  return { items, nextCursor: null };
}

async function readTask(
  ctx: SettingsContext,
  id: string,
): Promise<SettingsResource> {
  const [projectId = '', taskId = ''] = idParts(
    'task-instructions',
    id,
    2,
    ID_FORM,
  );
  return managedResource(
    id,
    await readTaskInstructionsConfiguration(
      ctx.sql,
      await projectAuthOf(ctx),
      projectId,
      taskId,
    ),
  );
}

export const taskInstructionsSettings: SettingsKindHandler = {
  kind: 'task-instructions',
  access: async ({ caller }) => {
    // Whoever reads a project may work on its tasks; each task's own
    // rules decide.
    const allowed = defineAbilityFor(caller.role).can('read', 'projects');
    return { read: allowed, write: allowed };
  },
  identify: (change) => taskIdOf('task-instructions', change),
  list: (ctx, query) =>
    readNamed('task-instructions', query.ids, (id) => readTask(ctx, id)),
  read: async (ctx, id) => (id === null ? null : readTask(ctx, id)),
  plan: async (ctx, change, current) => {
    const id = taskIdOf('task-instructions', change);
    const after = parseSettingsConfig(
      managedTaskInstructionsSchema,
      change.config,
      "the task's description",
    );
    const [projectId = '', taskId = ''] = idParts(
      'task-instructions',
      id,
      2,
      ID_FORM,
    );
    const auth = await projectAuthOf(ctx);
    const task = await loadTaskOrThrow(ctx.sql, taskId, auth.organizationId);
    const project = await loadProjectOrThrow(ctx.sql, projectId);
    await assertTaskWorkable(ctx.sql, project, task, auth);
    assertTaskNotArchived(task);
    return {
      after,
      unchanged:
        current !== null &&
        configurationHash(after) === configurationHash(current.config),
    };
  },
  apply: async (ctx, change, expectedHash) => {
    const id = taskIdOf('task-instructions', change);
    // The task exists while it does, so the change names the hash it read;
    // the plan answered it as stale otherwise.
    if (expectedHash === null) {
      throw new SettingsRefusalError(
        'SETTINGS_STALE',
        `task-instructions/${id} exists, so a change names the hash it read`,
        { hint: 'read it with get_settings and apply with its hash' },
      );
    }
    const auth = await projectAuthOf(ctx);
    const config = managedTaskInstructionsSchema.parse(change.config);
    await transactSerializable(ctx.sql, (tx) =>
      updateTaskInstructionsConfiguration(tx, auth, config, expectedHash),
    );
    return { hash: (await readTask(ctx, id)).hash };
  },
};

async function readReviewContext(
  ctx: SettingsContext,
  id: string,
): Promise<SettingsResource> {
  const [projectId = '', taskId = ''] = idParts(
    'task-review-context',
    id,
    2,
    ID_FORM,
  );
  // A task without a review context reads as `null`, with the revision a
  // change that adds one names.
  return managedResource(
    id,
    await readTaskReviewContextConfiguration(
      ctx.sql,
      await projectAuthOf(ctx),
      projectId,
      taskId,
    ),
  );
}

export const taskReviewContextSettings: SettingsKindHandler = {
  kind: 'task-review-context',
  access: async ({ caller }) => {
    // Whoever reads a project may read its tasks; the project's own rules
    // decide who changes a review context.
    const allowed = defineAbilityFor(caller.role).can('read', 'projects');
    return { read: allowed, write: allowed };
  },
  identify: (change) => taskIdOf('task-review-context', change),
  list: (ctx, query) =>
    readNamed('task-review-context', query.ids, (id) =>
      readReviewContext(ctx, id),
    ),
  read: async (ctx, id) => (id === null ? null : readReviewContext(ctx, id)),
  plan: async (ctx, change, current) => {
    const id = taskIdOf('task-review-context', change);
    const after = parseSettingsConfig(
      managedTaskReviewContextSchema,
      change.config,
      "the task's review context",
    );
    const [projectId = '', taskId = ''] = idParts(
      'task-review-context',
      id,
      2,
      ID_FORM,
    );
    // The writer's own rules, before anything is applied: the task is in
    // the project, and the caller holds the project's editor role.
    const auth = await projectAuthOf(ctx);
    await readTaskReviewContextConfiguration(ctx.sql, auth, projectId, taskId);
    const project = await loadProjectOrThrow(ctx.sql, projectId);
    if (!checkProjectAccess(project, auth.teamIds, auth.role).canEdit) {
      throw new TaskError('RBAC_FORBIDDEN', 'Editor role required', 403);
    }
    return {
      after,
      unchanged:
        current !== null &&
        configurationHash(after) === configurationHash(current.config),
    };
  },
  apply: async (ctx, change, expectedHash) => {
    const id = taskIdOf('task-review-context', change);
    // The task exists while it does, so the change names the hash it read
    // (a task without a review context has one too); the plan answered it
    // as stale otherwise. A task the context is for is never created here.
    if (expectedHash === null) {
      throw new SettingsRefusalError(
        'SETTINGS_STALE',
        `task-review-context/${id} exists, so a change names the hash it read`,
        { hint: 'read it with get_settings and apply with its hash' },
      );
    }
    const auth = await projectAuthOf(ctx);
    const config = managedTaskReviewContextSchema.parse(change.config);
    await transactSerializable(ctx.sql, (tx) =>
      updateTaskReviewContextConfiguration(tx, auth, config, expectedHash),
    );
    return { hash: (await readReviewContext(ctx, id)).hash };
  },
};
