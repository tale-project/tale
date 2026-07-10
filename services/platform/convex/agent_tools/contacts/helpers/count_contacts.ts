import type { ToolCtx } from '@convex-dev/agent';

import { internal } from '../../../_generated/api';
import type { ContactReadCountResult } from './types';

const MAX_PAGINATION_ATTEMPTS = 3;
const COUNT_PAGE_SIZE = 500;

type PaginationResult = {
  page: Array<Record<string, unknown>>;
  isDone: boolean;
  continueCursor: string;
};

export async function countContacts(
  ctx: ToolCtx,
): Promise<ContactReadCountResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for counting contacts',
    );
  }

  let totalCount = 0;
  let cursor: string | null = null;
  let attempts = 0;

  while (attempts < MAX_PAGINATION_ATTEMPTS) {
    attempts++;

    const queryFn = internal.contacts.internal_queries.queryContacts;
    const result: PaginationResult = await ctx.runQuery(queryFn, {
      organizationId,
      paginationOpts: {
        numItems: COUNT_PAGE_SIZE,
        cursor,
      },
    });

    totalCount += result.page.length;

    if (result.isDone) {
      return {
        operation: 'count',
        count: totalCount,
        message: `Total contacts: ${totalCount}`,
        isComplete: true,
      };
    }

    cursor = result.continueCursor;
  }

  return {
    operation: 'count',
    count: null,
    message: `Unable to count: data volume exceeds system limits (>${totalCount} contacts). Tell the user directly that the contact count cannot be calculated due to large data volume. DO NOT attempt workarounds.`,
    isComplete: false,
  };
}
