import { vWorkflowId } from '@convex-dev/workflow';
import { v } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import { workflowManagers } from './engine';
import * as EngineHelpers from './helpers/engine';
import { getShardIndex, safeShardIndex } from './helpers/engine/shard';
import { handleStartWorkflow } from './helpers/engine/start_workflow_handler';

export const onWorkflowComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    context: jsonValueValidator,
    result: jsonValueValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await EngineHelpers.handleWorkflowComplete(ctx, args);
    return null;
  },
});

export const cleanupComponentWorkflow = internalMutation({
  args: {
    workflowId: vWorkflowId,
    shardIndex: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const manager = workflowManagers[safeShardIndex(args.shardIndex)];
    await EngineHelpers.cleanupComponentWorkflow(manager, ctx, args.workflowId);
    return null;
  },
});

export const startWorkflow = internalMutation({
  args: {
    organizationId: v.string(),
    wfDefinitionId: v.id('wfDefinitions'),
    input: v.optional(jsonValueValidator),
    triggeredBy: v.string(),
    triggerData: v.optional(jsonValueValidator),
  },
  returns: v.id('wfExecutions'),
  handler: async (ctx, args) => {
    const shardIndex = getShardIndex(args.wfDefinitionId);
    return await handleStartWorkflow(
      ctx,
      args,
      workflowManagers[shardIndex],
      shardIndex,
    );
  },
});
