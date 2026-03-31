import type { MutationCtx } from '../../_generated/server';

import { internal } from '../../_generated/api';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object'
    )
      return undefined;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic nested access
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function matchesFilter(
  eventData: Record<string, unknown> | undefined,
  eventFilter: Record<string, string> | undefined,
): boolean {
  if (!eventFilter) return true;
  if (!eventData) return false;
  for (const [key, value] of Object.entries(eventFilter)) {
    const eventVal = getNestedValue(eventData, key);
    if (
      (typeof eventVal === 'string'
        ? eventVal
        : JSON.stringify(eventVal ?? '')) !== value
    )
      return false;
  }
  return true;
}

function isSelfTrigger(
  eventType: string,
  eventData: Record<string, unknown> | undefined,
  subscriptionWorkflowSlug: string | undefined,
): boolean {
  if (eventType !== 'workflow.completed') return false;
  if (!subscriptionWorkflowSlug) return false;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic data
  const sourceSlug = getNestedValue(
    eventData ?? {},
    'execution.workflowSlug',
  ) as string | undefined;
  if (!sourceSlug) return false;
  return sourceSlug === subscriptionWorkflowSlug;
}

interface ProcessEventArgs {
  organizationId: string;
  eventType: string;
  eventData?: Record<string, unknown>;
}

export async function processEventHandler(
  ctx: MutationCtx,
  args: ProcessEventArgs,
) {
  const subscriptions = ctx.db
    .query('wfEventSubscriptions')
    .withIndex('by_org_eventType', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('eventType', args.eventType),
    );

  const eventData = args.eventData;

  for await (const sub of subscriptions) {
    if (!sub.isActive) continue;
    if (!sub.workflowSlug) continue;

    if (isSelfTrigger(args.eventType, eventData, sub.workflowSlug)) continue;

    if (!matchesFilter(eventData, sub.eventFilter)) continue;

    await ctx.scheduler.runAfter(
      0,
      internal.workflow_engine.helpers.engine.start_workflow_from_file
        .startWorkflowFromFile,
      {
        organizationId: args.organizationId,
        orgSlug: 'default',
        workflowSlug: sub.workflowSlug,
        input: args.eventData ?? {},
        triggeredBy: 'event',
        triggerData: {
          triggerType: 'event',
          eventType: args.eventType,
          subscriptionId: sub._id,
          timestamp: Date.now(),
        },
      },
    );

    await ctx.db.patch(sub._id, { lastTriggeredAt: Date.now() });

    await ctx.runMutation(
      internal.workflows.triggers.internal_mutations.createTriggerLog,
      {
        organizationId: args.organizationId,
        workflowRootId: sub.workflowRootId,
        workflowSlug: sub.workflowSlug,
        triggerType: 'event',
        status: 'accepted',
      },
    );
  }

  return null;
}
