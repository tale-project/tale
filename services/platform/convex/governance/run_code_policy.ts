/**
 * Org-level package allowlist policy for the `run_code` tool.
 *
 * The matching gate at execution time lives in the run_code dispatcher; this
 * file only exposes the read + admin-write surface for the governance UI.
 *
 * Auth model:
 *   - `getRunCodePolicy` — any non-disabled org member (the editor mounts
 *     the read query before role gating to render the form skeleton).
 *   - `upsertRunCodePolicy` — admin/owner/developer only (CASL
 *     `developerSettings` capability), mirroring the `requireOrgAdminOrDeveloper`
 *     action helper. Replicated inline because mutations run in V8 query
 *     context, not the action context that helper targets.
 */
import { ConvexError, v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import type { Doc } from '../_generated/dataModel';
import { internalQuery, mutation, query } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

const defaultModeValidator = v.union(
  v.literal('allowlist'),
  v.literal('denylist'),
);

const policyDocValidator = v.union(
  v.object({
    _id: v.id('orgPackagePolicy'),
    _creationTime: v.number(),
    organizationId: v.string(),
    defaultMode: defaultModeValidator,
    pythonAllow: v.array(v.string()),
    pythonDeny: v.array(v.string()),
    nodeAllow: v.array(v.string()),
    nodeDeny: v.array(v.string()),
    updatedAt: v.number(),
    updatedByUserId: v.optional(v.string()),
  }),
  v.null(),
);

/**
 * Internal-only read used by the run_code tool's pre-execution policy gate.
 * Takes the org id verbatim — the caller (`run_code_tool.ts`) has already
 * authenticated the chat session, so no membership check here.
 */
export const getRunCodePolicyInternal = internalQuery({
  args: { organizationId: v.string() },
  returns: policyDocValidator,
  handler: async (ctx, args): Promise<Doc<'orgPackagePolicy'> | null> => {
    return await ctx.db
      .query('orgPackagePolicy')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
  },
});

export const getRunCodePolicy = query({
  args: {
    organizationId: v.string(),
  },
  returns: policyDocValidator,
  handler: async (ctx, args): Promise<Doc<'orgPackagePolicy'> | null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
      });
    }
    // Membership check — UnauthorizedError thrown by the helper bubbles up
    // unmodified; the UI dispatches on its `code` field for the access-denied
    // banner.
    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    const policy = await ctx.db
      .query('orgPackagePolicy')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();
    return policy;
  },
});

export const upsertRunCodePolicy = mutation({
  args: {
    organizationId: v.string(),
    defaultMode: defaultModeValidator,
    pythonAllow: v.array(v.string()),
    pythonDeny: v.array(v.string()),
    nodeAllow: v.array(v.string()),
    nodeDeny: v.array(v.string()),
  },
  returns: v.id('orgPackagePolicy'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
      });
    }
    const userId = String(authUser._id);

    const member = await getOrganizationMember(ctx, args.organizationId, {
      userId,
      email: authUser.email,
      name: authUser.name,
    });

    // Capability gate matches `requireOrgAdminOrDeveloper`: owner / admin /
    // developer all hold `read developerSettings`. Member / editor / disabled
    // do not.
    const ability = defineAbilityFor(member.role);
    if (ability.cannot('read', 'developerSettings')) {
      throw new ConvexError({
        code: 'FORBIDDEN_DEVELOPER_SETTINGS',
        message: `Role "${member.role}" cannot modify the run_code package policy.`,
      });
    }

    // Light normalization: drop empty strings, trim whitespace, dedupe.
    const norm = (xs: string[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const raw of xs) {
        const trimmed = raw.trim();
        if (trimmed.length === 0 || seen.has(trimmed)) continue;
        seen.add(trimmed);
        out.push(trimmed);
      }
      return out;
    };

    const existing = await ctx.db
      .query('orgPackagePolicy')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .first();

    const patch = {
      defaultMode: args.defaultMode,
      pythonAllow: norm(args.pythonAllow),
      pythonDeny: norm(args.pythonDeny),
      nodeAllow: norm(args.nodeAllow),
      nodeDeny: norm(args.nodeDeny),
      updatedAt: Date.now(),
      updatedByUserId: userId,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert('orgPackagePolicy', {
      organizationId: args.organizationId,
      ...patch,
    });
  },
});
