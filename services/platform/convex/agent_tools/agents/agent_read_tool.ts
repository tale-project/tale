/**
 * Convex Tool: Agent Read
 *
 * Read-only view of the org's agent roster. The write half (install / enable /
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
]);

export const agentReadTool: ToolDefinition = {
  name: 'agent_read',
  availability: 'any',
  tool: createTool({
    description: `Read the org's agent roster: who's on the team.

OPERATIONS:
• 'list_roster': The installed agents and whether each is enabled (live) — provenance included.

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

      // Exhaustiveness: `list_roster` is the only operation.
      const unhandled: never = args.operation;
      throw new Error(`Unsupported agent_read operation: ${String(unhandled)}`);
    },
  }),
} as const;
