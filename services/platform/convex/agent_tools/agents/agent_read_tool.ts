/**
 * Convex Tool: Agent Read
 *
 * Read-only view of the AI workforce: the delegation chart, the installed
 * roster, and any agent's place in the org chart. The write half (rewire
 * delegation, install/enable/disable agents) lives in `agent_write` — mirrors
 * the `task_read` / `task_write` split so read-only agents can see the
 * structure without being able to change it.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const agentReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('get_chart'),
  }),
  z.object({
    operation: z.literal('list_roster'),
  }),
  z.object({
    operation: z.literal('get_role'),
    agentSlug: z.string().describe('Agent whose org-chart position to read'),
  }),
]);

export const agentReadTool: ToolDefinition = {
  name: 'agent_read',
  tool: createTool({
    description: `Read the AI workforce: who's on the team and how work flows between them.

OPERATIONS:
• 'get_chart': The full delegation chart — every agent with the agents it delegates to and who delegates to it. Delegation is functional: an agent can hand work to exactly the agents it delegates to, and those agents escalate back to it.
• 'list_roster': The installed agents and whether each is enabled (live) — provenance included.
• 'get_role': One agent's position — whether it's a manager, its direct reports, and its manager.

Call this before agent_write so edits start from the real current structure.`,
    inputSchema: agentReadArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'get_chart') {
        return await ctx.runAction(
          internal.agents.workforce_ops.getChartOverview,
          { organizationId },
        );
      }

      if (args.operation === 'list_roster') {
        const roster = await ctx.runQuery(
          internal.agents.installations.listInstallStatesInternal,
          { organizationId },
        );
        return { operation: 'list_roster', roster };
      }

      // operation === 'get_role'
      const role = await ctx.runAction(
        internal.agents.workforce_ops.getOrgRole,
        { organizationId, agentSlug: args.agentSlug },
      );
      return { operation: 'get_role', ...role };
    },
  }),
} as const;
