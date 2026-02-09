import type { MutationCtx } from '../../_generated/server';

import { internal } from '../../_generated/api';
import { getActiveWorkflowVersion } from './queries';

function matchesFilter(
  eventData: Record<string, unknown> | undefined,
  eventFilter: Record<string, string> | undefined,
): boolean {
  if (!eventFilter) return true;
  if (!eventData) return false;
  for (const [key, value] of Object.entries(eventFilter)) {
    if (String(eventData[key] ?? '') !== value) return false;
  }
  return true;
}

function isSelfTrigger(
  eventType: string,
  eventData: Record<string, unknown> | undefined,
  subscriptionWorkflowRootId: string,
): boolean {
  if (eventType !== 'workflow.completed' && eventType !== 'workflow.failed')
    return false;
  const sourceRoot = eventData?.rootWfDefinitionId as string | undefined;
  return !!sourceRoot && sourceRoot === subscriptionWorkflowRootId;
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

  const eventData = args.eventData as Record<string, unknown> | undefined;

  for await (const sub of subscriptions) {
    if (!sub.isActive) continue;

    if (isSelfTrigger(args.eventType, eventData, sub.workflowRootId)) continue;

    if (!matchesFilter(eventData, sub.eventFilter)) continue;

    const activeVersion = await getActiveWorkflowVersion(
      ctx,
      sub.workflowRootId,
    );
    if (!activeVersion) continue;

    await ctx.scheduler.runAfter(
      0,
      internal.workflow_engine.internal_mutations.startWorkflow,
      {
        organizationId: args.organizationId,
        wfDefinitionId: activeVersion._id,
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
        wfDefinitionId: activeVersion._id,
        triggerType: 'event',
        status: 'accepted',
      },
    );
  }

  return null;
}
