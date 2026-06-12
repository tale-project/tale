/**
 * Convex Tool: Organigram Read
 *
 * Read-only view of the agents-only delegation chart (many-to-many):
 *  - 'get_chart': every agent with the agents it delegates to + who delegates
 *    to it.
 *
 * The write half lives in `organigram_write_tool` (mirrors the
 * `task_read` / `task_write` split) so read-only agents can see the chart
 * without being able to rewire it.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';
import { readCtxString } from './context';

const organigramReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get_chart'),
  }),
]);

export const organigramReadTool: ToolDefinition = {
  name: 'organigram_read',
  tool: createTool({
    description:
      'Read the agents-only delegation chart (many-to-many). get_chart returns every agent with the agents it delegates to and the agents that delegate to it. Delegation is functional: an agent can hand work to exactly the agents it delegates to, and those agents escalate back to it.',
    inputSchema: organigramReadArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = readCtxString(ctx, 'organizationId');
      if (!organizationId) {
        return { error: 'MISSING_CONTEXT' };
      }

      switch (args.operation) {
        case 'get_chart': {
          return await ctx.runAction(
            internal.agents.workforce_ops.getChartOverview,
            { organizationId },
          );
        }
        default: {
          const unhandled: never = args.operation;
          return {
            error: `Unsupported operation: ${JSON.stringify(unhandled)}`,
          };
        }
      }
    },
  }),
};
