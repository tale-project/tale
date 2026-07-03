/**
 * Convex Tool: Agent Read
 *
 * Read-only view of the AI workforce: the installed roster and any agent's
 * escalation position (its manager chain). The write half (install / enable /
 * disable agents) lives in `agent_write` — mirrors the `task_read` /
 * `task_write` split so read-only agents can see the structure without being
 * able to change it.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const agentReadArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('list_roster'),
  }),
  z.object({
    operation: z.literal('get_role'),
    agentSlug: z.string().describe('Agent whose escalation position to read'),
  }),
]);

export const agentReadTool: ToolDefinition = {
  name: 'agent_read',
  availability: 'any',
  tool: createTool({
    description: `Read the AI workforce: who's on the team.

OPERATIONS:
• 'list_roster': The installed agents and whether each is enabled (live) — provenance included.
• 'get_role': One agent's escalation position — whether it's a manager, its direct reports, and the manager its escalations route to.

Call this before agent_write so roster changes start from the real current state.`,
    inputSchema: agentReadArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      if (args.operation === 'list_roster') {
        const { states } = await ctx.runQuery(
          internal.agents.installations.listInstallStatesInternal,
          { organizationId },
        );
        return { operation: 'list_roster', roster: states };
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
