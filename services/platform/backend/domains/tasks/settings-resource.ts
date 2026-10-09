import { transactSerializable } from '@tale/shared/db/serializable';
import { managedTaskInstructionsSchema } from '@tale/shared/schemas/managed-configuration';
import { configurationHash } from '@tale/shared/utils/configuration-hash';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
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
import {
  assertTaskNotArchived,
  assertTaskWorkable,
  loadTaskOrThrow,
  readTaskInstructionsConfiguration,
  updateTaskInstructionsConfiguration,
} from './service.ts';

/**
 * A task's description as a settings kind over MCP (`task-instructions`):
 * read and changed through the writer a declaration applied by the CLI
 * goes through, behind the task's own rules — changing takes someone who
 * may work on the task, which is not archived, and a person it mentions
 * must be someone who can be mentioned on it. A project holds many tasks,
 * so a read names the tasks it wants.
 */

const ID_FORM = '<projectId>/<taskId>';

function taskIdOf(change: SettingsChange): string {
  const config =
    change.op === 'set' && isRecord(change.config) ? change.config : null;
  const carried =
    typeof config?.projectId === 'string' && typeof config.taskId === 'string'
      ? `${config.projectId}/${config.taskId}`
      : undefined;
  return identityOf('task-instructions', change.id, carried, ID_FORM);
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
  identify: (change) => taskIdOf(change),
  list: async (ctx, query) => {
    if (query.ids === undefined) {
      throw new SettingsRefusalError(
        'SETTINGS_IDS_REQUIRED',
        'task-instructions reads the tasks a call names, not every task',
        {
          hint: `name each task in ids as ${ID_FORM}, from its link in Tale`,
        },
      );
    }
    const items: SettingsResource[] = [];
    for (const id of query.ids) items.push(await readTask(ctx, id));
    return { items, nextCursor: null };
  },
  read: async (ctx, id) => (id === null ? null : readTask(ctx, id)),
  plan: async (ctx, change, current) => {
    const id = taskIdOf(change);
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
    const id = taskIdOf(change);
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
