/**
 * Business logic for loading a Better Auth user by internal ID.
 */

import {
  isRecord,
  getString,
  getNumber,
  getBoolean,
} from '../../../../lib/utils/type-utils';
import type { QueryCtx } from '../../lib/ctx';
import { components } from '../../lib/handler_names';
import { looksLikeConvexDocumentId } from '../../lib/helpers/id_shape';

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
  // Sentinels ('system'), slugs, and emails cannot be document ids; passing
  // one into the component's `_id` filter throws INSIDE the component (an
  // uncaught component-query error in the logs) before any caller's catch.
  // They can only ever mean "no such user" — answer that here.
  if (!looksLikeConvexDocumentId(userId)) return null;
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
    const raw = result.page[0];
    if (!isRecord(raw)) return null;
    return {
      _id: getString(raw, '_id') ?? '',
      _creationTime: getNumber(raw, '_creationTime') ?? 0,
      name: getString(raw, 'name') ?? '',
      email: getString(raw, 'email') ?? '',
      emailVerified: getBoolean(raw, 'emailVerified') ?? false,
      image: getString(raw, 'image'),
      createdAt: getNumber(raw, 'createdAt') ?? 0,
      updatedAt: getNumber(raw, 'updatedAt') ?? 0,
    };
  }

  return null;
}
