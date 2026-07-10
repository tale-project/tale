/**
 * DB migration: add the `task.status_changed` (backlog -> todo) subscription
 * for `projects/tasks/triage-unassigned-tasks` in every org that already
 * carries its `task.created` subscription.
 *
 * The workflow file gained a second declared trigger so a human's Backlog
 * "Start" (the board's status-change action) routes a synced proposal (e.g.
 * from the resolve-github-issues bundle's triage-github-issues) through
 * scoring and assignment, the same as a task created directly at To do.
 * Trigger rows are create-if-absent only (`provision_defaults_mutations.ts`),
 * so an org already provisioned from the OLD file (one `task.created`
 * subscription) never picks up the new one on its own — this migration adds
 * it directly. Purely additive (never touches the existing `task.created`
 * subscription or any org customization of it), so `destructive: false` and
 * `snapshot: 'none'`: `down` deletes exactly the row `up` added, identified
 * the same way `up` found where to add it.
 */

import type { Id } from '../../../../_generated/dataModel';
import type { MutationCtx } from '../../../../_generated/server';
import { defineDbMigration } from '../../../framework/define';

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

export const migration = defineDbMigration({
  title: "Subscribe triage-unassigned-tasks to a Backlog->To do 'Start' too",
  description:
    'For every org with a `task.created` event subscription on ' +
    '`projects/tasks/triage-unassigned-tasks`, adds a sibling ' +
    '`task.status_changed` subscription (eventFilter fromStatus:"backlog", ' +
    'toStatus:"todo"), create-if-absent. Lets a human Backlog "Start" route a ' +
    'synced proposal task through scoring and assignment, matching a task ' +
    'created directly at To do. down removes exactly the subscription this ' +
    'migration added per org.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.92/02_triage_backlog_start_trigger'],
  subjects: { tables: ['wfEventSubscriptions'] },
  table: 'wfEventSubscriptions',

  async up(ctx, doc) {
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

  async down(ctx, doc) {
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
});
