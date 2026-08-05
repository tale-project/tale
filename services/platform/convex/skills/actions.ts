/**
 * The organization-facing surface of the `skills` config domain: list, read,
 * save and delete a skill bundle, and read one bundle asset for the library's
 * file viewer.
 *
 * These are actions rather than queries and mutations because a skill lives
 * in the organization's config tree, and only a `'use node'` runtime may read
 * a file — so each handler verifies the caller here in V8 and then delegates
 * the filesystem work to `file_actions.ts` via `ctx.runAction`. The
 * `.history/` trail every edit leaves comes from that shared file plumbing;
 * this domain adds no versioning of its own.
 *
 * Every handler starts from `requireOrgMembershipById`, which is what makes
 * the org slug — and therefore the directory every path is resolved under —
 * trustworthy. A caller who is not a member of the organization they name
 * never reaches the filesystem at all. These are management surfaces reading
 * with the caller's full member identity; the agent surfaces get their
 * project-scoped listings from `chat/composer.ts`.
 */

import { v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import type { UserSkillViewer } from '../../lib/skills/visibility';
import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import {
  requireOrgMembershipById,
  type OrgMembershipAuth,
} from '../lib/auth/require_org_membership';
import {
  skillBundleFileValidator,
  skillDocumentValidator,
  skillEditArgs,
  skillListingValidator,
  type SkillBundleFileView,
  type SkillDocumentView,
  type SkillListingView,
} from './validators';

/** Who is asking, as the file layer needs to know them. */
interface SkillCaller {
  readonly orgSlug: string;
  readonly viewer: UserSkillViewer;
}

/**
 * Verify membership of `organizationId` and derive the caller's full viewer
 * identity for the file layer: their teams (for `team` skills) and whether
 * they administer the org's shared configuration — the `orgSettings` write
 * capability, which is what lets an admin curate a shared skill they do not
 * own.
 */
async function resolveSkillCaller(
  ctx: ActionCtx,
  organizationId: string,
): Promise<SkillCaller> {
  const auth: OrgMembershipAuth = await requireOrgMembershipById(
    ctx,
    organizationId,
  );
  const context = await ctx.runQuery(
    internal.skills.viewer_context.getUserSkillViewerContext,
    { organizationId, userId: auth.userId },
  );
  return {
    orgSlug: auth.orgSlug,
    viewer: {
      kind: 'user',
      userId: auth.userId,
      teamIds: context?.teamIds ?? [],
      isOrgAdmin:
        context?.isOrgAdmin ??
        defineAbilityFor(auth.member.role).can('write', 'orgSettings'),
    },
  };
}

/** The skills the caller can see in this organization. */
export const listSkills = action({
  args: { organizationId: v.string() },
  returns: skillListingValidator,
  handler: async (ctx, args): Promise<SkillListingView> => {
    const caller = await resolveSkillCaller(ctx, args.organizationId);
    return ctx.runAction(internal.skills.file_actions.listSkills, caller);
  },
});

/** One skill with its markdown body, or `null` when the caller has none such. */
export const getSkill = action({
  args: { organizationId: v.string(), slug: v.string() },
  returns: v.union(v.null(), skillDocumentValidator),
  handler: async (ctx, args): Promise<SkillDocumentView | null> => {
    const caller = await resolveSkillCaller(ctx, args.organizationId);
    return ctx.runAction(internal.skills.file_actions.readSkill, {
      ...caller,
      slug: args.slug,
    });
  },
});

/**
 * One named file of a skill's bundle, base64-encoded, or `null` when there
 * is no such skill or file for this caller.
 */
export const getSkillAsset = action({
  args: { organizationId: v.string(), slug: v.string(), path: v.string() },
  returns: v.union(v.null(), skillBundleFileValidator),
  handler: async (ctx, args): Promise<SkillBundleFileView | null> => {
    const caller = await resolveSkillCaller(ctx, args.organizationId);
    return ctx.runAction(internal.skills.file_actions.readSkillAsset, {
      ...caller,
      slug: args.slug,
      path: args.path,
    });
  },
});

/** Create or update a skill bundle in this organization. */
export const saveSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    ...skillEditArgs,
  },
  returns: skillDocumentValidator,
  handler: async (ctx, args): Promise<SkillDocumentView> => {
    const caller = await resolveSkillCaller(ctx, args.organizationId);
    return ctx.runAction(internal.skills.file_actions.saveSkill, {
      ...caller,
      slug: args.slug,
      description: args.description,
      body: args.body,
      visibility: args.visibility,
      teams: args.teams,
      icon: args.icon,
      labels: args.labels,
    });
  },
});

/**
 * Persist a skill-bundle zip a member staged into Convex storage (the
 * presign + intent hops live in `upload_mutations.ts`). Returns
 * `needs_confirm` instead of replacing an existing bundle until the caller
 * repeats the upload with `force`.
 */
export const uploadSkillBundle = action({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ ok: v.literal(true), slug: v.string() }),
    v.object({
      ok: v.literal(false),
      status: v.literal('needs_confirm'),
      slug: v.string(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; slug: string }
    | { ok: false; status: 'needs_confirm'; slug: string }
  > => {
    const caller = await resolveSkillCaller(ctx, args.organizationId);
    return ctx.runAction(internal.skills.file_actions.uploadSkillBundle, {
      organizationId: args.organizationId,
      orgSlug: caller.orgSlug,
      viewer: caller.viewer,
      storageId: args.storageId,
      force: args.force,
    });
  },
});

/** Delete a skill bundle. Returns false when there was nothing to delete. */
export const deleteSkill = action({
  args: { organizationId: v.string(), slug: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const caller = await resolveSkillCaller(ctx, args.organizationId);
    return ctx.runAction(internal.skills.file_actions.deleteSkill, {
      ...caller,
      slug: args.slug,
    });
  },
});
