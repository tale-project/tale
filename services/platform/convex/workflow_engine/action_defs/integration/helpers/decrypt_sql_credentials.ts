/**
 * Decrypt credentials for SQL integration
 */

import type { Doc } from '../../../../_generated/dataModel';
import type { ActionCtx } from '../../../../_generated/server';

import { internal } from '../../../../_generated/api';

export async function decryptSqlCredentials(
  ctx: ActionCtx,
  integration: Doc<'integrations'>,
): Promise<{
  username: string;
  password: string;
}> {
  // Handle basic_auth (most common for SQL databases)
  if (integration.authMethod === 'basic_auth' && integration.basicAuth) {
    const basicAuth = integration.basicAuth;

    // Decrypt password
    const password = (await ctx.runAction(
      internal.lib.crypto.internal_actions.decryptString,
      {
        jwe: basicAuth.passwordEncrypted,
      },
    )) as string;

    return {
      username: basicAuth.username,
      password,
    };
  }

  throw new Error(
    `Unsupported auth method for SQL integration: ${integration.authMethod}. Use basic_auth for SQL databases.`,
  );
}
