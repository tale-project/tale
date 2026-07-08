/**
 * DB migration: add the `task.status_changed` (backlog -> todo) subscription
 * for `projects/tasks/triage-unassigned-tasks` in every org that already
 * carries its `task.created` subscription. See {@link meta}.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

const WORKFLOW_SLUG = 'projects/tasks/triage-unassigned-tasks';
const NEW_EVENT_TYPE = 'task.status_changed';
const NEW_EVENT_FILTER = { fromStatus: 'backlog', toStatus: 'todo' } as const;

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function findSibling(
  ctx: MutationCtx,
  organizationId: string,
): Promise<Id<'wfEventSubscriptions'> | null> {
  for await (const sub of ctx.db
    .query('wfEventSubscriptions')
    .withIndex('by_org_eventType', (q) =>
      q.eq('organizationId', organizationId).eq('eventType', NEW_EVENT_TYPE),
    )) {
    if (sub.workflowSlug === WORKFLOW_SLUG) return sub._id;
  }
  return null;
}

export const migration: DbMigration = {
  meta,
  table: 'wfEventSubscriptions',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    if (
      doc.workflowSlug !== WORKFLOW_SLUG ||
      doc.eventType !== 'task.created'
    ) {
      return;
    }
    const organizationId = str(doc.organizationId);
    if (!organizationId) return;

    if (await findSibling(ctx, organizationId)) return; // already added (or operator-added)

    await ctx.db.insert('wfEventSubscriptions', {
      organizationId,
      workflowSlug: WORKFLOW_SLUG,
      eventType: NEW_EVENT_TYPE,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex needs a mutable record, NEW_EVENT_FILTER is readonly
      eventFilter: { ...NEW_EVENT_FILTER },
      isActive: true,
      createdAt: Date.now(),
      createdBy: 'system',
    });
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    if (
      doc.workflowSlug !== WORKFLOW_SLUG ||
      doc.eventType !== 'task.created'
    ) {
      return;
    }
    const organizationId = str(doc.organizationId);
    if (!organizationId) return;

    for await (const sub of ctx.db
      .query('wfEventSubscriptions')
      .withIndex('by_org_eventType', (q) =>
        q.eq('organizationId', organizationId).eq('eventType', NEW_EVENT_TYPE),
      )) {
      if (sub.workflowSlug !== WORKFLOW_SLUG) continue;
      // Only remove a row this migration (or the provisioner) created —
      // never an operator's own identically-filtered subscription.
      if (sub.createdBy !== 'system') continue;
      await ctx.db.delete(sub._id);
    }
  },
};
