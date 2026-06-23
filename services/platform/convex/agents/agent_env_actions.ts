'use node';

// Per-agent env/secrets — Node actions. Encryption + decryption live here
// because `lib/crypto` is node-only.
//
//  - setAgentEnvVar: public write path. Authenticates, asserts org membership,
//    validates, encrypts secrets, then stores via the internal mutation.
//    Secrets are write-only — no read-back path exists.
//  - resolveAgentEnv: internal, called at the agent's external-run CLAIM. Reads
//    the rows, decrypts secrets, and returns the merged env for injection into
//    the runtime process (decrypt-at-run; ciphertext never leaves the server
//    except as the resolved value over the authenticated claim channel).

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import { decryptString } from '../lib/crypto/decrypt_string';
import { encryptString } from '../lib/crypto/encrypt_string';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { UnauthorizedError } from '../lib/rls/errors';
import {
  maskSecretPreview,
  validateEnvKey,
  validateEnvValue,
} from '../sandbox/user_env_constants';
import { validateTokenSourceSlug } from '../token_sources/validators';

export const setAgentEnvVar = action({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    key: v.string(),
    value: v.string(),
    isSecret: v.boolean(),
    /** When set, write a TOKEN-SOURCE BINDING row instead of a literal value:
     *  `key` is the env var the rotation engine fills from this `token-sources`
     *  slug. `value`/`isSecret` are ignored for a binding. */
    tokenSourceSlug: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new UnauthorizedError('Not authenticated');
    // DB-backed RLS can't run in an action — assert org membership via a query
    // (throws UnauthorizedError when the user is not a member of the org).
    await ctx.runQuery(internal.sandbox.user_env.assertOrgMembershipInternal, {
      userId: authUser.userId,
      organizationId: args.organizationId,
    });

    const keyCheck = validateEnvKey(args.key);
    if (!keyCheck.ok) {
      throw new ConvexError({ code: 'invalid', message: keyCheck.reason });
    }

    // Token-source binding: no literal value/cipher; the row names the env var
    // (`key`) and the source slug. The injected token is itself a secret.
    if (args.tokenSourceSlug !== undefined) {
      // Validate the slug at this client-trusted write boundary (mirrors the
      // `key` check above) so a bad binding fails fast here, not cryptically at
      // run time when the config file can't be resolved.
      if (!validateTokenSourceSlug(args.tokenSourceSlug)) {
        throw new ConvexError({
          code: 'invalid',
          message: 'Token source slug must match ^[a-z0-9][a-z0-9_-]{0,99}$',
        });
      }
      await ctx.runMutation(internal.agents.agent_env.upsertAgentEnvInternal, {
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
        key: args.key,
        isSecret: true,
        tokenSourceSlug: args.tokenSourceSlug,
        updatedBy: authUser.userId,
      });
      return null;
    }
    // Trim surrounding whitespace — a pasted token commonly carries a trailing
    // newline that silently corrupts it. Interior whitespace is left intact.
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
    const maskedPreview = args.isSecret ? maskSecretPreview(value) : undefined;

    await ctx.runMutation(internal.agents.agent_env.upsertAgentEnvInternal, {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      key: args.key,
      isSecret: args.isSecret,
      ...(args.isSecret ? {} : { value }),
      ...(encryptedValue !== undefined && { encryptedValue }),
      ...(maskedPreview !== undefined && { maskedPreview }),
      updatedBy: authUser.userId,
    });
    return null;
  },
});

export const resolveAgentEnv = internalAction({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.object({
    env: v.record(v.string(), v.string()),
    /** Token-source bindings (env var name → source slug). NOT resolved here —
     * the run-path rotation engine fetches the pool, picks one, and injects it
     * under `key`, then rotates on rate-limit/expiry. */
    tokenBindings: v.array(
      v.object({ key: v.string(), tokenSourceSlug: v.string() }),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    env: Record<string, string>;
    tokenBindings: { key: string; tokenSourceSlug: string }[];
  }> => {
    const rows = await ctx.runQuery(
      internal.agents.agent_env.listAgentEnvForInjection,
      { organizationId: args.organizationId, agentSlug: args.agentSlug },
    );

    const env: Record<string, string> = {};
    const tokenBindings: { key: string; tokenSourceSlug: string }[] = [];
    for (const row of rows) {
      if (row.tokenSourceSlug !== undefined) {
        tokenBindings.push({
          key: row.key,
          tokenSourceSlug: row.tokenSourceSlug,
        });
        continue;
      }
      if (row.isSecret) {
        if (row.encryptedValue === undefined) continue;
        try {
          env[row.key] = await decryptString(row.encryptedValue);
        } catch (err) {
          // A corrupt secret / rotated key must not abort the run — skip it.
          console.warn(
            `[agent-env] secret '${row.key}' failed to decrypt:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      } else {
        env[row.key] = row.value ?? '';
      }
    }
    return { env, tokenBindings };
  },
});
