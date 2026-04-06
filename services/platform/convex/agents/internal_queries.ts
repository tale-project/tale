/**
 * Internal queries for agent bindings.
 *
 * Only DB-level lookups belong here. Agent config is read from
 * JSON files via internal actions in file_actions.ts.
 */

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getBindingByAgent = internalQuery({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query('agentBindings')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .first();
  },
});
