import type { ToolCtx } from '@convex-dev/agent';

import { internal } from '../../../_generated/api';
import type { ContactReadListResult } from './types';

export async function readContactList(
  ctx: ToolCtx,
  args: { cursor?: string | null; numItems?: number },
): Promise<ContactReadListResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for listing contacts',
    );
  }

  const numItems = args.numItems ?? 200;
  const cursor = args.cursor ?? null;

  const result = await ctx.runQuery(
    internal.contacts.internal_queries.queryContacts,
    {
      organizationId,
      paginationOpts: {
        numItems,
        cursor,
      },
    },
  );

  return {
    operation: 'list',
    contacts: result.page,
    pagination: {
      hasMore: !result.isDone,
      totalFetched: result.page.length,
      cursor: result.continueCursor || null,
    },
  };
}
