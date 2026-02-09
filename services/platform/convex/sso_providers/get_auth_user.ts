import { GenericQueryCtx } from 'convex/server';

import { DataModel } from '../_generated/dataModel';
import { authComponent } from '../auth';

type AuthUserResult = {
  _id: string;
  email: string;
  name: string;
} | null;

export async function getAuthUser(
  ctx: GenericQueryCtx<DataModel>,
): Promise<AuthUserResult> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    return null;
  }
  return {
    _id: String(authUser._id),
    email: authUser.email,
    name: authUser.name ?? '',
  };
}
