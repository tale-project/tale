'use node';

// User-level sandbox env/secrets — Node actions. Encryption + decryption live
// here because `lib/crypto` is node-only (`get_secret_key` reads process.env).
//
//  - upsertMyEnvVar: the public write path. Authenticates, asserts org
//    membership, validates, encrypts secrets, then stores via the internal
//    mutation. Secrets are write-only — no read-back path exists.
//  - resolveUserEnv: internal, called per turn by the runner. Reads the rows,
//    decrypts secrets, and returns the merged env to inject via sessionEnvPatch.

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import { decryptString } from '../lib/crypto/decrypt_string';
import { encryptString } from '../lib/crypto/encrypt_string';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { UnauthorizedError } from '../lib/rls/errors';
import { validateEnvKey, validateEnvValue } from './user_env_constants';

export const upsertMyEnvVar = action({
  args: {
    organizationId: v.string(),
    key: v.string(),
    value: v.string(),
    isSecret: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new UnauthorizedError('Not authenticated');
    // DB-backed RLS can't run in an action — assert membership via a query
    // (throws UnauthorizedError when the user is not a member of the org).
    await ctx.runQuery(internal.sandbox.user_env.assertOrgMembershipInternal, {
      userId: authUser.userId,
      organizationId: args.organizationId,
    });

    const keyCheck = validateEnvKey(args.key);
    if (!keyCheck.ok) {
      throw new ConvexError({ code: 'invalid', message: keyCheck.reason });
    }
    // Trim surrounding whitespace — a pasted token/secret very commonly carries
    // a trailing newline (or leading indentation) that silently corrupts it
    // (e.g. a bearer token → 401). Interior whitespace is left intact so
    // legitimately multi-line secrets (PEM keys, etc.) survive.
    const value = args.value.trim();
    const valueCheck = validateEnvValue(value);
    if (!valueCheck.ok) {
      throw new ConvexError({ code: 'invalid', message: valueCheck.reason });
    }
    if (args.isSecret && value.length === 0) {
      throw new ConvexError({
        code: 'invalid',
        message: 'Secret value must not be empty.',
      });
    }

    const encryptedValue = args.isSecret
      ? await encryptString(value)
      : undefined;

    await ctx.runMutation(internal.sandbox.user_env.upsertUserEnvInternal, {
      organizationId: args.organizationId,
      userId: authUser.userId,
      key: args.key,
      isSecret: args.isSecret,
      ...(args.isSecret ? {} : { value }),
      ...(encryptedValue !== undefined && { encryptedValue }),
      updatedBy: authUser.userId,
    });
    return null;
  },
});

export const resolveUserEnv = internalAction({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
  },
  returns: v.object({ env: v.record(v.string(), v.string()) }),
  handler: async (ctx, args): Promise<{ env: Record<string, string> }> => {
    const rows = await ctx.runQuery(
      internal.sandbox.user_env.listUserEnvForInjection,
      { organizationId: args.organizationId, userId: args.userId },
    );

    const env: Record<string, string> = {};
    let secretCount = 0;
    for (const row of rows) {
      if (row.isSecret) {
        if (row.encryptedValue === undefined) continue;
        try {
          env[row.key] = await decryptString(row.encryptedValue);
          secretCount += 1;
        } catch (err) {
          // A corrupt secret / rotated key must not abort the whole turn —
          // skip this one (mirrors the Tier-2 broker's resilience).
          console.warn(
            `[sandbox.userenv] secret '${row.key}' failed to decrypt:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      } else {
        env[row.key] = row.value ?? '';
      }
    }

    // Light audit: record that user-managed secrets were injected for this
    // session (mirrors the Tier-2 broker's per-fetch traceability).
    if (secretCount > 0) {
      await ctx.runMutation(
        internal.sandbox.session_mutations.recordCredentialAccess,
        {
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          slug: 'user-env',
          kind: 'bootstrap',
        },
      );
    }

    return { env };
  },
});
