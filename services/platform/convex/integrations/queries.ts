/**
 * Integrations Queries
 *
 * Internal and public queries for integrations.
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { listIntegrations } from './list_integrations';

export const listInternal = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listIntegrations(ctx, args);
  },
});
