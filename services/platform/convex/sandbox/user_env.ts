// User-level sandbox env/secrets — V8 mutations + queries.
//
// Scope: one row per (organizationId, userId, key). Auto-attached to all the
// user's sandbox sessions in that org (injected per turn by the runner via the
// `resolveUserEnv` Node action + `sessionEnvPatch`). Secrets are encrypted at
// rest (JWE) and are write-only: the read API never returns a secret's
// plaintext. Encryption happens in the Node action `user_env_actions.ts`
// (`lib/crypto` is node-only); this file holds only the V8-safe CRUD.

import { ConvexError, v } from 'convex/values';

import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { MAX_ENV_VARS_PER_USER, SECRET_MASK } from './user_env_constants';

/**
 * Assert the (userId, organizationId) pair is a live org membership. Used by
 * the Node upsert action, which can't run the db-backed RLS helpers itself.
 * `getOrganizationMember` throws `UnauthorizedError` when the user is not a
 * member, so a thrown error here is the deny signal.
 */
export const assertOrgMembershipInternal = internalQuery({
  args: { userId: v.string(), organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await getOrganizationMember(ctx, args.organizationId, {
      userId: args.userId,
    });
    return null;
  },
});

/**
 * Upsert one env/secret row. Internal — the public entry point is the Node
 * action `upsertMyEnvVar`, which authenticates, validates, and (for secrets)
 * encrypts before calling this. Enforces the per-user count cap on inserts.
 */
export const upsertUserEnvInternal = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    key: v.string(),
    isSecret: v.boolean(),
    value: v.optional(v.string()),
    encryptedValue: v.optional(v.string()),
    updatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('sandboxUserEnv')
      .withIndex('by_org_user_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', args.userId)
          .eq('key', args.key),
      )
      .first();

    const now = Date.now();
    const fields = {
      isSecret: args.isSecret,
      // Exactly one of value / encryptedValue is set; clear the other so a
      // secret→non-secret flip (or vice versa) never leaves a stale field.
      value: args.isSecret ? undefined : args.value,
      encryptedValue: args.isSecret ? args.encryptedValue : undefined,
      updatedAt: now,
      updatedBy: args.updatedBy,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return null;
    }

    const count = (
      await ctx.db
        .query('sandboxUserEnv')
        .withIndex('by_org_user', (q) =>
          q.eq('organizationId', args.organizationId).eq('userId', args.userId),
        )
        .collect()
    ).length;
    if (count >= MAX_ENV_VARS_PER_USER) {
      throw new ConvexError({
        code: 'too_many',
        message: `You can store at most ${MAX_ENV_VARS_PER_USER} environment variables.`,
      });
    }

    await ctx.db.insert('sandboxUserEnv', {
      organizationId: args.organizationId,
      userId: args.userId,
      key: args.key,
      ...fields,
    });
    return null;
  },
});

/**
 * Raw rows for injection (the Node `resolveUserEnv` action decrypts secrets).
 * Internal-only — returns ciphertext, never exposed to the browser.
 */
export const listUserEnvForInjection = internalQuery({
  args: { organizationId: v.string(), userId: v.string() },
  returns: v.array(
    v.object({
      key: v.string(),
      isSecret: v.boolean(),
      value: v.optional(v.string()),
      encryptedValue: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('sandboxUserEnv')
      .withIndex('by_org_user', (q) =>
        q.eq('organizationId', args.organizationId).eq('userId', args.userId),
      )
      .collect();
    return rows.map((r) => ({
      key: r.key,
      isSecret: r.isSecret,
      ...(r.value !== undefined && { value: r.value }),
      ...(r.encryptedValue !== undefined && {
        encryptedValue: r.encryptedValue,
      }),
    }));
  },
});

/**
 * List the calling user's env/secrets for the settings UI. Secrets are
 * write-only: their plaintext is never returned — `value` is present only for
 * non-secret vars; secrets carry a fixed mask.
 */
export const listMyEnv = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      key: v.string(),
      isSecret: v.boolean(),
      value: v.optional(v.string()),
      maskedValue: v.optional(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );
    const rows = await ctx.db
      .query('sandboxUserEnv')
      .withIndex('by_org_user', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', authUser.userId),
      )
      .collect();
    return rows
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => ({
        key: r.key,
        isSecret: r.isSecret,
        ...(r.isSecret
          ? { maskedValue: SECRET_MASK }
          : { value: r.value ?? '' }),
        updatedAt: r.updatedAt,
      }));
  },
});

/** Delete one of the calling user's env/secret entries. */
export const deleteMyEnvVar = mutation({
  args: { organizationId: v.string(), key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(
      ctx,
      authUser,
      authUser.userId,
      args.organizationId,
    );
    const existing = await ctx.db
      .query('sandboxUserEnv')
      .withIndex('by_org_user_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('userId', authUser.userId)
          .eq('key', args.key),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});
