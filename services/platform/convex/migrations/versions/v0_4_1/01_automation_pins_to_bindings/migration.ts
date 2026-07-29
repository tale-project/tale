/**
 * Move automation project pins into binding rows.
 *
 * The automation store's single-pin model (`automations.projectId`, stamped
 * on every version row and immutable for the name's lifetime) was replaced by
 * the `automationProjectBindings` junction: one row per (org, name, project),
 * zero-or-many per automation, managed explicitly. `up` re-expresses every
 * pin in the new table — one binding per pinned NAME, deduped across its
 * version rows — and clears the deprecated scalar. `down` walks the populated
 * bindings table (`downTable`), restores each binding as the scalar pin on
 * every version row of its name, and deletes the binding row; a name bound to
 * several projects post-migration degrades to whichever binding the walk
 * restores last — the single-pin world cannot represent more than one.
 *
 * `snapshot: 'none'` is sufficient: `up` destroys nothing (the pin's value
 * moves into the binding row it creates), and `down` rebuilds the scalar from
 * exactly those rows.
 */

import type { GenericId } from 'convex/values';

import { defineDbMigration } from '../../../framework/define';

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export const migration = defineDbMigration({
  title: 'Move automation project pins into binding rows',
  description:
    'up inserts one automationProjectBindings row per pinned automation ' +
    'name and clears the deprecated automations.projectId scalar on every ' +
    'version row; down walks the populated bindings table, restores the ' +
    'scalar pin onto every version row of each bound name, and deletes the ' +
    'binding rows.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['automations', 'automationProjectBindings'] },
  table: 'automations',
  // `up` moves the pin DATA into automationProjectBindings, so `down` must
  // walk that (populated) table — the scalar column is empty after `up`.
  downTable: 'automationProjectBindings',

  async up(ctx, doc) {
    const projectId = str(doc.projectId);
    if (projectId === undefined) return;
    const organizationId = str(doc.organizationId);
    const name = str(doc.name);
    if (organizationId === undefined || name === undefined) return;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the pin held a projects id; the string survives the move verbatim
    const boundProject = projectId as GenericId<'projects'>;
    const existing = await ctx.db
      .query('automationProjectBindings')
      .withIndex('by_org_name_project', (q) =>
        q
          .eq('organizationId', organizationId)
          .eq('automationName', name)
          .eq('projectId', boundProject),
      )
      .unique();
    if (existing === null) {
      await ctx.db.insert('automationProjectBindings', {
        organizationId,
        automationName: name,
        projectId: boundProject,
        // The carrying version row's timestamp, NOT Date.now(): the binding
        // is as old as the pin it re-expresses, and a deterministic value is
        // what lets the chain's up→down→re-up convergence hold digest-equal.
        boundAt: num(doc.createdAt) ?? 0,
        boundBy: 'migration:automation_pins_to_bindings',
      });
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runner paginates `table`, so the doc is an automations row
    await ctx.db.patch(doc._id as GenericId<'automations'>, {
      projectId: undefined,
    });
  },

  async down(ctx, doc) {
    const organizationId = str(doc.organizationId);
    const name = str(doc.automationName);
    const projectId = str(doc.projectId);
    if (
      organizationId === undefined ||
      name === undefined ||
      projectId === undefined
    ) {
      return;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the binding held a projects id; the string returns to the pin verbatim
    const boundProject = projectId as GenericId<'projects'>;
    const rows = await ctx.db
      .query('automations')
      .withIndex('by_org_name', (q) =>
        q.eq('organizationId', organizationId).eq('name', name),
      )
      .collect();
    for (const row of rows) {
      if (row.projectId === boundProject) continue;
      await ctx.db.patch(row._id, { projectId: boundProject });
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the runner paginates `downTable`, so the doc is a binding row
    await ctx.db.delete(doc._id as GenericId<'automationProjectBindings'>);
  },
});
