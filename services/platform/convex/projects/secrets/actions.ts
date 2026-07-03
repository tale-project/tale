'use node';

import { ConvexError, v } from 'convex/values';

import { SECRET_NAME_RE } from '../../../lib/shared/schemas/secrets';
import { internal } from '../../_generated/api';
import { action, type ActionCtx } from '../../_generated/server';
import { getAuthUserIdentity } from '../../lib/rls/auth/get_auth_user_identity';
import {
  decryptSecret,
  encryptSecret,
  KeyRotatedError,
} from '../../lib/secret_box';

const SECRET_VALUE_MAX = 8192;

/**
 * Normalize (trim + upper-case) and shape-check a secret name, raising a
 * structured `ConvexError` the UI maps to a specific toast. Returns the
 * canonical name to store. The shape check runs on the FULL name (including any
 * `_USERNAME`/`_PASSWORD` suffix), so an over-long base that overflows the
 * 64-char budget once suffixed is rejected here too.
 */
function normalizeSecretName(raw: string): string {
  const name = raw.trim().toUpperCase();
  if (!SECRET_NAME_RE.test(name)) {
    throw new ConvexError({ code: 'SECRET_NAME_INVALID' });
  }
  return name;
}

/** Reject empty / over-long secret values with a structured `ConvexError`. */
function assertSecretValue(value: string): void {
  if (value.length === 0 || value.length > SECRET_VALUE_MAX) {
    throw new ConvexError({ code: 'SECRET_VALUE_INVALID' });
  }
}

async function requireAdmin(
  ctx: ActionCtx,
  organizationId: string,
  projectId: string,
): Promise<{ userId: string }> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new ConvexError({ code: 'UNAUTHENTICATED' });
  await ctx.runQuery(
    internal.projects.secrets.internal.requireProjectAdminInternal,
    {
      organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- projectId arrives as a string id from the client
      projectId: projectId as never,
      userId: authUser.userId,
      email: authUser.email,
      name: authUser.name,
    },
  );
  return { userId: authUser.userId };
}

/** Create or update a project secret (encrypts the value, stores ciphertext). */
export const setProjectSecret = action({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    name: v.string(),
    value: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { userId } = await requireAdmin(
      ctx,
      args.organizationId,
      args.projectId,
    );
    const name = normalizeSecretName(args.name);
    assertSecretValue(args.value);
    const encrypted = encryptSecret(args.value);
    await ctx.runMutation(
      internal.projects.secrets.internal.upsertProjectSecretInternal,
      {
        organizationId: args.organizationId,
        projectId: args.projectId,
        name,
        description: args.description?.trim() || undefined,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        keyFingerprint: encrypted.keyFingerprint,
        updatedBy: userId,
      },
    );
    return null;
  },
});

/**
 * Create or update a `basic` credential as the `_USERNAME`/`_PASSWORD` secret
 * pair in a SINGLE transaction. The previous client-side approach issued two
 * sequential `setProjectSecret` calls; a failure on the second write orphaned
 * the first with no rollback. Encrypting both values here and handing them to
 * one internal mutation makes the write atomic — either both rows land or
 * neither does.
 */
export const setProjectSecretPair = action({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    baseName: v.string(),
    username: v.string(),
    password: v.string(),
    description: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { userId } = await requireAdmin(
      ctx,
      args.organizationId,
      args.projectId,
    );
    // Validate the base shape first, then each suffixed name (so a base that
    // overflows the 64-char budget once suffixed is rejected with the same
    // SECRET_NAME_INVALID code).
    const base = normalizeSecretName(args.baseName);
    const usernameName = normalizeSecretName(`${base}_USERNAME`);
    const passwordName = normalizeSecretName(`${base}_PASSWORD`);
    assertSecretValue(args.username);
    assertSecretValue(args.password);
    const description = args.description?.trim() || undefined;
    const encryptedUsername = encryptSecret(args.username);
    const encryptedPassword = encryptSecret(args.password);
    await ctx.runMutation(
      internal.projects.secrets.internal.upsertProjectSecretPairInternal,
      {
        organizationId: args.organizationId,
        projectId: args.projectId,
        description,
        updatedBy: userId,
        username: { name: usernameName, ...encryptedUsername },
        password: { name: passwordName, ...encryptedPassword },
      },
    );
    return null;
  },
});

export const deleteProjectSecret = action({
  args: {
    organizationId: v.string(),
    projectId: v.id('projects'),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await requireAdmin(ctx, args.organizationId, args.projectId);
    await ctx.runMutation(
      internal.projects.secrets.internal.deleteProjectSecretInternal,
      {
        organizationId: args.organizationId,
        projectId: args.projectId,
        name: args.name.trim().toUpperCase(),
      },
    );
    return null;
  },
});

/**
 * Resolve a project secret to plaintext for injection into a runtime dispatch
 * payload. INTERNAL-ONLY contract: callers must never echo the return value to
 * an agent or log it; use a redacted digest in logs. Returns `null` if missing
 * or encrypted under a rotated key.
 */
export async function resolveProjectSecret(
  ctx: ActionCtx,
  args: { organizationId: string; projectId: string; name: string },
): Promise<string | null> {
  const row = await ctx.runQuery(
    internal.projects.secrets.internal.getProjectSecretRowInternal,
    {
      organizationId: args.organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- projectId arrives as a string id from the caller
      projectId: args.projectId as never,
      name: args.name,
    },
  );
  if (!row) return null;
  try {
    return decryptSecret(row);
  } catch (err) {
    if (err instanceof KeyRotatedError) {
      console.warn(
        `[project-secrets] secret ${args.name} for project ${args.projectId} ` +
          `was encrypted with a different key; treating as unconfigured.`,
      );
      return null;
    }
    throw err;
  }
}
