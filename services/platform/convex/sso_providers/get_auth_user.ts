import type { GenericQueryCtx } from 'convex/server';

import type { DataModel } from '../_generated/dataModel';

import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

type AuthUserResult = {
  _id: string;
  email: string;
  name: string;
} | null;

export async function getAuthUser(
  ctx: GenericQueryCtx<DataModel>,
): Promise<AuthUserResult> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) {
    return null;
  }
  return {
    _id: authUser.userId,
    email: authUser.email ?? '',
    name: authUser.name ?? '',
  };
}
