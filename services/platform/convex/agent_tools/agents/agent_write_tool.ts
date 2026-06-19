/**
 * Convex Tool: Agent Write
 *
 * Manage the AI workforce: rewire the delegation chart and install / enable /
 * disable agents. ALL operations are gated TWICE (changing the workforce's
 * structure is admin-only, matching the human org-chart editor):
 *  1. Config: only manager/admin agents carry `agent_write` in their toolNames.
 *  2. Server-side: the acting USER behind the run must be an org admin/developer
 *     (re-checked via the member role) — autonomous runs with no privileged
 *     human behind them are denied for every operation, including set_delegates.
 *
 * `set_delegates` goes through the same validated single write path as the
 * canvas (`workforce_ops.writeAgentDelegates`, with a pre-write history
 * snapshot): reserved/unknown agents and self-edges are refused server-side
 * (cycles allowed). Roster ops refuse to flip integration-bundled agents
 * (cascade-owned, `bundledBy` set) without `force`. Editing an agent's
 * model/instructions/full config stays HUMAN-ONLY (never a tool).
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { internal } from '../../_generated/api';
import { requireOrganizationId } from '../tasks/helpers/context';
import type { ToolDefinition } from '../types';

function readCtxString(ctx: ToolCtx, key: string): string | undefined {
  const value: unknown = Reflect.get(ctx, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const PRIVILEGED = new Set(['admin', 'developer', 'owner']);

const agentWriteArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('set_delegates'),
    agentSlug: z.string().describe('Agent whose delegation list is being set'),
    delegateSlugs: z
      .array(z.string())
      .describe(
        'The COMPLETE list of agent slugs this agent delegates to (replaces the current list; [] clears it). An agent cannot delegate to itself.',
      ),
  }),
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
  tool: createTool({
    description: `Manage the AI workforce.

OPERATIONS:
• 'set_delegates': Replace one agent's full delegation list ([] clears it). Delegation is functional — propose structure that matches how work should flow, and confirm destructive restructurings with the user first. Call agent_read get_chart first.
• 'install': Install a catalog agent so it can be mentioned/routed to (admin only).
• 'enable' / 'disable': Toggle whether an installed agent is live (admin only).
• 'uninstall': Remove an agent installation (admin only).

All operations require an organization admin behind the request (changing the workforce's structure is admin-only); integration-bundled agents require force to change. Editing an agent's model/instructions is done by a human in the agent editor.`,
    inputSchema: agentWriteArgs,
    execute: async (ctx: ToolCtx, args) => {
      const organizationId = requireOrganizationId(ctx);

      // ALL agent_write operations — rewiring delegation AND the roster ops —
      // change org structure, so every one requires a privileged human behind
      // the request (the human org-chart editor is admin-gated too). Autonomous
      // runs with no privileged human are denied. Re-check the member role
      // server-side; mirrors check_role_access.ts.
      const userId = readCtxString(ctx, 'userId');
      if (!userId) return { ok: false, error: 'MISSING_USER_CONTEXT' };
      const role = await ctx.runQuery(
        internal.members.internal_queries.getMemberRole,
        { userId, organizationId },
      );
      if (!PRIVILEGED.has((role ?? 'member').toLowerCase())) {
        return {
          ok: false,
          error: 'FORBIDDEN',
          message:
            'Managing the AI workforce requires organization administrator permissions.',
        };
      }

      if (args.operation === 'set_delegates') {
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
            operation: 'set_delegates',
            error: result.code,
            hint:
              result.code === 'SELF_EDGE'
                ? 'An agent cannot delegate to itself — remove it from the list.'
                : result.code === 'INVALID_TARGET'
                  ? 'One of the slugs is not a real agent — call agent_read get_chart for the valid slugs.'
                  : undefined,
          };
        }
        return {
          ok: true,
          operation: 'set_delegates',
          agentSlug: args.agentSlug,
          delegateSlugs: args.delegateSlugs,
          previousDelegateSlugs: result.previous ?? [],
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
