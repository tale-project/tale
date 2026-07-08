/**
 * Convex Tool: Agent Write
 *
 * Manage the org's agent roster: install / enable / disable / uninstall
 * agents. ALL operations are gated TWICE (changing the roster's structure
 * is admin-only):
 *  1. Config: only manager/admin agents carry `agent_write` in their toolNames.
 *  2. Server-side: the acting USER behind the run must be an org admin/developer
 *     (re-checked via the member role) — autonomous runs with no privileged
 *     human behind them are denied for every operation.
 *
 * Roster ops refuse to flip integration-bundled agents (cascade-owned,
 * `bundledBy` set) without `force`. Editing an agent's model/instructions/full
 * config stays HUMAN-ONLY (never a tool).
 *
 * The privilege gate uses the `developerSettings` CASL capability
 * (`lib/auth/require_org_admin_or_developer`) rather than a hardcoded role
 * list — owner/admin/developer hold it today.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { defineAbilityFor } from '../../../lib/permissions/ability';
import { internal } from '../../_generated/api';
import {
  readToolCtxString,
  requireOrganizationId,
} from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

const agentWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('install'),
    agentSlug: z.string().describe('Catalog agent slug to install for the org'),
  }),
  z.object({
    operation: z.literal('uninstall'),
    agentSlug: z.string(),
    force: z
      .boolean()
      .optional()
      .describe('Required to act on an integration-bundled agent'),
  }),
  z.object({
    operation: z.literal('enable'),
    agentSlug: z.string(),
  }),
  z.object({
    operation: z.literal('disable'),
    agentSlug: z.string(),
    force: z
      .boolean()
      .optional()
      .describe('Required to act on an integration-bundled agent'),
  }),
]);

export const agentWriteTool: ToolDefinition = {
  name: 'agent_write',
  availability: 'any',
  tool: createTool({
    description: `Manage the org's agent roster.

OPERATIONS:
• 'install': Install a catalog agent so it can be mentioned/routed to (admin only).
• 'enable' / 'disable': Toggle whether an installed agent is live (admin only).
• 'uninstall': Remove an agent installation (admin only).

All operations require an organization admin behind the request (changing the roster's structure is admin-only); integration-bundled agents require force to change. Editing an agent's model/instructions is done by a human in the agent editor.`,
    inputSchema: agentWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      // ALL agent_write operations change org structure, so every one requires
      // a privileged human behind the request. Autonomous runs with no
      // privileged human are denied. Re-check the member role server-side and
      // gate on the SAME `developerSettings` capability
      // `require_org_admin_or_developer` uses elsewhere.
      const userId = readToolCtxString(ctx, 'userId');
      if (!userId) return { ok: false, error: 'MISSING_USER_CONTEXT' };
      const role = await ctx.runQuery(
        internal.members.internal_queries.getMemberRole,
        { userId, organizationId },
      );
      if (defineAbilityFor(role).cannot('read', 'developerSettings')) {
        return {
          ok: false,
          error: 'FORBIDDEN',
          message:
            'Managing the agent roster requires organization administrator permissions.',
        };
      }

      const existing = await ctx.runQuery(
        internal.agents.installations.getInstallationInternal,
        { organizationId, agentSlug: args.agentSlug },
      );
      const isCascadeOwned = !!existing?.bundledBy;

      if (args.operation === 'install') {
        await ctx.runMutation(
          internal.agents.installations.upsertInstallation,
          {
            organizationId,
            agentSlug: args.agentSlug,
            installedBy: `user:${userId}`,
            contentHash: 'manual',
            enabled: true,
          },
        );
        return { ok: true, operation: 'install', agentSlug: args.agentSlug };
      }

      if (args.operation === 'enable') {
        await ctx.runMutation(internal.agents.installations.setEnabled, {
          organizationId,
          agentSlug: args.agentSlug,
          enabled: true,
        });
        return { ok: true, operation: 'enable', agentSlug: args.agentSlug };
      }

      if (isCascadeOwned && !args.force) {
        return {
          ok: false,
          error: 'CASCADE_OWNED',
          message: `"${args.agentSlug}" was installed by an integration. Disconnect that integration, or pass force to override.`,
        };
      }

      if (args.operation === 'disable') {
        await ctx.runMutation(internal.agents.installations.setEnabled, {
          organizationId,
          agentSlug: args.agentSlug,
          enabled: false,
          disabledReason: 'user',
        });
        return { ok: true, operation: 'disable', agentSlug: args.agentSlug };
      }

      // operation === 'uninstall'
      await ctx.runMutation(internal.agents.installations.deleteInstallation, {
        organizationId,
        agentSlug: args.agentSlug,
      });
      return { ok: true, operation: 'uninstall', agentSlug: args.agentSlug };
    },
  }),
} as const;
