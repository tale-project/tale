/**
 * Convex Tool: Organigram Write
 *
 * Edit the agents-only delegation chart (many-to-many):
 *  - 'set_delegates': set the full list of agents one agent delegates to.
 *
 * Writes go through the SAME validated single write path as the canvas
 * (`workforce_ops.writeAgentDelegates`, including the pre-write history
 * snapshot): reserved/unknown agents and self-edges are refused server-side
 * (cycles are allowed), and every change is audited with the chat user as
 * the actor. The chart is functionally load-bearing (delegation,
 * decomposition, SLA escalation, budget handoff), so the tool description
 * tells the model to treat edits as org design, not decoration. The read
 * half lives in `organigram_read_tool` (mirrors the `task_read` /
 * `task_write` split).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import type { ToolDefinition } from '../types';
import { readCtxString } from './context';

const organigramWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('set_delegates'),
    agentSlug: z
      .string()
      .describe('Slug of the agent whose delegation list is being set'),
    delegateSlugs: z
      .array(z.string())
      .describe(
        'The COMPLETE list of agent slugs this agent delegates to (replaces the current list; pass [] to clear). An agent cannot delegate to itself.',
      ),
  }),
]);

export const organigramWriteTool: ToolDefinition = {
  name: 'organigram_write',
  tool: createTool({
    description:
      'Edit the agents-only delegation chart (many-to-many). set_delegates replaces one agent’s full delegation list (pass [] to clear). Delegation is functional: an agent can hand work to exactly the agents it delegates to, and those agents escalate back to it — propose structure that matches how the work should flow, and confirm destructive restructurings with the user first. Use organigram_read get_chart first so edits start from the real current structure.',
    inputSchema: organigramWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = readCtxString(ctx, 'organizationId');
      const userId = readCtxString(ctx, 'userId');
      if (!organizationId || !userId) {
        return { error: 'MISSING_CONTEXT' };
      }

      switch (args.operation) {
        case 'set_delegates': {
          const result = await ctx.runAction(
            internal.agents.workforce_ops.setDelegatesFromAgent,
            {
              organizationId,
              actorUserId: userId,
              agentSlug: args.agentSlug,
              delegateSlugs: args.delegateSlugs,
            },
          );
          if (!result.ok) {
            return {
              ok: false,
              error: result.code,
              hint:
                result.code === 'SELF_EDGE'
                  ? 'An agent cannot delegate to itself — remove it from the list.'
                  : result.code === 'INVALID_TARGET'
                    ? 'One of the slugs is not a real agent — call organigram_read get_chart for the valid slugs.'
                    : undefined,
            };
          }
          return {
            ok: true,
            agentSlug: args.agentSlug,
            delegateSlugs: args.delegateSlugs,
            previousDelegateSlugs: result.previous ?? [],
          };
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
