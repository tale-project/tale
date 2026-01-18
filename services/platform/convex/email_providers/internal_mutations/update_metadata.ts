/**
 * Internal mutation to update provider metadata
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { jsonRecordValidator } from '../../../lib/shared/schemas/utils/json-value';

export const updateMetadata = internalMutation({
  args: {
    providerId: v.id('emailProviders'),
    metadata: v.object({
      redirectUri: v.optional(v.string()),
      redirectOrigin: v.optional(v.string()),
      redirectUpdatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const provider = await ctx.db.get(args.providerId);
    if (!provider) {
      throw new Error('Email provider not found');
    }

    const updatedMetadata = {
      ...(provider.metadata || {}),
      ...args.metadata,
    };

    await ctx.db.patch(args.providerId, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: updatedMetadata as any,
    });

    return null;
  },
});
