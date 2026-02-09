/**
 * Business logic for loading a Better Auth user by internal ID.
 */

import type { QueryCtx } from '../../_generated/server';

import { components } from '../../_generated/api';

export interface BetterAuthUser {
  _id: string;
  _creationTime: number;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: number;
  updatedAt: number;
}

export async function getUserById(
  ctx: QueryCtx,
  userId: string,
): Promise<BetterAuthUser | null> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'user',
    paginationOpts: {
      cursor: null,
      numItems: 1,
    },
    where: [
      {
        field: '_id',
        value: userId,
        operator: 'eq',
      },
    ],
  });

  if (result && result.page.length > 0) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- third-party type
    return result.page[0] as BetterAuthUser;
  }

  return null;
}
