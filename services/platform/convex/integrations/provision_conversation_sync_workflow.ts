/**
 * Provision and publish a Conversation Sync workflow for an integration.
 *
 * Automatically creates a sync workflow when an integration with messaging
 * capabilities (canSync + list_messages) is connected. Follows the same
 * pattern as website scan workflow provisioning.
 */

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import conversationSyncWorkflow from '../predefined_workflows/conversation_sync';
import { toPredefinedWorkflowPayload } from '../workflows/definitions/types';

export interface ProvisionConversationSyncWorkflowArgs {
  organizationId: string;
  integrationId: Id<'integrations'>;
  integrationName: string;
  integrationTitle: string;
  channel: string;
  hasGetThread: boolean;
  syncFrequency: string;
  accountEmail?: string;
}

const MESSAGE_OPERATIONS = new Set([
  'list_messages',
  'list_emails',
  'sync_messages',
]);

/**
 * Check if an integration's connector operations include message listing.
 * Returns true if the connector has any recognized message listing operation.
 */
export function hasMessageListOperation(
  operations?: Array<{ name: string }>,
): boolean {
  if (!operations || operations.length === 0) return false;
  return operations.some((op) => MESSAGE_OPERATIONS.has(op.name));
}

/**
 * Check if an integration's connector operations include thread fetching.
 */
export function hasThreadOperation(
  operations?: Array<{ name: string }>,
): boolean {
  if (!operations || operations.length === 0) return false;
  return operations.some(
    (op) => op.name === 'get_thread' || op.name === 'get_conversation',
  );
}

/**
 * Infer the conversation channel from the integration name.
 * Falls back to 'email' for unrecognized integrations.
 */
export function inferChannel(integrationName: string): string {
  const name = integrationName.toLowerCase();
  if (name.includes('whatsapp')) return 'whatsapp';
  if (name.includes('sms') || name.includes('twilio')) return 'sms';
  if (
    name.includes('messenger') ||
    name.includes('facebook') ||
    name.includes('meta')
  )
    return 'messenger';
  if (name.includes('instagram')) return 'instagram';
  if (name.includes('slack')) return 'slack';
  if (name.includes('telegram')) return 'telegram';
  return 'email';
}

function syncFrequencyToCron(frequency: string): {
  schedule: string;
  timezone: string;
} {
  const timezone = 'UTC';
  switch (frequency) {
    case '1m':
      return { schedule: '* * * * *', timezone };
    case '5m':
      return { schedule: '*/5 * * * *', timezone };
    case '15m':
      return { schedule: '*/15 * * * *', timezone };
    case '30m':
      return { schedule: '*/30 * * * *', timezone };
    case '1h':
      return { schedule: '0 * * * *', timezone };
    case '6h':
      return { schedule: '0 */6 * * *', timezone };
    case '12h':
      return { schedule: '0 */12 * * *', timezone };
    case '1d':
      return { schedule: '0 2 * * *', timezone };
    default:
      return { schedule: '*/5 * * * *', timezone }; // Default: every 5 minutes
  }
}

export async function provisionConversationSyncWorkflow(
  ctx: ActionCtx,
  args: ProvisionConversationSyncWorkflowArgs,
): Promise<void> {
  const { schedule, timezone } = syncFrequencyToCron(args.syncFrequency);

  const rawVars = conversationSyncWorkflow.workflowConfig.config?.variables;
  const templateVars = isRecord(rawVars) ? rawVars : {};

  const variables = toConvexJsonRecord({
    ...templateVars,
    organizationId: args.organizationId,
    integrationName: args.integrationName,
    channel: args.channel,
    hasGetThread: args.hasGetThread,
    accountEmail: args.accountEmail ?? '',
  });

  const workflowName = `Conversation Sync - ${args.integrationTitle}`;

  const payload = toPredefinedWorkflowPayload(
    conversationSyncWorkflow,
    {
      name: workflowName,
      config: {
        ...conversationSyncWorkflow.workflowConfig.config,
        variables,
      },
    },
    (step) =>
      step.stepType === 'start' || step.stepType === 'trigger'
        ? {
            ...step,
            config: {
              ...(isRecord(step.config) ? step.config : {}),
              type: 'scheduled',
              schedule,
              timezone,
            },
          }
        : step,
  );

  const saved = await ctx.runMutation(
    internal.wf_definitions.internal_mutations.provisionWorkflowWithSteps,
    {
      organizationId: args.organizationId,
      ...payload,
    },
  );

  // Publish immediately so the workflow starts running
  await ctx.runMutation(
    internal.wf_definitions.internal_mutations.provisionPublishDraft,
    {
      wfDefinitionId: saved.workflowId,
      publishedBy: 'system',
      changeLog: `Auto-created conversation sync for ${args.integrationName}`,
    },
  );

  // Register the schedule so the cron scanner picks up this workflow
  await ctx.runMutation(
    internal.workflows.triggers.internal_mutations.provisionSchedule,
    {
      organizationId: args.organizationId,
      workflowRootId: saved.workflowId,
      cronExpression: schedule,
      timezone,
      createdBy: 'system',
    },
  );

  // Store workflow ID in integration metadata
  const integration = await ctx.runQuery(
    internal.integrations.internal_queries.getInternal,
    {
      integrationId: args.integrationId,
    },
  );
  const existingMeta = isRecord(integration?.metadata)
    ? integration.metadata
    : {};

  await ctx.runMutation(
    internal.integrations.internal_mutations.updateIntegration,
    {
      integrationId: args.integrationId,
      metadata: {
        ...existingMeta,
        conversationSyncWorkflowId: saved.workflowId,
      },
    },
  );

  // Trigger an initial sync immediately
  await ctx.scheduler.runAfter(
    0,
    internal.workflow_engine.internal_mutations.startWorkflow,
    {
      organizationId: args.organizationId,
      wfDefinitionId: saved.workflowId,
      input: { integrationName: args.integrationName },
      triggeredBy: 'system',
      triggerData: {
        triggerType: 'system',
        reason: 'initial_conversation_sync',
        timestamp: Date.now(),
      },
    },
  );
}
