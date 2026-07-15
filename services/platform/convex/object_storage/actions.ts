import { ConvexError, v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import { objectStorageConnectionFileSchema } from '../../lib/shared/schemas/object_storage';
import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import {
  requireOrgMembershipById,
  type OrgMembershipAuth,
} from '../lib/auth/require_org_membership';
import {
  objectStorageConnectionArgs,
  type ObjectStorageConnectionView,
  type ObjectStorageProbeResult,
} from './validators';

/**
 * Admin-gated public actions for the per-org "bring your own object storage"
 * bucket connection. Each authenticates the caller as an org admin, then
 * delegates the filesystem write / probe to the `'use node'` `file_actions.ts`
 * (kept separate so the generated api types don't collapse to `any`). The
 * connection lives in per-org JSON files — no DB row carries it. Mirrors the
 * per-org knowledge-DB admin actions.
 */

/** Gate to an org admin/owner (the `orgSettings` write capability). */
async function requireObjectStorageAdmin(
  ctx: ActionCtx,
  organizationId: string,
): Promise<OrgMembershipAuth> {
  const auth = await requireOrgMembershipById(ctx, organizationId);
  if (defineAbilityFor(auth.member.role).cannot('write', 'orgSettings')) {
    throw new ConvexError({
      code: 'ORG_FORBIDDEN',
      message: `Role "${auth.member.role}" cannot manage the object-storage connection.`,
    });
  }
  return auth;
}

/** Read the org's object-storage connection (masked — no credentials returned). */
export const getObjectStorageConnection = action({
  args: { organizationId: v.string() },
  returns: v.object({
    configured: v.boolean(),
    region: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    forcePathStyle: v.optional(v.boolean()),
    bucket: v.optional(v.string()),
    prefix: v.optional(v.string()),
    hasCredentials: v.optional(v.boolean()),
  }),
  handler: async (ctx, args): Promise<ObjectStorageConnectionView> => {
    const auth = await requireObjectStorageAdmin(ctx, args.organizationId);
    return ctx.runAction(internal.object_storage.file_actions.readConnection, {
      orgSlug: auth.orgSlug,
    });
  },
});

/**
 * Save (or update) the org's object-storage connection. Credentials are
 * required the first time the connection is configured; on a later edit they
 * may be omitted (leaving the stored sidecar untouched) so the bucket/region
 * can change without re-entering the keys.
 */
export const saveObjectStorageConnection = action({
  args: {
    organizationId: v.string(),
    ...objectStorageConnectionArgs,
    accessKeyId: v.optional(v.string()),
    secretAccessKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireObjectStorageAdmin(ctx, args.organizationId);
    const parsed = objectStorageConnectionFileSchema.safeParse({
      region: args.region,
      endpoint: args.endpoint,
      forcePathStyle: args.forcePathStyle ?? false,
      bucket: args.bucket,
      prefix: args.prefix,
    });
    if (!parsed.success) {
      throw new ConvexError({
        code: 'INVALID_CONNECTION',
        message: zodErrorMessage(
          'Invalid object-storage connection',
          parsed.error,
        ),
      });
    }

    const hasKey = !!args.accessKeyId && args.accessKeyId.length > 0;
    const hasSecret = !!args.secretAccessKey && args.secretAccessKey.length > 0;
    if (hasKey !== hasSecret) {
      throw new ConvexError({
        code: 'INVALID_CREDENTIALS',
        message:
          'Both accessKeyId and secretAccessKey must be provided together.',
      });
    }
    if (!hasKey) {
      // No credentials in this request — only valid when a sidecar already
      // exists (an edit of the bucket/region). A first-time configure needs
      // them (S3 has no passwordless mode).
      const existing: ObjectStorageConnectionView = await ctx.runAction(
        internal.object_storage.file_actions.readConnection,
        { orgSlug: auth.orgSlug },
      );
      if (!existing.hasCredentials) {
        throw new ConvexError({
          code: 'CREDENTIALS_REQUIRED',
          message:
            'accessKeyId and secretAccessKey are required to configure object storage.',
        });
      }
    }

    await ctx.runAction(internal.object_storage.file_actions.writeConnection, {
      orgSlug: auth.orgSlug,
      region: parsed.data.region,
      endpoint: parsed.data.endpoint,
      forcePathStyle: parsed.data.forcePathStyle,
      bucket: parsed.data.bucket,
      prefix: parsed.data.prefix,
      accessKeyId: hasKey ? args.accessKeyId : undefined,
      secretAccessKey: hasSecret ? args.secretAccessKey : undefined,
    });
    return null;
  },
});

/** Remove the org's object-storage connection (revert to Convex `_storage`). */
export const deleteObjectStorageConnection = action({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireObjectStorageAdmin(ctx, args.organizationId);
    await ctx.runAction(internal.object_storage.file_actions.deleteConnection, {
      orgSlug: auth.orgSlug,
    });
    return null;
  },
});

/**
 * Probe a candidate bucket before saving — a real PUT+GET+DELETE round-trip
 * that proves the credentials AND the bucket work. Tests the values in the
 * form; credentials are required (there is no passwordless S3).
 */
export const testObjectStorageConnection = action({
  args: {
    organizationId: v.string(),
    ...objectStorageConnectionArgs,
    accessKeyId: v.string(),
    secretAccessKey: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<ObjectStorageProbeResult> => {
    await requireObjectStorageAdmin(ctx, args.organizationId);
    const parsed = objectStorageConnectionFileSchema.safeParse({
      region: args.region,
      endpoint: args.endpoint,
      forcePathStyle: args.forcePathStyle ?? false,
      bucket: args.bucket,
      prefix: args.prefix,
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: zodErrorMessage(
          'Invalid object-storage connection',
          parsed.error,
        ),
      };
    }
    return ctx.runAction(internal.object_storage.file_actions.probeConnection, {
      region: parsed.data.region,
      endpoint: parsed.data.endpoint,
      forcePathStyle: parsed.data.forcePathStyle,
      bucket: parsed.data.bucket,
      prefix: parsed.data.prefix,
      accessKeyId: args.accessKeyId,
      secretAccessKey: args.secretAccessKey,
    });
  },
});
