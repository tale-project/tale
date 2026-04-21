'use node';

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { action } from '../../_generated/server';
import type { ActionCtx } from '../../_generated/server';
import { authComponent } from '../../auth';
import {
  decryptSecret,
  encryptSecret,
  KeyRotatedError,
} from '../../lib/secret_box';

/**
 * Per-org moderation auth header, encrypted with AES-256-GCM and stored
 * in the `governanceSecrets` DB table (not in `governancePolicies` —
 * that table's audit log would leak the ciphertext into every policy
 * edit's `previousState`/`newState`). v1 holds a single value; v2 may
 * expand to a flat `Record<string, string>` if admins need multiple
 * secrets per provider.
 *
 * Runtime-side: `resolveModerationAuthHeader` is invoked from the Node
 * moderation action; it hits `getGuardrailsSecretInternal` via
 * `ctx.runQuery` and decrypts in-process so plaintext never leaves this
 * module.
 */

export const MODERATION_SECRET_NAME = 'moderation_auth_header';

function maskHeader(value: string): string {
  if (value.length <= 9) return '••••••••••';
  return value.slice(0, 6) + '••••••' + value.slice(-3);
}

/**
 * Read and decrypt the per-org moderation auth header. Returns `null` if
 * no secret is configured OR the stored row was encrypted with a
 * different key (post-rotation) — callers treat both as "not configured"
 * so the UI prompts the admin to re-save.
 */
export async function resolveModerationAuthHeader(
  ctx: ActionCtx,
  organizationId: string,
): Promise<string | null> {
  const row = await ctx.runQuery(
    internal.governance.internal_mutations.getGuardrailsSecretInternal,
    { organizationId, name: MODERATION_SECRET_NAME },
  );
  if (!row) return null;
  try {
    return decryptSecret(row);
  } catch (err) {
    if (err instanceof KeyRotatedError) {
      console.warn(
        `[guardrails] moderation secret for org ${organizationId} was ` +
          `encrypted with a different key; treating as unconfigured.`,
      );
      return null;
    }
    throw err;
  }
}

export const saveModerationSecret = action({
  args: {
    organizationId: v.string(),
    authHeader: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await ctx.runQuery(
      internal.governance.internal_mutations.requireGovernanceAdminInternal,
      {
        organizationId: args.organizationId,
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      },
    );

    const authHeader = args.authHeader.trim();
    if (authHeader.length === 0) {
      throw new Error('Auth header value cannot be empty.');
    }

    const encrypted = encryptSecret(authHeader);
    await ctx.runMutation(
      internal.governance.internal_mutations.upsertGuardrailsSecret,
      {
        organizationId: args.organizationId,
        name: MODERATION_SECRET_NAME,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        keyFingerprint: encrypted.keyFingerprint,
        updatedBy: String(authUser._id),
      },
    );
    return null;
  },
});

export const hasModerationSecret = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    await ctx.runQuery(
      internal.governance.internal_mutations.requireGovernanceAdminInternal,
      {
        organizationId: args.organizationId,
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      },
    );

    const row = await ctx.runQuery(
      internal.governance.internal_mutations.getGuardrailsSecretInternal,
      { organizationId: args.organizationId, name: MODERATION_SECRET_NAME },
    );
    if (!row) return null;
    try {
      const plaintext = decryptSecret(row);
      return maskHeader(plaintext);
    } catch (err) {
      if (err instanceof KeyRotatedError) {
        // Row exists but is undecryptable with the current key. Signal
        // "configured but stale" so the admin knows to re-enter.
        return '•••• (key rotated — re-save)';
      }
      return '••••••••••';
    }
  },
});
