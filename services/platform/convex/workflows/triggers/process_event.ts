import { internal } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';

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

/**
 * Ownership arbitration: a task created by an app (`createdByType === 'app'`,
 * `createdBy` = the app slug) is driven by that app's OWN workflow, so a generic
 * subscription — or another app's — must not also act on it. A subscription is
 * identified by its workflow's owning app slug (`wfInstallations.automationSlug`, null
 * for a global/generic workflow). Non-app tasks are open to every subscription.
 * Pure (no ctx) so it is unit-tested directly.
 */
export function isSubscriptionAllowedForTask(
  taskCreatedByType: unknown,
  taskCreatedBy: unknown,
  subscriptionAppSlug: string | null | undefined,
): boolean {
  if (taskCreatedByType !== 'app') return true;
  return subscriptionAppSlug === taskCreatedBy;
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

  let cachedOrgSlug: string | null = null;

  for await (const sub of subscriptions) {
    if (!sub.isActive) continue;
    const workflowSlug = sub.workflowSlug;
    if (!workflowSlug) continue;

    if (isSelfTrigger(args.eventType, eventData, workflowSlug)) continue;

    if (!matchesFilter(eventData, sub.eventFilter)) continue;

    const installation = await ctx.db
      .query('wfInstallations')
      .withIndex('by_org_slug', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('workflowSlug', workflowSlug),
      )
      .first();
    if (!installation) continue;

    // Ownership arbitration: skip this subscription if the event's task is owned
    // by a different app (or by an app while this is a generic workflow).
    if (
      !isSubscriptionAllowedForTask(
        getNestedValue(eventData ?? {}, 'task.createdByType'),
        getNestedValue(eventData ?? {}, 'task.createdBy'),
        installation.automationSlug,
      )
    ) {
      continue;
    }

    if (cachedOrgSlug === null) {
      cachedOrgSlug = await resolveOrgSlug(ctx, args.organizationId);
    }

    await ctx.scheduler.runAfter(
      0,
      internal.workflow_engine.helpers.engine.start_workflow_from_file
        .startWorkflowFromFile,
      {
        organizationId: args.organizationId,
        orgSlug: cachedOrgSlug,
        workflowSlug,
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
        workflowSlug,
        triggerType: 'event',
        status: 'accepted',
      },
    );
  }

  return null;
}
