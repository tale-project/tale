/**
 * Query-side access resolution for the workspace-tool bridge
 * (`node_only/sandbox/workspace_tools_bridge.ts` — an action, so the
 * membership read has to cross into a query). One check per dispatch: the
 * turn's user must still be an active member of the session's org AND their
 * role must grant `read` on the table the tool exposes — the same policy the
 * user-side `queryWithRLS` surfaces enforce, via the same primitives
 * (`lib/rls/helpers/agent_read_access.ts`).
 */

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import {
  resolveAgentReadAccess,
  type AgentReadAccess,
} from '../lib/rls/helpers/agent_read_access';

export const resolveWorkspaceReadAccess = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    subject: v.union(
      v.literal('documents'),
      v.literal('contacts'),
      v.literal('products'),
      v.literal('websites'),
    ),
  },
  returns: v.union(
    v.object({ allowed: v.literal(true), role: v.string() }),
    v.object({
      allowed: v.literal(false),
      reason: v.union(v.literal('not_a_member'), v.literal('read_denied')),
    }),
  ),
  handler: async (ctx, args): Promise<AgentReadAccess> => {
    return await resolveAgentReadAccess(ctx, args);
  },
});
