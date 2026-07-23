/**
 * The organization-facing surface of the `skills` config domain: list, read,
 * save and delete a skill bundle.
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
 * never reaches the filesystem at all.
 */

import { v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import {
  requireOrgMembershipById,
  type OrgMembershipAuth,
} from '../lib/auth/require_org_membership';
import {
  skillDocumentValidator,
  skillEditArgs,
  skillListingValidator,
  type SkillDocumentView,
  type SkillListingView,
} from './validators';

/** Who is asking, as the file layer needs to know them. */
interface SkillCaller {
  readonly orgSlug: string;
  readonly viewerUserId: string;
  readonly isOrgAdmin: boolean;
}

/**
 * Verify membership of `organizationId` and derive the caller's identity for
 * the file layer. Administering the org's shared configuration is the
 * `orgSettings` write capability, which is what lets an admin curate an
 * org-visible skill they do not own.
 */
async function resolveSkillCaller(
  ctx: ActionCtx,
  organizationId: string,
): Promise<SkillCaller> {
  const auth: OrgMembershipAuth = await requireOrgMembershipById(
    ctx,
    organizationId,
  );
  return {
    orgSlug: auth.orgSlug,
    viewerUserId: auth.userId,
    isOrgAdmin: defineAbilityFor(auth.member.role).can('write', 'orgSettings'),
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
      icon: args.icon,
      labels: args.labels,
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
