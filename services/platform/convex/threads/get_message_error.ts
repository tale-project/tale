import { listMessages } from '@convex-dev/agent';
import { v } from 'convex/values';

import { components } from '../_generated/api';
import { query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';

export const getMessageError = query({
  args: {
    threadId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const result = await listMessages(ctx, components.agent, {
      threadId: args.threadId,
      paginationOpts: { cursor: null, numItems: 5 },
      statuses: ['failed'],
    });

    const failedWithError = result.page.find(
      (m) => m.message?.role === 'assistant' && m.error,
    );

    return failedWithError?.error ?? null;
  },
});
