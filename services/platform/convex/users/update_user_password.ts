/**
 * Update user password - Business logic
 */

import { MutationCtx } from '../_generated/server';
import { hasCredentialAccount } from '../accounts/helpers';
import { createAuth, authComponent } from '../auth';

export interface UpdateUserPasswordArgs {
  currentPassword?: string;
  newPassword: string;
}

/**
 * Update the current user's password.
 * For credential users: requires currentPassword, uses changePassword.
 * For OAuth-only users: uses setPassword to add a password to their account.
 */
export async function updateUserPassword(
  ctx: MutationCtx,
  args: UpdateUserPasswordArgs,
): Promise<void> {
  const { auth, headers } = await authComponent.getAuth(createAuth, ctx);

  const hasPassword = await hasCredentialAccount(ctx);

  if (hasPassword) {
    if (!args.currentPassword) {
      throw new Error('Current password is required');
    }
    await auth.api.changePassword({
      body: {
        currentPassword: args.currentPassword,
        newPassword: args.newPassword,
      },
      headers,
    });
  } else {
    await auth.api.setPassword({
      body: {
        newPassword: args.newPassword,
      },
      headers,
    });
  }
}
