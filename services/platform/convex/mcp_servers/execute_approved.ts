'use node';

/**
 * Execute an approved MCP tool call.
 *
 * Re-executes an MCP tool call after the user has approved it,
 * using metadata stored on the approval record.
 */

import { v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';
import { toId } from '../lib/type_cast_helpers';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';

export const executeApprovedMcpToolCall = internalAction({
  args: {
    approvalId: v.id('approvals'),
    approvedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.runQuery(
      internal.approvals.internal_queries.getApprovalById,
      { approvalId: args.approvalId },
    );

    if (!approval) {
      throw new Error('Approval not found');
    }

    if (approval.resourceType !== 'mcp_tool_call') {
      throw new Error('Approval is not an MCP tool call');
    }

    const metadata = approval.metadata;
    if (!isRecord(metadata)) {
      throw new Error('Approval metadata is missing');
    }

    const serverId =
      typeof metadata.serverId === 'string' ? metadata.serverId : undefined;
    const toolName =
      typeof metadata.toolName === 'string' ? metadata.toolName : undefined;
    const parameters = isRecord(metadata.parameters) ? metadata.parameters : {};

    if (!serverId || !toolName) {
      throw new Error('Missing serverId or toolName in approval metadata');
    }

    try {
      const result = await ctx.runAction(
        internal.mcp_servers.actions.executeMcpTool,
        {
          serverId: toId<'mcpServers'>(serverId),
          toolName,
          toolArgs: toConvexJsonRecord(parameters),
        },
      );

      // Mark approval as completed
      await ctx.runMutation(
        internal.approvals.internal_mutations.createApproval,
        {
          organizationId: approval.organizationId,
          resourceType: 'mcp_tool_call',
          resourceId: approval.resourceId,
          priority: 'medium',
          metadata: toConvexJsonRecord({
            ...(isRecord(metadata) ? metadata : {}),
            executedAt: Date.now(),
            executionResult: result,
          }),
        },
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      throw new Error(
        `Approved MCP tool execution failed: ${toolName}\nError: ${errorMessage}`,
        { cause: error },
      );
    }
  },
});
