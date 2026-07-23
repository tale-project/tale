/**
 * The organization-facing surface of the `agents` config domain: list, read,
 * save and delete an agent, and resolve the one answering a turn.
 *
 * These are actions rather than queries and mutations because an agent lives
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
  agentDocumentValidator,
  agentEditArgs,
  agentListingValidator,
  resolvedAgentValidator,
  type AgentDocumentView,
  type AgentListingView,
  type ResolvedAgentView,
} from './validators';

/** Who is asking, as the file layer needs to know them. */
interface AgentCaller {
  readonly orgSlug: string;
  readonly viewerUserId: string;
  readonly isOrgAdmin: boolean;
}

/**
 * Verify membership of `organizationId` and derive the caller's identity for
 * the file layer. Administering the org's shared configuration is the
 * `orgSettings` write capability, which is what lets an admin curate an
 * org-visible agent they do not own.
 */
async function resolveAgentCaller(
  ctx: ActionCtx,
  organizationId: string,
): Promise<AgentCaller> {
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

/** The agents the caller can use in this organization. */
export const listAgents = action({
  args: { organizationId: v.string() },
  returns: agentListingValidator,
  handler: async (ctx, args): Promise<AgentListingView> => {
    const caller = await resolveAgentCaller(ctx, args.organizationId);
    return ctx.runAction(internal.agents.file_actions.listAgents, caller);
  },
});

/** One agent in full, or `null` when the caller has none such. */
export const getAgent = action({
  args: { organizationId: v.string(), slug: v.string() },
  returns: v.union(v.null(), agentDocumentValidator),
  handler: async (ctx, args): Promise<AgentDocumentView | null> => {
    const caller = await resolveAgentCaller(ctx, args.organizationId);
    return ctx.runAction(internal.agents.file_actions.readAgent, {
      ...caller,
      slug: args.slug,
    });
  },
});

/**
 * The agent answering a turn, with its words resolved for `locale` and its
 * binding lists as the turn must honour them.
 */
export const getAgentForTurn = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    locale: v.string(),
  },
  returns: v.union(v.null(), resolvedAgentValidator),
  handler: async (ctx, args): Promise<ResolvedAgentView | null> => {
    const caller = await resolveAgentCaller(ctx, args.organizationId);
    return ctx.runAction(internal.agents.file_actions.resolveAgent, {
      ...caller,
      slug: args.slug,
      locale: args.locale,
    });
  },
});

/** Create or update an agent in this organization. */
export const saveAgent = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    ...agentEditArgs,
  },
  returns: agentDocumentValidator,
  handler: async (ctx, args): Promise<AgentDocumentView> => {
    const caller = await resolveAgentCaller(ctx, args.organizationId);
    return ctx.runAction(internal.agents.file_actions.saveAgent, {
      ...caller,
      slug: args.slug,
      displayName: args.displayName,
      description: args.description,
      instructions: args.instructions,
      visibility: args.visibility,
      icon: args.icon,
      labels: args.labels,
      tools: args.tools,
      skills: args.skills,
      knowledge: args.knowledge,
    });
  },
});

/** Delete an agent. Returns false when there was nothing to delete. */
export const deleteAgent = action({
  args: { organizationId: v.string(), slug: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const caller = await resolveAgentCaller(ctx, args.organizationId);
    return ctx.runAction(internal.agents.file_actions.deleteAgent, {
      ...caller,
      slug: args.slug,
    });
  },
});
