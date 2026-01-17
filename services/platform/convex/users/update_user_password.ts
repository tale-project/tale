/**
 * Update user password - Business logic
 */

import { MutationCtx } from '../_generated/server';
import { createAuth, authComponent } from '../../auth';

export interface UpdateUserPasswordArgs {
  currentPassword: string;
  newPassword: string;
}

/**
 * Update the current user's password.
 */
export async function updateUserPassword(
  ctx: MutationCtx,
  args: UpdateUserPasswordArgs,
): Promise<void> {
  const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
  await auth.api.changePassword({
    body: {
      currentPassword: args.currentPassword,
      newPassword: args.newPassword,
    },
    headers,
  });
}

