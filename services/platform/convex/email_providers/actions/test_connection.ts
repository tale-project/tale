'use node';

/**
 * Test Connection Public Action
 * Tests new provider credentials before saving
 */

import { v } from 'convex/values';
import { action } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { authComponent } from '../../auth';
import {
  emailProviderVendorValidator,
  emailProviderAuthMethodValidator,
  smtpConfigValidator,
  imapConfigValidator,
} from '../validators';
import type { TestResult } from '../test_existing_provider';

export const testConnection = action({
  args: {
    vendor: emailProviderVendorValidator,
    authMethod: emailProviderAuthMethodValidator,
    passwordAuth: v.optional(
      v.object({
        user: v.string(),
        pass: v.string(),
      }),
    ),
    oauth2Auth: v.optional(
      v.object({
        user: v.string(),
        accessToken: v.string(),
      }),
    ),
    smtpConfig: smtpConfigValidator,
    imapConfig: imapConfigValidator,
  },
  handler: async (ctx, args): Promise<TestResult> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    return await ctx.runAction(
      internal.email_providers.internal_actions.test_new_provider_connection.testNewProviderConnection,
      args,
    );
  },
});
