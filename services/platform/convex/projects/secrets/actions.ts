'use node';

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { action, type ActionCtx } from '../../_generated/server';
import { authComponent } from '../../auth';
import {
  decryptSecret,
  encryptSecret,
  KeyRotatedError,
} from '../../lib/secret_box';

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;

async function requireAdmin(
  ctx: ActionCtx,
  organizationId: string,
  projectId: string,
): Promise<{ userId: string }> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) throw new Error('Unauthenticated');
  await ctx.runQuery(
    internal.projects.secrets.internal.requireProjectAdminInternal,
    {
      organizationId,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- projectId arrives as a string id from the client
      projectId: projectId as never,
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    },
  );
  return { userId: String(authUser._id) };
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
    const name = args.name.trim().toUpperCase();
    if (!SECRET_NAME_RE.test(name)) {
      throw new Error('SECRET_NAME_INVALID');
    }
    const value = args.value;
    if (value.length === 0 || value.length > 8192) {
      throw new Error('SECRET_VALUE_INVALID');
    }
    const encrypted = encryptSecret(value);
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
