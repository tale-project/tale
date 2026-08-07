/**
 * Promote freeform task label strings into a project-scoped `taskLabels`
 * catalog.
 *
 * `up` walks each project: collects distinct normalized names from every
 * task's legacy `labels` array and from `projects.taskLabelColors`, mints
 * one `taskLabels` row per name (colour from the sidecar, else the shared
 * default palette), rewrites each task to `labelIds` and clears `labels`,
 * then clears the sidecar map. Idempotent — a project whose tasks already
 * carry `labelIds` and no sidecar is a no-op.
 *
 * `down` walks the populated `taskLabels` table (`downTable`): for each
 * catalog row it restores the name onto every referencing task's `labels`
 * array, drops the id from `labelIds`, merges the colour back into
 * `projects.taskLabelColors`, and deletes the catalog row.
 */

import type { GenericId } from 'convex/values';

import { defineDbMigration } from '../../../framework/define';

/** Local copy of `defaultTaskLabelColor` — migrations must not import app lib. */
function defaultTaskLabelColor(name: string): string {
  const predefined: Record<string, string> = {
    bug: 'red',
    feature: 'purple',
    improvement: 'blue',
  };
  if (predefined[name]) return predefined[name];
  const custom = ['orange', 'amber', 'green', 'teal', 'pink', 'gray'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return custom[hash % custom.length] ?? 'gray';
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
  }
  return out.length > 0 ? out : undefined;
}

function colorMap(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, color] of Object.entries(value)) {
    if (typeof color === 'string') out[key] = color;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export const migration = defineDbMigration({
  title: 'Promote task labels to project catalog',
  description:
    'up mints taskLabels rows from distinct tasks.labels strings and ' +
    'projects.taskLabelColors, rewrites tasks.labelIds, clears legacy ' +
    'labels and taskLabelColors; down walks the populated taskLabels table, ' +
    'restores string labels and the colour map from catalog rows, then ' +
    'deletes them.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['tasks', 'projects', 'taskLabels'] },
  table: 'projects',
  downTable: 'taskLabels',

  async up(ctx, doc) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runner paginates `projects`
    const projectId = doc._id as GenericId<'projects'>;
    const organizationId = str(doc.organizationId);
    if (organizationId === undefined) return;

    const sidecar = colorMap(doc.taskLabelColors);
    const names = new Set<string>();
    if (sidecar) {
      for (const name of Object.keys(sidecar)) names.add(name);
    }

    const tasks: Array<{
      _id: GenericId<'tasks'>;
      labels?: string[];
      labelIds?: GenericId<'taskLabels'>[];
    }> = [];
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))) {
      const labels = strArray(task.labels);
      tasks.push({ _id: task._id, labels, labelIds: task.labelIds });
      if (labels) {
        for (const name of labels) names.add(name.trim().toLowerCase());
      }
    }

    // Always seed the built-in trio so every project has a starter catalog
    // after the cutover (matching createProject's ensureDefaultProjectLabels).
    for (const name of ['bug', 'feature', 'improvement']) {
      names.add(name);
    }

    const now = 0; // deterministic for up→down→re-up digest equality
    const idByName = new Map<string, GenericId<'taskLabels'>>();

    // Existing catalog rows (idempotent re-run / partial apply).
    for await (const label of ctx.db
      .query('taskLabels')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))) {
      const name = str(label.name);
      if (name) idByName.set(name, label._id);
    }

    const sortedNames = [...names].sort((a, b) => a.localeCompare(b));

    for (const name of sortedNames) {
      if (name.length === 0 || name.length > 50) continue;
      if (idByName.has(name)) continue;
      const color = sidecar?.[name] ?? defaultTaskLabelColor(name);
      const id = await ctx.db.insert('taskLabels', {
        organizationId,
        projectId,
        name,
        color,
        createdBy: 'migration:task_labels_to_catalog',
        createdAt: now,
        updatedAt: now,
      });
      idByName.set(name, id);
    }

    for (const task of tasks) {
      if (task.labels === undefined) continue;
      const uniqueNames = [
        ...new Set(task.labels.map((raw) => raw.trim().toLowerCase())),
      ].sort((a, b) => a.localeCompare(b));
      const unique = uniqueNames
        .map((name) => idByName.get(name))
        .filter((id): id is GenericId<'taskLabels'> => id !== undefined);
      await ctx.db.patch(task._id, {
        labelIds: unique.length > 0 ? unique : undefined,
        labels: undefined,
      });
    }

    if (sidecar !== undefined) {
      await ctx.db.patch(projectId, { taskLabelColors: undefined });
    }
  },

  async down(ctx, doc) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- down walks taskLabels
    const labelId = doc._id as GenericId<'taskLabels'>;
    const projectId = str(doc.projectId) as GenericId<'projects'> | undefined;
    const name = str(doc.name);
    const color = str(doc.color);
    if (projectId === undefined || name === undefined) {
      await ctx.db.delete(labelId);
      return;
    }

    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_project', (q) => q.eq('projectId', projectId))) {
      const labelIds = task.labelIds;
      if (!labelIds?.includes(labelId)) continue;
      const nextIds = labelIds.filter((id) => id !== labelId);
      const legacy = strArray(task.labels) ?? [];
      if (!legacy.includes(name)) legacy.push(name);
      legacy.sort((a, b) => a.localeCompare(b));
      await ctx.db.patch(task._id, {
        labels: legacy.length > 0 ? legacy : undefined,
        labelIds: nextIds.length > 0 ? nextIds : undefined,
      });
    }

    if (color !== undefined && color !== defaultTaskLabelColor(name)) {
      const project = await ctx.db.get(projectId);
      if (project) {
        const existing = colorMap(project.taskLabelColors) ?? {};
        if (existing[name] !== color) {
          await ctx.db.patch(projectId, {
            taskLabelColors: { ...existing, [name]: color },
          });
        }
      }
    }

    await ctx.db.delete(labelId);
  },
});
